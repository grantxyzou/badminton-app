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

  it("puts You's greeting on the left page, under the tiles (Grant, 2026-11-12)", () => {
    // Four rows on the left: title, subhead, tiles, greeting; the last 1fr.
    expect(pane).toMatch(/\.stats-shell\s*\{[^}]*grid-template-rows:\s*auto auto auto auto 1fr/);
    // The greeting is a SHELL child (so `.stats-shell > *` puts it in column 1),
    // never a card inside the register, which sits whole in column 2.
    const tab = readFileSync(join(__dirname, '..', 'components', 'SkillsTab.tsx'), 'utf8');
    expect(tab).toMatch(/youLead=\{\s*<RevealSlot className="stats-shell-lead"/);
    const youLead = tab.slice(tab.indexOf('youLead={'), tab.indexOf('youSlot={'));
    expect(youLead).toContain('<SummaryGreeting />');
    const youSlot = tab.slice(tab.indexOf('youSlot={'), tab.indexOf('playSlot='));
    expect(youSlot).not.toContain('<SummaryGreeting');
    // Between the switch and the register, so one screen keeps its order.
    const shell = readFileSync(join(__dirname, '..', 'components', 'stats', 'StatsV2Shell.tsx'), 'utf8');
    const lead = shell.indexOf("{view === 'you' && !takeover && youLead}");
    expect(lead).toBeGreaterThan(shell.indexOf('className="stats-shell-switch"'));
    expect(lead).toBeLessThan(shell.indexOf('stats-shell-register"'));
    // The loading frame draws the greeting's skeleton in the same place.
    const fallback = readFileSync(join(__dirname, '..', 'components', 'TabFallbacks.tsx'), 'utf8');
    expect(fallback).toMatch(/<div className="stats-shell-lead">\s*<CardSkeleton height=\{STATS_HEIGHTS\.greeting\} \/>/);
  });

  it('puts Stringing in two pages: the list left, what it opens right (Grant, 2026-11-12, "Option 2")', () => {
    // The page widens only while the right page shows something — never a
    // nested :has(), which a browser drops as invalid (the first cut did, and
    // the two pages came out 216px wide).
    expect(pane).toContain(
      "main[data-page-shell]:has(> [data-tab-panel='stringing']:not([hidden]) .stringing-aside > * > :not([hidden])) {\n    max-width: var(--panes-max-w);",
    );
    expect(pane).toMatch(/\.stringing-shell:has\(> \.stringing-aside > \* > :not\(\[hidden\]\)\)\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)[^}]*grid-template-rows:\s*auto auto 1fr[^}]*column-gap:\s*var\(--fold-gap\)/);
    expect(pane).toMatch(/\.stringing-shell > \*\s*\{\s*grid-column:\s*1;/);
    // From the switch's row, clear of the round buttons over the right pane.
    expect(pane).toMatch(/\.stringing-shell > \.stringing-aside\s*\{\s*grid-column:\s*2;\s*grid-row:\s*2 \/ -1;/);
    expect(pane).toMatch(/\.stringing-shell > \.stringing-aside:not\(:has\(> \* > :not\(\[hidden\]\)\)\)\s*\{\s*display:\s*none;/);
    // Outside the pane block none of it exists: one screen keeps its column.
    expect(topLevelRules('.stringing-shell').length).toBe(0);
    expect(topLevelRules('.stringing-aside').length).toBe(0);
    // The tab renders the right page only in two-page mode, LAST, and reads
    // the mode from the shared query, never the window's width.
    const tab = readFileSync(join(__dirname, '..', 'components', 'StringingTab.tsx'), 'utf8');
    expect(tab).toMatch(/className="space-y-5 w-full stringing-shell"/);
    expect(tab).toMatch(/\{pane && <div ref=\{setAsideEl\} className="stringing-aside" \/>\}\s*<\/div>\s*<\/StringingAsideProvider>/);
    expect(tab).toContain('usePaneMode()');
    expect(tab).not.toMatch(/innerWidth/);
    // Each register opens its first thing on the right page by default.
    const bench = readFileSync(join(__dirname, '..', 'components', 'admin', 'CommandCenter', 'StringingPage.tsx'), 'utf8');
    expect(bench).toMatch(/jobs\.find\(\(j\) => j\.id === selectedId\) \?\? jobs\[0\]/);
    const shelf = readFileSync(join(__dirname, '..', 'components', 'stringing', 'StringsWeOfferCard.tsx'), 'utf8');
    expect(shelf).toMatch(/\[openEntry, selected, \.\.\./);
    expect(shelf).toMatch(/open=\{!aside && openEntry\?\.item != null\}/);
    const card = readFileSync(join(__dirname, '..', 'components', 'stringing', 'StringingCard.tsx'), 'utf8');
    expect(card).toContain('{!aside && racketCards}');
  });

  it('puts Profile and Admin in two pages: the list left, the opened page right (2026-11-12)', () => {
    // Widened only while the two-page shell is rendered, which is pane-only.
    expect(pane).toContain("main[data-page-shell]:has(> [data-tab-panel='profile']:not([hidden]) .profile-shell) {\n    max-width: var(--panes-max-w);");
    expect(pane).toContain("main[data-page-shell]:has(> [data-tab-panel='admin']:not([hidden]) .admin-shell) {\n    max-width: var(--panes-max-w);");
    expect(pane).toMatch(/\.profile-shell\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)[^}]*column-gap:\s*var\(--fold-gap\)/);
    expect(pane).toMatch(/\.profile-shell > \.profile-detail\s*\{\s*grid-column:\s*2;\s*grid-row:\s*2;/);
    expect(pane).toMatch(/\.admin-shell\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)[^}]*column-gap:\s*var\(--fold-gap\)/);
    for (const cls of ['.profile-shell', '.profile-detail', '.admin-shell']) expect(topLevelRules(cls).length).toBe(0);
    // Both read two-page mode from the shared query and open a page by default.
    const profile = readFileSync(join(__dirname, '..', 'components', 'ProfileTab.tsx'), 'utf8');
    expect(profile).toContain('usePaneMode()');
    expect(profile).toContain("const detailView: typeof view = view === 'root' ? 'profile' : view;");
    expect(profile).toMatch(/if \(!twoPages\) \{\s*const sub = subScreen\(view\);\s*if \(sub\) return sub;/);
    const admin = readFileSync(join(__dirname, '..', 'components', 'admin', 'AdminDashboard.tsx'), 'utf8');
    expect(admin).toContain('usePaneMode()');
    expect(admin).toContain("const rightView: AdminView = view === 'dashboard' ? 'members' : view;");
    expect(admin).toContain('const subPage = pane ? null : pageFor(view);');
    for (const src of [profile, admin]) expect(src).not.toMatch(/innerWidth/);
  });

  it('opens a right page from the fold, and keeps only the fade under reduced motion', () => {
    expect(css).toMatch(/@keyframes panePageOpen\s*\{\s*from\s*\{\s*opacity:\s*0;\s*transform:\s*translateX\(calc\(-1 \* var\(--space-5\)\)\);\s*\}\s*to\s*\{\s*opacity:\s*1;\s*transform:\s*none;/);
    expect(css).toMatch(/\.pane-page-open\s*\{\s*animation:\s*panePageOpen var\(--duration-normal\) var\(--ease-out-quart\) backwards;/);
    // Given back as a plain fade, like `.motion-fade`.
    expect(css).toMatch(/\.motion-fade,\s*\.pane-page-open,[^{]*\{\s*animation:\s*motionFade var\(--duration-fast\) ease-out backwards !important;/);
    // Every right page uses it.
    const files = [
      ['components', 'stringing', 'StringingAside.tsx'],
      ['components', 'ProfileTab.tsx'],
      ['components', 'admin', 'AdminDashboard.tsx'],
    ];
    for (const f of files) expect(readFileSync(join(__dirname, '..', ...f), 'utf8')).toContain('pane-page-open');
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
