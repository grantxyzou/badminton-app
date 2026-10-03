import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * The loading rule (`docs/plans/loading-cascade.md`, CLAUDE.md → Design System
 * → "Loading"): while a card's data loads, its place is held by a skeleton the
 * size of the card — never by NOTHING (the card pops in later and shoves the
 * screen) and never by a "Loading…" line (text standing where a card will be).
 *
 * Inside a `RevealSlot` a card MAY render null while it loads, because the
 * slot shows the skeleton; such a card calls `useRevealReady`, and that is what
 * exempts it here.
 *
 * This is a RATCHET. Today's offenders are listed below and each phase of the
 * cascade deletes the ones it fixes. A NEW offender fails at once. When an
 * entry stops offending, the test fails too, until the entry is deleted — so
 * the list can only shrink. When both lists are empty, drop the ratchet and
 * keep the rule.
 *
 * It is a heuristic over source text, not a parser: it sees `if (<loading
 * condition>) return null` on one line, in a file that fetches. A null return
 * shaped some other way will slip past it — the CLAUDE.md rule is the real
 * contract, and this is the tripwire for the common shape.
 */

const ROOT = join(__dirname, '..');

/** Renders nothing while it loads. Phase that fixes each is noted. */
const NULL_WHILE_LOADING_BACKLOG = new Set<string>([
  'components/UnpaidSessionsCard.tsx', // phase 2 (Home)
  'components/stats/KudosReceivedCard.tsx', // phase 3 (Stats)
  'components/stats/NextRacketCard.tsx', // phase 3
  'components/stats/StringTensionCard.tsx', // phase 3
  'components/stringing/StringerJobsCard.tsx', // phase 4 (Stringing)
  'components/admin/CommandCenter/AnomalyFeed.tsx', // phase 5 (Admin)
  'components/admin/CommandCenter/AccessRequestsCard.tsx', // phase 5
  'components/admin/CommandCenter/SignInReadinessCard.tsx', // phase 5
  'components/admin/CommandCenter/PaymentsInboxCard.tsx', // phase 5 — added by #506 the same day
]);

/** Shows "Loading…" text where a skeleton belongs. */
const LOADING_TEXT_BACKLOG = new Set<string>([
  'components/admin/ReleasesView.tsx', // phase 5
  'components/admin/CommandCenter/PlayerProfileSheet.tsx', // phase 5
]);

/** messages/en.json copy that says "Loading…". */
const LOADING_COPY_BACKLOG = new Set<string>([
  'home.loading',
  'stats.kudos.loading',
  'players.loading',
]);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return walk(p);
    return p.endsWith('.tsx') ? [p] : [];
  });
}

const FILES = walk(join(ROOT, 'components')).map((abs) => ({
  path: relative(ROOT, abs),
  src: readFileSync(abs, 'utf8'),
}));

const FETCHES = /\b(fetch|apiFetch|sharedRead|sharedFetch)\(|\buse(Gear|GearPicks|ClubGear|Insight|CheckIn|StringingShop|SignInMethods)\(/;

/** State that starts empty: `const [x, setX] = useState<T | null>(null)`. */
function nullStates(src: string): string[] {
  return [...src.matchAll(/const \[(\w+), set\w+\] = useState<[^>]*\bnull\b[^>]*>\(null\)/g)].map((m) => m[1]);
}

function nullWhileLoading(src: string): boolean {
  if (/\buseRevealReady\(/.test(src)) return false;
  const empty = nullStates(src);
  // A file that already draws a skeleton has a loading branch; a null on
  // empty state there is a loaded-and-nothing-to-show, not a loading hole.
  const drawsSkeleton = /\b(CardSkeleton|RevealSlot)\b/.test(src);
  // Two-space indent = a component's own top-level guard, not a helper's.
  for (const m of src.matchAll(/^ {2}if \(([^\n]*)\) return null;?/gm)) {
    const cond = m[1];
    if (/\b(loading|isLoading|loaded)\b|[sS]tatus === 'loading'/.test(cond)) return true;
    if (!drawsSkeleton && FETCHES.test(src) && empty.some((v) => new RegExp(`(!${v}\\b|\\b${v} === null)`).test(cond))) {
      return true;
    }
  }
  return false;
}

function loadingText(src: string): boolean {
  // JSX text or a string literal reading "Loading…" / "Loading...".
  return /(>|['"`])\s*Loading(…|\.\.\.)/.test(src);
}

function loadingCopy(): string[] {
  const messages = JSON.parse(readFileSync(join(ROOT, 'messages', 'en.json'), 'utf8'));
  const out: string[] = [];
  (function visit(node: unknown, path: string) {
    if (typeof node === 'string') {
      if (/^Loading\b/i.test(node)) out.push(path);
    } else if (node && typeof node === 'object') {
      for (const [k, v] of Object.entries(node)) visit(v, path ? `${path}.${k}` : k);
    }
  })(messages, '');
  return out;
}

describe('loading rule: a skeleton holds the place, never nothing or "Loading…"', () => {
  it('no card renders null while it loads, unless a RevealSlot holds its place', () => {
    const offenders = FILES.filter((f) => nullWhileLoading(f.src)).map((f) => f.path);
    const fresh = offenders.filter((p) => !NULL_WHILE_LOADING_BACKLOG.has(p));
    expect(
      fresh,
      'Render a skeleton the size of the card while it loads, or wrap it in a RevealSlot and call useRevealReady (components/primitives/Reveal.tsx).',
    ).toEqual([]);
  });

  it('no component shows "Loading…" text where a skeleton belongs', () => {
    const offenders = FILES.filter((f) => loadingText(f.src)).map((f) => f.path);
    const fresh = offenders.filter((p) => !LOADING_TEXT_BACKLOG.has(p));
    expect(fresh, 'Use a CardSkeleton shaped like the content instead of "Loading…" text.').toEqual([]);
  });

  it('no new "Loading…" copy is added to the messages', () => {
    const fresh = loadingCopy().filter((k) => !LOADING_COPY_BACKLOG.has(k));
    expect(fresh, 'A loading state is a skeleton, not a sentence.').toEqual([]);
  });

  // The ratchet: a fixed file must leave its backlog, or the list rots into a
  // permanent exemption nobody can tell from a live one.
  it('every backlog entry still offends (delete the ones you fixed)', () => {
    const byPath = new Map(FILES.map((f) => [f.path, f.src]));
    const stale = [
      ...[...NULL_WHILE_LOADING_BACKLOG].filter((p) => !byPath.has(p) || !nullWhileLoading(byPath.get(p)!)),
      ...[...LOADING_TEXT_BACKLOG].filter((p) => !byPath.has(p) || !loadingText(byPath.get(p)!)),
      ...[...LOADING_COPY_BACKLOG].filter((k) => !loadingCopy().includes(k)),
    ];
    expect(stale, 'These are fixed — remove them from the backlog in this file.').toEqual([]);
  });
});
