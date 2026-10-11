import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { OWNED_CONTAINERS, NOT_MEMBER_SCOPED, CLASSIFIED_ELSEWHERE } from '@/lib/memberPurge';

/**
 * Docs canary — the governing documents' analogue of design-canary / ai-model-canary.
 *
 * This repo's most-repeated lesson is that a rule with no canary rots, and it
 * has been applied to flags, model IDs, spacing, i18n, member purge and Cosmos
 * SQL predicates — but never to the twelve documents that STATE the rules. They
 * are the only convention layer with no automated check at all, and it shows:
 * a scan on 2026-09-07 found six dead pointers, including CLAUDE.md's
 * "see `__tests__/components/PrevPaymentReminder.test.tsx` for the pattern"
 * (deleted), ROADMAP.md's two retired `soak.local.md` templates, and
 * `docs/voice-and-tone.md`'s link to the research that justifies the AI voice.
 * A pointer that goes dead is worse than no pointer: it reads as a citation, so
 * the rule looks sourced when the source is gone.
 *
 * WHAT THIS CANNOT DO, stated plainly so nobody mistakes it for more:
 *   - It checks that a path a doc NAMES still resolves. It cannot check that
 *     the path is the RIGHT one. `DESIGN.md` said the `data-tab` mirror lived
 *     in `app/page.tsx` for weeks after it moved to `components/HomeShell.tsx`;
 *     both files exist, so this test would have passed all the way through.
 *   - It cannot check a CLAIM one document makes about another. CLAUDE.md said
 *     "`ROADMAP.md` still carries the dual-deployment table" long after ROADMAP
 *     was fixed. That needs a reader.
 * It bounds one mechanically-checkable failure mode. That is the whole promise.
 *
 * Resolution is suffix-aware on a path boundary: docs legitimately write
 * `admin/route.ts` mid-sentence when the file is `app/api/admin/route.ts`, and
 * demanding a repo-root path everywhere would make the prose worse to read.
 */

/**
 * The documents an agent or a contributor is expected to read: the ones that
 * carry rules, and the records those rules point to. A history doc in this
 * list names paths too, so deleting a file it mentions needs a
 * DELIBERATELY_ABSENT entry or an edit to the history — the price of keeping
 * its pointers honest.
 */
const GOVERNING_DOCS = [
  'CLAUDE.md',
  'REVIEW.md',
  'PRODUCT.md',
  'DESIGN.md',
  'ROADMAP.md',
  'CONTRIBUTING.md',
  'README.md',
  'components/stats/CLAUDE.md',
  'docs/voice-and-tone.md',
  'docs/plans/TEMPLATE.md',
  'docs/design-system/README.md',
  'docs/OWNER-KB.md',
  'docs/review-bot.md',
  'docs/flag-retirements.md',
  'docs/gotchas-history.md',
];

/**
 * Paths named ON PURPOSE while absent. Every entry carries its reason — a bare
 * regex that skipped anything near the word "deleted" would also skip the next
 * genuine rot, and the reason is what a future reader needs to decide whether
 * the exemption still holds.
 */
const DELIBERATELY_ABSENT: Record<string, string> = {
  'deploy-stable.yml': 'The second deployment’s workflow, deleted 2026-08-25. Four docs name it to say it is gone.',
  'lib/recoveryCodes.ts': 'CLAUDE.md names it precisely BECAUSE it was deleted — the stale warning it carried outlived it.',
  'middleware.ts': 'The pre-Next-16 name of `proxy.ts`. Named to explain the rename.',
  'google-services.json': 'Firebase config, deliberately never committed (see the Native Shell section).',
  'feedback_cosmos_silent_failure_diagnosis.md': 'Lives in the agent memory directory, outside this repo.',
};

/** `.md` links and URLs are not file references; neither is a served asset path. */
const PATH_IN_BACKTICKS = /`([A-Za-z0-9_@./-]+\.(?:ts|tsx|mjs|js|css|json|yml|yaml|md|sh|html|py))`/g;

/** Tracked files, for the suffix match. `git ls-files` also keeps node_modules out. */
const TRACKED = new Set(
  execFileSync('git', ['ls-files'], { cwd: process.cwd(), encoding: 'utf8' }).split('\n').filter(Boolean),
);

function resolves(p: string): boolean {
  // A rooted path is a URL (`/bpm/sw.js`), not a repo path.
  if (p.startsWith('/') || p.startsWith('http')) return true;
  if (existsSync(join(process.cwd(), p))) return true;
  return [...TRACKED].some((t) => t.endsWith(`/${p}`));
}

interface Ref { doc: string; path: string }

const refs: Ref[] = GOVERNING_DOCS.flatMap((doc) => {
  const src = readFileSync(join(process.cwd(), doc), 'utf8');
  return [...new Set(Array.from(src.matchAll(PATH_IN_BACKTICKS), (m) => m[1]))].map((path) => ({ doc, path }));
});

describe('docs canary — every path a governing doc names still resolves', () => {
  it('every governing doc exists', () => {
    // A renamed doc would otherwise drop out of the scan silently.
    for (const doc of GOVERNING_DOCS) {
      expect(existsSync(join(process.cwd(), doc)), doc).toBe(true);
    }
  });

  it('extracts a non-trivial number of path references', () => {
    // Guards the guard: a broken regex makes every assertion below vacuous.
    expect(refs.length).toBeGreaterThan(150);
  });

  it('names no file that has gone missing', () => {
    const dead = refs
      .filter((r) => !(r.path in DELIBERATELY_ABSENT))
      .filter((r) => !resolves(r.path))
      .map((r) => `${r.doc} → ${r.path}`);
    expect(dead).toEqual([]);
  });

  it('documents every Cosmos container the code knows about', () => {
    /**
     * The path scan above cannot catch this failure — it is a COUNT going stale,
     * not a dead path. CLAUDE.md listed 8 containers while the code had 23, for
     * months, and every path in that sentence resolved perfectly the whole time.
     *
     * `lib/memberPurge.ts` is the authoritative set because a deletion request has
     * to account for every container, and `member-purge-coverage.test.ts` fails the
     * build when one appears in none of its three lists. So the code already
     * maintains a complete list; this just ties the documentation to it.
     *
     * Names only. Partition keys are NOT checkable here: `memberPurge`'s `OWNED`
     * table carries `pk` as data but exports only `.map(t => t.container)`, and six
     * containers predate `ensureContainer` and have no declaration anywhere in the
     * repo (their keys live in the Azure portal). CLAUDE.md says which six.
     */
    const authoritative = [
      ...OWNED_CONTAINERS,
      ...Object.keys(NOT_MEMBER_SCOPED),
      ...Object.keys(CLASSIFIED_ELSEWHERE),
    ];

    const claudeMd = readFileSync(join(process.cwd(), 'CLAUDE.md'), 'utf8');
    const start = claudeMd.indexOf('- **Cosmos DB**: Use `getContainer(name)`');
    expect(start, 'the Cosmos DB bullet moved or was reworded').toBeGreaterThan(-1);
    // The bullet plus its indented sub-bullets, up to the next top-level bullet.
    const nextTop = claudeMd.indexOf('\n- ', start + 1);
    const block = claudeMd.slice(start, nextTop === -1 ? undefined : nextTop);

    const undocumented = authoritative.filter((c) => !block.includes(`\`${c}\``)).sort();
    expect(
      undocumented,
      'CLAUDE.md\'s Cosmos DB bullet is missing these containers:\n  ' +
        `${undocumented.join('\n  ')}\n` +
        'Add each one under its partition key. If you just created a container, it also ' +
        'needs a home in lib/memberPurge.ts — a deletion request must account for it.',
    ).toEqual([]);

    // The stated total is the other half: a count nobody updates is how this drifted.
    const stated = block.match(/There are (\d+) containers/);
    expect(stated, 'the bullet no longer states a container count').not.toBeNull();
    expect(Number(stated![1]), 'the stated count disagrees with lib/memberPurge.ts').toBe(
      authoritative.length,
    );

    // A container listed under two partition keys is worse than one listed under none.
    for (const c of authoritative) {
      const hits = block.split(`\`${c}\``).length - 1;
      expect(hits, `${c} appears ${hits}× in the bullet — it has one partition key`).toBeLessThan(3);
    }
  });

  it('keeps the deliberately-absent list honest', () => {
    // An entry that starts resolving again is an exemption nobody needs. Left
    // in place it would hide the next real deletion of that same path.
    const resurrected = Object.keys(DELIBERATELY_ABSENT).filter((p) => resolves(p));
    expect(resurrected).toEqual([]);

    // And an entry nothing references any more is dead weight in the list.
    const named = new Set(refs.map((r) => r.path));
    const unused = Object.keys(DELIBERATELY_ABSENT).filter((p) => !named.has(p));
    expect(unused).toEqual([]);
  });
});

/**
 * NUMERIC claims CLAUDE.md makes about the tree. A path that stops resolving
 * is caught above; a number that stops being true is not, and the audit of
 * 2026-09-28 found six of ten sampled ones stale ("279 test files" with 404
 * in the tree, "~31 BottomSheet consumers" with 48, "zero escape hatches"
 * with eight). Each pin below names the sentence it holds to, with the
 * tolerance the claim deserves: a count that moves with every PR is held
 * within a band, one that moves only by decision is held exactly.
 */
describe('docs canary — the numbers CLAUDE.md states about the tree', () => {
  const claude = readFileSync(join(process.cwd(), 'CLAUDE.md'), 'utf8');

  function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full, out);
      else out.push(full);
    }
    return out;
  }
  const within = (stated: number, actual: number, tolerance: number) =>
    Math.abs(stated - actual) <= Math.ceil(actual * tolerance);

  it('the stated test-file count is within 10% of the tree', () => {
    const m = claude.match(/\*\*(\d+) test files \/ ~?[\d,]+ tests\*\*/);
    expect(m, 'CLAUDE.md no longer states a test-file count in the pinned form').not.toBeNull();
    const stated = Number(m![1]);
    const actual = walk(join(process.cwd(), '__tests__')).filter((f) => /\.test\.tsx?$/.test(f)).length;
    expect(within(stated, actual, 0.1), `CLAUDE.md says ${stated} test files; the tree has ${actual}`).toBe(true);
  });

  it('the stated BottomSheet consumer count is within 25% of the tree', () => {
    const m = claude.match(/\*\*(\d+) consumers\*\*/);
    expect(m, 'CLAUDE.md no longer states a BottomSheet consumer count in the pinned form').not.toBeNull();
    const stated = Number(m![1]);
    const actual = [...walk(join(process.cwd(), 'components')), ...walk(join(process.cwd(), 'app'))]
      .filter((f) => /\.tsx?$/.test(f))
      .filter((f) => readFileSync(f, 'utf8').includes('<BottomSheet')).length;
    expect(within(stated, actual, 0.25), `CLAUDE.md says ${stated} consumers; the tree has ${actual}`).toBe(true);
  });

  it('the stated no-restricted-syntax escape-hatch count is exact', () => {
    const m = claude.match(/\*\*(\d+)\*\* files carrying a `no-restricted-syntax` escape hatch/);
    expect(m, 'CLAUDE.md no longer states the escape-hatch count in the pinned form').not.toBeNull();
    const stated = Number(m![1]);
    const actual = ['app', 'lib', 'components']
      .flatMap((d) => walk(join(process.cwd(), d)))
      .filter((f) => /\.tsx?$/.test(f))
      .filter((f) => /eslint-disable[^\n]*no-restricted-syntax/.test(readFileSync(f, 'utf8'))).length;
    expect(stated, `CLAUDE.md says ${stated} files carry an escape hatch; the tree has ${actual}`).toBe(actual);
  });
});

/**
 * SENTENCE-level pins. The 2026-10-10 audit found nine stale claims by hand;
 * three of them a regex could have caught: a count typed from memory (the
 * audit itself turned a correct "nine" into "eight"), a retired flag described
 * as live, and a date in the future. Each check below is the shape of one of
 * those. What a regex cannot hold — "Cold starts (Free tier)" on an Always-On
 * plan, a flip described as upcoming after it happened — still needs a reader.
 */
describe('docs canary — the sentences a regex can hold', () => {
  const claude = readFileSync(join(process.cwd(), 'CLAUDE.md'), 'utf8');
  const WORDS: Record<string, number> = {
    one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  };
  const asNumber = (w: string) => WORDS[w.toLowerCase()] ?? Number(w);
  const docLines = (doc: string) => readFileSync(join(process.cwd(), doc), 'utf8').split('\n');

  it('the stated scripts/ check count matches the describe blocks in scripts.test.ts', () => {
    const m = claude.match(/\*\*The (\w+) `scripts\/` checks are tested\*\*/);
    expect(m, 'CLAUDE.md no longer states the scripts/ check count in the pinned form').not.toBeNull();
    const src = readFileSync(join(process.cwd(), '__tests__/hooks/scripts.test.ts'), 'utf8');
    const actual = (src.match(/^describe\('[\w-]+\.mjs/gm) ?? []).length;
    expect(asNumber(m![1]), `CLAUDE.md says ${m![1]} scripts/ checks; scripts.test.ts has ${actual} describe blocks`).toBe(actual);
  });

  it('the stated hook count matches .claude/settings.json', () => {
    const m = claude.match(/\*\*Automation hooks\*\* \([^)]*\): (\w+),/);
    expect(m, 'CLAUDE.md no longer states the hook count in the pinned form').not.toBeNull();
    const settings = readFileSync(join(process.cwd(), '.claude/settings.json'), 'utf8');
    const actual = (settings.match(/"command": "/g) ?? []).length;
    expect(asNumber(m![1]), `CLAUDE.md says ${m![1]} hooks; settings.json registers ${actual}`).toBe(actual);
  });

  it('a flag a governing doc names is in lib/flags.ts, or the line says it is retired', () => {
    const registry = new Set(
      Array.from(readFileSync(join(process.cwd(), 'lib/flags.ts'), 'utf8').matchAll(/(NEXT_PUBLIC_FLAG_[A-Z0-9_]+): \{/g), (m) => m[1]),
    );
    expect(registry.size, 'the FLAGS registry parse found nothing').toBeGreaterThan(5);
    const offenders: string[] = [];
    for (const doc of GOVERNING_DOCS) {
      // Every row of the retirements table is a retired flag by construction.
      if (doc === 'docs/flag-retirements.md') continue;
      docLines(doc).forEach((line, i) => {
        for (const [flag] of line.matchAll(/NEXT_PUBLIC_FLAG_[A-Z0-9_]+/g)) {
          if (flag === 'NEXT_PUBLIC_FLAG_X' || registry.has(flag) || /retir/i.test(line)) continue;
          offenders.push(`${doc}:${i + 1} names ${flag}, which is not in lib/flags.ts, without saying it is retired`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });

  it('no governing doc dates an event after the commit it lives in', () => {
    // The commit date is deterministic where `new Date()` is not.
    const head = execFileSync('git', ['log', '-1', '--format=%cs'], { cwd: process.cwd(), encoding: 'utf8' }).trim();
    const offenders: string[] = [];
    for (const doc of GOVERNING_DOCS) {
      docLines(doc).forEach((line, i) => {
        for (const [, verb, date] of line.matchAll(/\b(since|retired|shipped|fixed|landed|merged|deleted|moved)\s+(\d{4}-\d{2}-\d{2})/gi)) {
          if (date > head) offenders.push(`${doc}:${i + 1} says "${verb} ${date}", after the commit date ${head}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });
});
