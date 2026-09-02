/**
 * The five `scripts/check-*.mjs` / `block-*.mjs` hooks are this repo's policy
 * layer — each one exists because of a bug class the suite could not see.
 * Nothing tested them. A regression there is silent by construction: a hook
 * that stops firing looks exactly like a clean edit.
 *
 * Each script is run as a real child process, the way Claude Code runs it,
 * against a throwaway fixture tree — a temp git repo for the schema check, a
 * temp project for i18n and flag-sync, a real-but-deleted fixture file for
 * lint (ESLint needs the repo's own config to mean anything). Assertions are
 * on exit code AND on the message, because a hook whose explanation stops
 * naming the file or the flag has lost most of its value.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..');
const SCRIPTS = join(ROOT, 'scripts');

const scratch: string[] = [];
function tmp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  scratch.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

function run(script: string, opts: { cwd?: string; input?: string } = {}) {
  const r = spawnSync('node', [script], {
    cwd: opts.cwd ?? ROOT,
    input: opts.input ?? '',
    encoding: 'utf8',
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

// ---------------------------------------------------------------------------
describe('block-tab-screenshot.mjs (PreToolUse on Bash)', () => {
  const SCRIPT = join(SCRIPTS, 'block-tab-screenshot.mjs');
  const payload = (command: string) => JSON.stringify({ tool_input: { command } });

  it('blocks a headless shot of a ?tab= URL and points at verify-ui', () => {
    const r = run(SCRIPT, {
      input: payload('chrome --headless --screenshot=p.png "http://localhost:3000/bpm?tab=profile"'),
    });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/\?tab=/);
    expect(r.stderr).toMatch(/verify-ui/);
  });

  it('blocks --virtual-time-budget even without ?tab=', () => {
    const r = run(SCRIPT, {
      input: payload('chrome --headless --virtual-time-budget=5000 --screenshot http://localhost:3000/bpm'),
    });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/virtual-time-budget/);
  });

  it('allows a plain headless shot of Home', () => {
    const r = run(SCRIPT, {
      input: payload('chrome --headless --screenshot=p.png http://localhost:3000/bpm'),
    });
    expect(r.status).toBe(0);
    expect(r.stderr).toBe('');
  });

  it('ignores commands that mention tab= but take no screenshot', () => {
    const r = run(SCRIPT, { input: payload('curl "http://localhost:3000/bpm?tab=admin"') });
    expect(r.status).toBe(0);
  });

  it('lets an unrecognised or empty payload through', () => {
    expect(run(SCRIPT, { input: 'not json' }).status).toBe(0);
    expect(run(SCRIPT, { input: '' }).status).toBe(0);
  });
});

// ---------------------------------------------------------------------------
describe('check-lint-errors.mjs (PostToolUse on Edit|Write)', () => {
  const SCRIPT = join(SCRIPTS, 'check-lint-errors.mjs');
  // Inside lib/ so the repo's real ESLint config (and tsconfig include) applies.
  const FIXTURE = join(ROOT, 'lib', '__hook_lint_fixture__.ts');
  const payload = (file_path: string) => JSON.stringify({ tool_input: { file_path } });

  afterAll(() => {
    if (existsSync(FIXTURE)) unlinkSync(FIXTURE);
  });

  it('skips a non-lintable path without running eslint', () => {
    const r = run(SCRIPT, { input: payload(join(ROOT, 'messages/en.json')) });
    expect(r.status).toBe(0);
    expect(r.stderr).toBe('');
  });

  it('lets an unrecognised payload through', () => {
    expect(run(SCRIPT, { input: '{"tool_input":{}}' }).status).toBe(0);
    expect(run(SCRIPT, { input: 'not json' }).status).toBe(0);
  });

  it('passes a clean file', { timeout: 60_000 }, () => {
    writeFileSync(FIXTURE, 'export const hookLintFixture = 1;\n');
    const r = run(SCRIPT, { input: payload(FIXTURE) });
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
  });

  it('fails on an ERROR, naming the rule (the stranded-import case)', { timeout: 60_000 }, () => {
    writeFileSync(FIXTURE, "import { join } from 'node:path';\nexport const hookLintFixture = 1;\n");
    const r = run(SCRIPT, { input: payload(FIXTURE) });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/no-unused-vars/);
    expect(r.stderr).toMatch(/__hook_lint_fixture__/);
  });
});

// ---------------------------------------------------------------------------
describe('check-schema-additive.mjs (PostToolUse on Edit|Write)', () => {
  const SCRIPT = join(SCRIPTS, 'check-schema-additive.mjs');
  const BASE =
    'export interface Session {\n  id: string;\n  deadline?: string;\n}\n\n' +
    'export interface Player {\n  name: string;\n}\n';

  /** A throwaway git repo whose HEAD holds `base` at lib/types.ts. */
  function repoWith(base: string): string {
    const dir = tmp('schema-');
    mkdirSync(join(dir, 'lib'));
    writeFileSync(join(dir, 'lib/types.ts'), base);
    const git = (...args: string[]) =>
      spawnSync(
        'git',
        ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args],
        { cwd: dir, encoding: 'utf8' },
      );
    git('init', '-q', '-b', 'main');
    git('add', '.');
    git('commit', '-q', '-m', 'base');
    return dir;
  }

  it('warns, without failing, when a field disappears', () => {
    const dir = repoWith(BASE);
    writeFileSync(join(dir, 'lib/types.ts'), BASE.replace('  deadline?: string;\n', ''));
    const r = run(SCRIPT, { cwd: dir });
    expect(r.status).toBe(0);
    expect(r.stderr).toMatch(/Session\.deadline/);
    expect(r.stderr).toMatch(/ADDITIVE AND OPTIONAL/);
  });

  it('is silent when a field is added', () => {
    const dir = repoWith(BASE);
    writeFileSync(join(dir, 'lib/types.ts'), BASE.replace('  name: string;\n', '  name: string;\n  paid?: boolean;\n'));
    const r = run(SCRIPT, { cwd: dir });
    expect(r.status).toBe(0);
    expect(r.stderr).toBe('');
  });

  it('is silent when a whole interface goes (out of scope by design)', () => {
    const dir = repoWith(BASE);
    writeFileSync(join(dir, 'lib/types.ts'), BASE.slice(0, BASE.indexOf('export interface Player')));
    const r = run(SCRIPT, { cwd: dir });
    expect(r.status).toBe(0);
    expect(r.stderr).toBe('');
  });

  it('is silent when nothing changed', () => {
    const r = run(SCRIPT, { cwd: repoWith(BASE) });
    expect(r.status).toBe(0);
    expect(r.stderr).toBe('');
  });
});

// ---------------------------------------------------------------------------
describe('check-i18n-keys.mjs (PostToolUse on Edit|Write)', () => {
  const SCRIPT = join(SCRIPTS, 'check-i18n-keys.mjs');
  const EN = {
    admin: { stringing: { newJob: 'New job', stage: { queued: 'Queued' } } },
    nav: { home: 'Home' },
  };

  /** A throwaway project: messages/*.json + one component file. */
  function project(component: string, zh: unknown = EN): string {
    const dir = tmp('i18n-');
    mkdirSync(join(dir, 'messages'));
    mkdirSync(join(dir, 'components'));
    mkdirSync(join(dir, 'app'));
    writeFileSync(join(dir, 'messages/en.json'), JSON.stringify(EN));
    writeFileSync(join(dir, 'messages/zh-CN.json'), JSON.stringify(zh));
    writeFileSync(
      join(dir, 'components/Card.tsx'),
      `const t = useTranslations('admin.stringing');\nconst tNav = useTranslations('nav');\n${component}\n`,
    );
    return dir;
  }

  it('passes when every key resolves in both locales, across two translators', () => {
    const r = run(SCRIPT, { cwd: project("t('newJob'); tNav('home'); t(`stage.${x}`);") });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/every t\(\) key resolves/);
  });

  it('fails on a missing key, naming the file, the full path and the locale', () => {
    const r = run(SCRIPT, { cwd: project("t('missing');") });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/components\/Card\.tsx\s+admin\.stringing\.missing\s+missing in messages\/en\.json/);
    expect(r.stderr).toMatch(/THROWS on a missing key/);
  });

  it('fails when a literal key resolves to an object', () => {
    const r = run(SCRIPT, { cwd: project("t('stage');") });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/resolves to an object/);
  });

  it('fails when a template prefix is not an object', () => {
    const r = run(SCRIPT, { cwd: project('t(`newJob.${x}`);') });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/\(prefix\).*is not an object/);
  });

  it('ignores a mid-segment template (the GearPickSheet false positive)', () => {
    const r = run(SCRIPT, { cwd: project('t(`format_${f}`);') });
    expect(r.status).toBe(0);
  });

  it('checks zh-CN too, not only en', () => {
    const r = run(SCRIPT, { cwd: project("tNav('home');", { admin: EN.admin }) });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/nav\.home\s+missing in messages\/zh-CN\.json/);
  });
});

// ---------------------------------------------------------------------------
describe('check-flag-sync.mjs (PostToolUse on Edit|Write, and SessionStart)', () => {
  type Flag = { name: string; due: string };

  function flagsTs(entries: Flag[]): string {
    const union = entries.map((e) => `  | '${e.name}'`).join('\n');
    const body = entries
      .map((e) => `  ${e.name}: {\n    description: 'x',\n    plannedRemoval: '${e.due}',\n  },`)
      .join('\n');
    return `export type FlagName =\n${union};\n\nexport const FLAGS: Record<FlagName, FlagMeta> = {\n${body}\n};\n`;
  }
  const workflow = (names: string[]) => 'env:\n' + names.map((n) => `  ${n}: 'true'`).join('\n') + '\n';

  /**
   * The script resolves ROOT from its own location (`scripts/..`), so the
   * fixture is a whole tree with the script copied in — not a cwd.
   */
  function project(opts: { flags: Flag[]; deploy?: string[]; ci?: string[] }): string {
    const dir = tmp('flags-');
    mkdirSync(join(dir, 'scripts'));
    mkdirSync(join(dir, 'lib'));
    mkdirSync(join(dir, '.github/workflows'), { recursive: true });
    cpSync(join(SCRIPTS, 'check-flag-sync.mjs'), join(dir, 'scripts/check-flag-sync.mjs'));
    writeFileSync(join(dir, 'lib/flags.ts'), flagsTs(opts.flags));
    const names = opts.flags.map((f) => f.name);
    const deploy = opts.deploy ?? names;
    writeFileSync(join(dir, '.github/workflows/deploy-next.yml'), workflow(deploy));
    writeFileSync(join(dir, '.github/workflows/pr-ci.yml'), workflow(opts.ci ?? deploy));
    return join(dir, 'scripts/check-flag-sync.mjs');
  }

  const FUTURE = '2999-01-01';
  const A = { name: 'NEXT_PUBLIC_FLAG_ALPHA', due: FUTURE };
  const B = { name: 'NEXT_PUBLIC_FLAG_BETA', due: FUTURE };

  it('is silent when registry, deploy and CI agree and nothing is overdue', () => {
    const r = run(project({ flags: [A, B] }));
    expect(r.status).toBe(0);
    expect(r.stderr).toBe('');
  });

  it('fails when a registered flag is missing from deploy-next.yml (the SETTLE case)', () => {
    const r = run(project({ flags: [A, B], deploy: [A.name] }));
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/MISSING from deploy-next\.yml/);
    expect(r.stderr).toMatch(/NEXT_PUBLIC_FLAG_BETA/);
  });

  it('fails when deploy-next.yml still lists a retired flag', () => {
    const r = run(project({ flags: [A], deploy: [A.name, 'NEXT_PUBLIC_FLAG_RETIRED'] }));
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/NOT in lib\/flags\.ts/);
    expect(r.stderr).toMatch(/NEXT_PUBLIC_FLAG_RETIRED/);
  });

  it('fails when pr-ci.yml drifts from deploy-next.yml (CI must build what ships)', () => {
    const r = run(project({ flags: [A, B], ci: [A.name] }));
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/MISSING from pr-ci\.yml/);
    expect(r.stderr).toMatch(/NEXT_PUBLIC_FLAG_BETA/);
  });

  it('reports an overdue flag with its date, without failing', () => {
    const r = run(project({ flags: [A, { name: 'NEXT_PUBLIC_FLAG_OLD', due: '2020-01-01' }] }));
    expect(r.status).toBe(0);
    expect(r.stderr).toMatch(/1 feature flag\(s\) are past their removal date/);
    expect(r.stderr).toMatch(/NEXT_PUBLIC_FLAG_OLD\s+\(due 2020-01-01\)/);
  });

  it("does not pair a 'never' entry with the NEXT entry's date", () => {
    // The regression the script's own comment describes: a non-greedy scan ran
    // on into the next entry and reported DESIGN_PREVIEW as due on
    // COMMAND_CENTER's date, dropping COMMAND_CENTER entirely.
    const r = run(
      project({
        flags: [
          { name: 'NEXT_PUBLIC_FLAG_NEVER', due: 'never' },
          { name: 'NEXT_PUBLIC_FLAG_OLD', due: '2020-01-01' },
        ],
      }),
    );
    expect(r.status).toBe(0);
    expect(r.stderr).toMatch(/NEXT_PUBLIC_FLAG_OLD\s+\(due 2020-01-01\)/);
    expect(r.stderr).not.toMatch(/NEXT_PUBLIC_FLAG_NEVER/);
  });
});
