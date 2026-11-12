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
 * 430, 412, 382, 669, a 932×430 phone held sideways and a 1280 desktop: zero
 * differing pixels) and is in the plan.
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
    // At the start of a line, so `.rail-bar` does not match `html:root .rail-bar`.
    else if (depth === 0 && (i === 0 || css[i - 1] === '\n') && css.startsWith(selector, i)) {
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

  it('never lets a banner span both panes (Grant, 2026-11-04: "NEVER")', () => {
    // Nothing in the pane block may stretch across the grid's two columns.
    expect(pane).not.toMatch(/grid-column:\s*1\s*\/\s*-1/);
    expect(pane).not.toMatch(/grid-column:\s*span\s*2/);
    // The week alone on the RIGHT — the page that opens (Grant, 2026-11-04);
    // everything else — the nudges included — on the left.
    expect(pane).toMatch(/\.bpm-home-stack > \.bpm-home-week\s*\{\s*grid-column:\s*2;\s*grid-row:\s*1 \/ -1;/);
    expect(pane).toMatch(/\.bpm-home-stack > :not\(\.bpm-home-week\)\s*\{\s*grid-column:\s*1;/);
    // Every version of the week's group carries the class, or one would fall into the left pane.
    const home = readFileSync(join(__dirname, '..', 'components', 'HomeTab.tsx'), 'utf8');
    const weekGroups = home.match(/className="bpm-home-group[^"]*" aria-label=\{t\('groups\.session'\)\}/g) ?? [];
    expect(weekGroups.length).toBeGreaterThan(0);
    for (const g of weekGroups) expect(g).toContain('bpm-home-week');
    // The floating notices take the LEFT half like a sheet, off the week.
    expect(pane).toMatch(/\.bottom-sheet,\s*\.toast-stack,\s*\.top-toast\s*\{\s*margin-left:\s*var\(--shell-pad-x\);\s*margin-right:\s*auto;/);
  });

  it('is the last rule block in the file, so it outranks the rules it moves', () => {
    // .toast-stack and .top-toast are defined late; at equal specificity the later rule wins.
    // The base rules, at the start of a line (the pane block's own copies are indented).
    expect(css.indexOf('\n.top-toast {')).toBeGreaterThan(0);
    expect(css.indexOf(PANE_QUERY)).toBeGreaterThan(css.lastIndexOf('\n.top-toast {'));
    expect(css.indexOf(PANE_QUERY)).toBeGreaterThan(css.lastIndexOf('\n.toast-stack {'));
    expect(css.indexOf(PANE_QUERY)).toBeGreaterThan(css.lastIndexOf('\n.bottom-sheet {'));
  });

  it('moves the tab bar to the right edge only on a wide, landscape, two-pane screen', () => {
    const SIDE_QUERY =
      '@media (min-width: 720px) and (min-height: 480px) and (pointer: coarse) and (orientation: landscape),\n       (horizontal-viewport-segments: 2) and (orientation: landscape) {';
    expect(css.split(SIDE_QUERY).length - 1).toBe(1);
    const side = blockAt(css, css.indexOf(SIDE_QUERY) + SIDE_QUERY.length - 1);
    expect(side).toMatch(/\.rail-bar\s*\{[^}]*flex-direction:\s*column/);
    expect(side).toMatch(/\.rail-bar\s*\{[^}]*right:\s*0/);
    // The pill glides down, not across.
    expect(side).toMatch(/transform:\s*translateY\(calc\(var\(--ri, 0\) \* var\(--rail-side-tab-h\)\)\)/);
    // Padding grows on BOTH sides by the strip, so the panes' gap stays centred on the fold.
    expect(side).toMatch(/--shell-pad-x:\s*max\(/);
    // Outside it, the tab bar is the bottom row it always was.
    const base = topLevelRules('.rail-bar');
    expect(base.length).toBe(1);
    expect(base[0]).toMatch(/bottom:\s*0/);
    expect(base[0]).not.toMatch(/flex-direction:\s*column/);
  });

  it('puts Home in two even columns with the gap in the middle, only inside the pane query', () => {
    expect(pane).toMatch(/\.bpm-home-stack\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
    expect(pane).toMatch(/column-gap:\s*var\(--fold-gap\)/);
    // Outside it, the stack is the one column it always was.
    const base = topLevelRules('.bpm-home-stack');
    expect(base.length).toBe(1);
    expect(base[0]).toMatch(/display:\s*flex/);
    expect(base[0]).toMatch(/flex-direction:\s*column/);
  });

  it('widens the page only while Home or Stats is the tab on screen', () => {
    expect(pane).toMatch(
      /main\[data-page-shell\]:has\(> \[data-tab-panel='home'\]:not\(\[hidden\]\)\),\s*main\[data-page-shell\]:has\(> \[data-tab-panel='skills'\]:not\(\[hidden\]\)\)\s*\{\s*max-width:\s*var\(--panes-max-w\)/,
    );
  });

  it('puts Stats in two panes: the overview left, the switch and the register right (Grant, 2026-11-12)', () => {
    expect(pane).toMatch(/\.stats-shell\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)[^}]*column-gap:\s*var\(--fold-gap\)/);
    expect(pane).toMatch(/\.stats-shell > \*\s*\{\s*grid-column:\s*1;/);
    expect(pane).toMatch(/\.stats-shell > \.stats-shell-switch\s*\{\s*grid-column:\s*2;\s*grid-row:\s*2;/);
    expect(pane).toMatch(/\.stats-shell > \.stats-shell-register\s*\{\s*grid-column:\s*2;\s*grid-row:\s*3 \/ -1;/);
    // Outside the pane block the classes draw nothing: one screen keeps its column.
    expect(topLevelRules('.stats-shell').length).toBe(0);
    // The shell and its loading frame carry the same three classes, or the
    // chunk arriving on an unfolded phone would move the page.
    for (const file of [['components', 'stats', 'StatsV2Shell.tsx'], ['components', 'TabFallbacks.tsx']]) {
      const src = readFileSync(join(__dirname, '..', ...file), 'utf8');
      expect(src).toMatch(/className="space-y-5 w-full stats-shell"/);
      expect(src).toMatch(/className="stats-shell-switch"/);
      expect(src).toMatch(/stats-shell-register"/);
    }
  });

  it('opens a sheet in the left half, and only there', () => {
    expect(pane).toMatch(/\.bottom-sheet,[^{]*\{\s*margin-left:\s*var\(--shell-pad-x\);/);
    expect(pane).toMatch(/--sheet-max-w:\s*min\(32rem, var\(--half-w\)\)/);
    // Outside the pane block the sheet is still centred (margin-inline: auto).
    expect(topLevelRules('.bottom-sheet').join('')).toMatch(/margin-inline:\s*auto/);
  });

  it('keeps 16px page sides on a portrait phone, and the column centred under a side inset', () => {
    // Portrait phones report 0 for both side insets, so this is --space-5 (16px), Tailwind's px-4.
    expect(css).toMatch(/--shell-pad-x:\s*max\(var\(--space-5\), env\(safe-area-inset-left, 0px\), env\(safe-area-inset-right, 0px\)\);/);
    expect(topLevelRules('main[data-page-shell]').join('')).toMatch(/padding-inline:\s*var\(--shell-pad-x\)/);
  });

  it("draws Home's loading frame as the right pane", () => {
    const skeleton = readFileSync(join(__dirname, '..', 'components', 'primitives', 'CardSkeleton.tsx'), 'utf8');
    expect(skeleton).toMatch(/className="space-y-5 bpm-home-skeleton"/);
    expect(pane).toMatch(/\.bpm-home-skeleton\s*\{\s*max-width:\s*calc\(\(100% - var\(--fold-gap\)\) \/ 2\);\s*margin-left:\s*auto;/);
  });
});
