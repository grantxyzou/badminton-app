import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Anthropic callers canary.
 *
 * `docs/azure.md` §4 lists the routes that call the Claude API, and
 * `docs/plans/ai-governance-and-docs-accuracy.md` names "a fourth `/api/claude`
 * caller" as the event that would prove the opt-in persona was the wrong
 * shape. Both are prose. `docs/azure.md` said "one admin-only feature" for
 * months after the count reached three, and nothing could have told anyone.
 *
 * This test finds every file in `app/` and `lib/` that imports the SDK, and
 * requires (a) the set to equal the list below and (b) each route's path to
 * appear in the Callers section of `docs/azure.md`. A new caller therefore
 * fails the build until it is both listed here, with a word on whether it
 * goes through `lib/aiPersona.ts`, and documented where the deployment doc
 * says what spends the API budget.
 */

const EXPECTED: ReadonlyArray<{ file: string; route: string; persona: 'yes' | 'no'; why: string }> = [
  { file: 'app/api/claude/route.ts', route: '/api/claude', persona: 'yes', why: 'admin prose: announcements, release notes' },
  { file: 'app/api/stats/insight/route.ts', route: '/api/stats/insight', persona: 'yes', why: 'member-facing weekly read on Stats' },
  { file: 'app/api/equipment/fit-verdict/route.ts', route: '/api/equipment/fit-verdict', persona: 'no', why: 'racket-fit verdict, flag-gated; worded by its own prompt, not the shared voice (recorded, not endorsed — see the governance plan)' },
];

const ROOT = process.cwd();
const IMPORT = /from ['"]@anthropic-ai\/sdk['"]/;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === '__tests__' || entry === 'node_modules') continue;
      walk(full, out);
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

function callers(): string[] {
  const out: string[] = [];
  for (const dir of ['app', 'lib']) {
    for (const full of walk(join(ROOT, dir))) {
      if (IMPORT.test(readFileSync(full, 'utf8'))) out.push(relative(ROOT, full).replace(/\\/g, '/'));
    }
  }
  return out.sort();
}

describe('anthropic callers canary', () => {
  const found = callers();
  const expectedFiles = EXPECTED.map((e) => e.file).sort();

  it('the set of files importing @anthropic-ai/sdk is exactly the documented one', () => {
    expect(found, 'A new Claude caller appeared, or one left. Update EXPECTED here and the Callers section of docs/azure.md.').toEqual(expectedFiles);
  });

  it('every caller is named in docs/azure.md §4 Callers', () => {
    const doc = readFileSync(join(ROOT, 'docs/azure.md'), 'utf8');
    const section = doc.split('### Callers')[1]?.split('\n## ')[0] ?? '';
    expect(section.length, 'docs/azure.md has no "### Callers" section').toBeGreaterThan(0);
    // The doc writes them as `POST /api/claude`; match the path, not the verb.
    const undocumented = EXPECTED.filter((e) => !section.includes(`${e.route}\``)).map((e) => e.route);
    expect(undocumented, 'Callers missing from docs/azure.md §4').toEqual([]);
  });

  it('every caller that claims the persona really imports it', () => {
    for (const e of EXPECTED) {
      const src = readFileSync(join(ROOT, e.file), 'utf8');
      const importsPersona = /from ['"]@\/lib\/aiPersona['"]/.test(src);
      expect(importsPersona, `${e.file}: persona=${e.persona} but import ${importsPersona ? 'present' : 'absent'}`).toBe(e.persona === 'yes');
    }
  });
});
