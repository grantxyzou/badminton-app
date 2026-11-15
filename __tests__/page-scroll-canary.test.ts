import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The DOCUMENT scrolls, not <body> (docs/plans/page-scroll.md, 2026-11-15).
 * `html, body { height: 100%; overflow-x: hidden }` made the body a
 * screen-sized scroll box, and on the App Store app the Admin console opened
 * under a screen of blank space. jsdom applies no stylesheet, so nothing else
 * in the suite can see this: it is a source scan of the base resets.
 */
const css = readFileSync(join(__dirname, '..', 'app', 'globals.css'), 'utf8');

function rule(selector: string): string {
  const at = css.indexOf(`${selector} {`);
  expect(at, `no "${selector} {" rule in globals.css`).toBeGreaterThanOrEqual(0);
  return css.slice(at, css.indexOf('}', at));
}

describe('the page scrolls, not the body', () => {
  it('the root rule clips sideways overflow without making a scroll box', () => {
    const root = rule('html,\nbody');
    expect(root).toMatch(/overflow-x:\s*clip/);
    // `hidden` alone forces overflow-y to `auto` and makes <body> the scroller.
    // It may stay only as the fallback line BEFORE `clip`.
    const hidden = root.indexOf('overflow-x: hidden');
    if (hidden >= 0) expect(hidden).toBeLessThan(root.indexOf('overflow-x: clip'));
  });

  it('nothing pins html or body to the screen height', () => {
    expect(rule('html,\nbody')).not.toMatch(/(^|[^-])height:\s*100%/m);
    expect(css).not.toMatch(/html\s*\{\s*height:\s*100lvh/);
    expect(css).toMatch(/html\s*\{\s*min-height:\s*100lvh/);
  });
});

describe('the swipe back never moves the page', () => {
  it('no swipe rule transforms or dims the page shell', () => {
    // It slid the cards out from under the sticky bar and made the bar's
    // frost see-through on the App Store app (2026-11-15).
    expect(css).not.toMatch(/data-swiping[^{]*\[data-page-shell\]\s*\{/);
  });
});
