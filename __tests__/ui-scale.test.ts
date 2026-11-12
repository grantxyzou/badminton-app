import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { uiScaleOf, textScaleOf, screenScaleOf, uiScalePrepaint } from '../lib/uiScale';
import { PANE_QUERY } from '../lib/paneQuery';

/**
 * The app's one size factor (docs/plans/ui-scale.md; Grant: "no zoom, card
 * should scale", by text size AND screen). A phone at the default text size
 * must get exactly 1 — the whole design rests on that being pixel-identical.
 */
const ROOT = join(__dirname, '..');

/** Runs the pre-paint string the way the browser does, with a fake device. */
function runPrepaint(opts: { appleBodyPx: number | null; width: number; pane: boolean }) {
  const props: Record<string, string> = {};
  const d = {
    style: { setProperty: (k: string, v: string) => { props[k] = v; } },
    appendChild: () => {},
    removeChild: () => {},
  };
  const document = {
    hidden: false,
    addEventListener: () => {},
    createElement: () => {
      const style: Record<string, string> = {};
      return {
        style: new Proxy(style, {
          // A browser that does not know the keyword leaves `font` empty.
          set: (t, k: string, v: string) => { t[k] = k === 'font' && opts.appleBodyPx === null ? '' : v; return true; },
        }),
      };
    },
  };
  const getComputedStyle = () => ({ fontSize: `${opts.appleBodyPx}px` });
  const matchMedia = (q: string) => ({ matches: q === PANE_QUERY && opts.pane });
  new Function('d', 'document', 'getComputedStyle', 'innerWidth', 'matchMedia', 'addEventListener', uiScalePrepaint(PANE_QUERY))(
    d, document, getComputedStyle, opts.width, matchMedia, () => {},
  );
  return props['--ui-scale'];
}

describe('the size factor', () => {
  it('is exactly 1 on a phone at the default text size', () => {
    for (const w of [320, 375, 390, 430]) expect(uiScaleOf(17, w)).toBe(1);
    expect(uiScaleOf(null, 412)).toBe(1); // Android
  });

  it('follows the phone\'s Larger Text sizes and stops at 1.5', () => {
    expect(textScaleOf(19)).toBeCloseTo(1.118, 2); // xL
    expect(textScaleOf(23)).toBeCloseTo(1.353, 2); // xxxL
    expect(textScaleOf(53)).toBe(1.5); // the largest accessibility size
    // Smaller than default keeps the designed size.
    expect(textScaleOf(14)).toBe(1);
  });

  it('grows a little past the widest phone, by the width of ONE page', () => {
    expect(screenScaleOf(430)).toBe(1);
    expect(screenScaleOf(442)).toBe(1); // a page of an open Z Fold
    expect(screenScaleOf(475)).toBe(1); // a page of the Duo sideways
    expect(screenScaleOf(768)).toBeCloseTo(1.12, 5);
    expect(screenScaleOf(1280)).toBeCloseTo(1.12, 5);
    expect(screenScaleOf(599)).toBeGreaterThan(1);
  });

  it('runs the same rule in the pre-paint script', () => {
    const cases = [
      { appleBodyPx: 17, width: 390, pane: false },
      { appleBodyPx: 23, width: 390, pane: false },
      { appleBodyPx: null, width: 412, pane: false },
      { appleBodyPx: 17, width: 884, pane: true }, // Z Fold open: a page is 442
      { appleBodyPx: 17, width: 1180, pane: false },
      { appleBodyPx: 21, width: 1180, pane: true },
    ];
    for (const c of cases) {
      const expected = uiScaleOf(c.appleBodyPx, c.pane ? c.width / 2 : c.width);
      expect(Number(runPrepaint(c))).toBe(expected);
    }
  });
});

describe('the stylesheet and layout carry it', () => {
  const css = readFileSync(join(ROOT, 'app/globals.css'), 'utf8');

  it('sets the root size from the factor', () => {
    expect(css).toMatch(/\nhtml \{\s*font-size: calc\(100% \* var\(--ui-scale, 1\)\);\s*\}/);
  });

  it('writes every rung of the ladders in rem, except the hairlines and the pill', () => {
    const px = [...css.matchAll(/^\s*(--(?:fs|space|radius|icon)-[a-z0-9-]+):\s*([0-9.]+)px;/gm)].map((m) => m[1]);
    expect(px.sort()).toEqual(['--radius-pill', '--space-05', '--space-hair']);
  });

  it('keeps a px font size only where it is meant not to scale', () => {
    // The app's chrome stays put like iOS's own bars (the tab bar, the top
    // bar, the header toggles); the launch screen scales by --launch-k; the
    // courtside scoreboard is laid out to the pixel; an SVG label is in the
    // drawing's own units; the admin console's tiles are a non-goal.
    const FIXED = new Set([
      '.bpm-topbar__back .material-icons', '.bpm-topbar__crumb', '.rail-icon', '.rail-label',
      '.notif-toggle .material-icons', '.launch-wordmark', '.launch-tagline', '.launch-btn',
      '.terminal-sheet', '.terminal-titlebar', '.ss-head-lb', '.ss-done', '.fit-court-label',
      '.pill-admin', '.admin-hero .badge', '.admin-hero .ah-title', '.admin-hero .ah-subtitle',
      '.cc-tile .num', '.cc-tile .lbl', '.cc-tile .delta', '.cc-pill', '.cc-dcard .htitle',
      '.cc-dcard .htitle .material-icons', '.cc-dcard .big', '.cc-dcard .small',
    ]);
    const lines = css.split('\n');
    const fixed: string[] = [];
    lines.forEach((l, i) => {
      if (!/font-size:\s*[0-9.]+px/.test(l)) return;
      let j = i;
      while (!lines[j].includes('{')) j--;
      fixed.push(lines[j].slice(0, lines[j].indexOf('{')).trim());
    });
    expect(fixed.filter((s) => !FIXED.has(s))).toEqual([]);
  });

  it('runs the script before first paint, with the pane query', () => {
    const layout = readFileSync(join(ROOT, 'app/layout.tsx'), 'utf8');
    expect(layout).toContain('const UI_SCALE_PREPAINT = uiScalePrepaint(PANE_QUERY);');
    expect(layout).toContain('${QUICK_RETURN_PREPAINT}${UI_SCALE_PREPAINT}})()');
  });

  it('keeps pinch-to-zoom off (Grant: "no zoom")', () => {
    const layout = readFileSync(join(ROOT, 'app/layout.tsx'), 'utf8');
    expect(layout).toContain('maximumScale: 1,');
    expect(layout).toContain('userScalable: false,');
  });
});
