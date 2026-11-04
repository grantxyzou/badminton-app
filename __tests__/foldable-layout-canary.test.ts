import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Foldables get two panes; ONE phone-sized screen gets exactly what it had
 * (docs/plans/foldable-layout.md, Grant 2026-11-04: "without changing the
 * layout we have today when its on one screen").
 *
 * WHY A SOURCE SCAN. jsdom applies no stylesheet and evaluates no media query,
 * so no render test can see which layout a screen gets. What can be checked is
 * that the two-pane rules live ONLY inside the pane query, and that the rules
 * outside it resolve to today's values on a portrait phone. The pixel check
 * that it really is unchanged was done by hand (before/after screenshots at
 * 430, 412, 382, 669 and a 1280 desktop: zero differing pixels) and is in the
 * plan.
 */
const css = readFileSync(join(__dirname, '..', 'app', 'globals.css'), 'utf8');

const PANE_QUERY =
  '@media (min-width: 720px) and (min-height: 480px) and (pointer: coarse),\n       (horizontal-viewport-segments: 2) {';

/** The body of the block opened at `start` (the index of its `{`). */
function blockAt(text: string, open: number): string {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') {
      depth--;
      if (depth === 0) return text.slice(open + 1, i);
    }
  }
  throw new Error('unbalanced block');
}

/** Every top-level rule body for `selector`, outside any @media. */
function topLevelRules(selector: string): string[] {
  const out: string[] = [];
  let depth = 0;
  for (let i = 0; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}') depth--;
    else if (depth === 0 && css.startsWith(selector, i)) {
      const after = css.slice(i + selector.length).trimStart();
      if (after.startsWith('{')) out.push(blockAt(css, css.indexOf('{', i)));
    }
  }
  return out;
}

describe('foldable layout', () => {
  it('has exactly one pane query', () => {
    expect(css.split(PANE_QUERY).length - 1).toBe(1);
  });

  const pane = blockAt(css, css.indexOf(PANE_QUERY) + PANE_QUERY.length - 1);

  it('puts Home in two even columns with the gap in the middle, only inside the pane query', () => {
    expect(pane).toMatch(/\.bpm-home-stack\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
    expect(pane).toMatch(/column-gap:\s*var\(--fold-gap\)/);
    // Outside it, the stack is the one column it always was.
    const base = topLevelRules('.bpm-home-stack');
    expect(base.length).toBe(1);
    expect(base[0]).toMatch(/display:\s*flex/);
    expect(base[0]).toMatch(/flex-direction:\s*column/);
  });

  it('widens the page only while Home is the tab on screen', () => {
    expect(pane).toMatch(/main\[data-page-shell\]:has\(> \[data-tab-panel='home'\]:not\(\[hidden\]\)\)\s*\{\s*max-width:\s*var\(--panes-max-w\)/);
  });

  it('opens a sheet in the right half, and only there', () => {
    expect(pane).toMatch(/\.bottom-sheet\s*\{[^}]*margin-left:\s*calc\(50vw \+ var\(--fold-gap\) \/ 2\)/);
    expect(pane).toMatch(/--sheet-max-w:\s*min\(32rem,/);
  });

  it('keeps 16px page sides on a portrait phone, and the column centred under a side inset', () => {
    // Portrait phones report 0 for both side insets, so this is --space-5 (16px), Tailwind's px-4.
    expect(css).toMatch(/--shell-pad-x:\s*max\(var\(--space-5\), env\(safe-area-inset-left, 0px\), env\(safe-area-inset-right, 0px\)\);/);
    expect(topLevelRules('main[data-page-shell]').join('')).toMatch(/padding-inline:\s*var\(--shell-pad-x\)/);
  });

  it("draws Home's loading frame as the left pane", () => {
    const skeleton = readFileSync(join(__dirname, '..', 'components', 'primitives', 'CardSkeleton.tsx'), 'utf8');
    expect(skeleton).toMatch(/className="space-y-5 bpm-home-skeleton"/);
    expect(pane).toMatch(/\.bpm-home-skeleton\s*\{\s*max-width:\s*calc\(\(100% - var\(--fold-gap\)\) \/ 2\)/);
  });
});
