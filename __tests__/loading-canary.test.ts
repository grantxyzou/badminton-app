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
 * It began as a RATCHET — the offenders of the day listed, each phase of the
 * cascade deleting the ones it fixed — and phase 5 emptied it. The rule is
 * strict now: a new offender fails, with nowhere to list it.
 *
 * It is a heuristic over source text, not a parser: it sees `if (<loading
 * condition>) return null` on one line, in a file that fetches. A null return
 * shaped some other way will slip past it — the CLAUDE.md rule is the real
 * contract, and this is the tripwire for the common shape.
 */

const ROOT = join(__dirname, '..');

/**
 * The ratchet is EMPTY (loading cascade phase 5, 2026-10-05): every offender
 * listed when this canary landed has been fixed, so the rule is strict now — a
 * new offender fails, with no list to add it to.
 *
 * One standing exemption, with its reason. Not a backlog: nothing here is
 * waiting to be fixed.
 */
const OVERLAYS = new Set<string>([
  // The anomaly toasts render into `.toast-stack`, which is position: fixed —
  // they float over the page and hold no place in it, so there is no layout
  // for a skeleton to keep. Nothing while loading is correct for an overlay.
  'components/admin/CommandCenter/AnomalyFeed.tsx',
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
  // JSX, not the bare word: a comment saying "the RevealSlot holds this place"
  // matched the bare word and exempted a card that drew no skeleton at all.
  const drawsSkeleton = /<(CardSkeleton|RevealSlot)\b/.test(src);
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
    const fresh = offenders.filter((p) => !OVERLAYS.has(p));
    expect(
      fresh,
      'Render a skeleton the size of the card while it loads, or wrap it in a RevealSlot and call useRevealReady (components/primitives/Reveal.tsx).',
    ).toEqual([]);
  });

  it('no component shows "Loading…" text where a skeleton belongs', () => {
    const offenders = FILES.filter((f) => loadingText(f.src)).map((f) => f.path);
    expect(offenders, 'Use a CardSkeleton shaped like the content instead of "Loading…" text.').toEqual([]);
  });

  it('no "Loading…" copy in the messages', () => {
    expect(loadingCopy(), 'A loading state is a skeleton, not a sentence.').toEqual([]);
  });

  // An exemption must still be needed and still exist: a fixed or deleted file
  // left here would be a permanent pass nobody can tell from a live one.
  it('every overlay exemption is still an overlay that renders null while loading', () => {
    const byPath = new Map(FILES.map((f) => [f.path, f.src]));
    const stale = [...OVERLAYS].filter((p) => !byPath.has(p) || !nullWhileLoading(byPath.get(p)!));
    expect(stale, 'No longer needed — remove from OVERLAYS.').toEqual([]);
  });
});
