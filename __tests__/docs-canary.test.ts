import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

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
