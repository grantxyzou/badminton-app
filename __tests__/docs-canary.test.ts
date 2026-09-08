import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
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

/** The documents that carry rules an agent or a contributor is expected to follow. */
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
