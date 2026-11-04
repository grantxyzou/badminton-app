// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import PaneFlip from '../components/PaneFlip';
import { PANE_FLIP_ATTR, PANE_QUERY } from '../lib/paneMode';

/**
 * The fold/unfold crossfade (lib/paneMode.ts): `data-pane-flip` alternates on
 * <html> each time the screen crosses the pane condition, and never on mount.
 * The CSS half is two identical keyframes under two names, which is the only
 * way a CSS animation replays; the canary below pins the attribute, the two
 * names and the reduced-motion keep to the stylesheet, and the query to the
 * CSS pane block, verbatim.
 */
type Listener = () => void;

function stubMatchMedia(matches: boolean) {
  const listeners: Listener[] = [];
  const mql = {
    matches,
    media: PANE_QUERY,
    addEventListener: (_: 'change', cb: Listener) => {
      listeners.push(cb);
    },
    removeEventListener: (_: 'change', cb: Listener) => {
      listeners.splice(listeners.indexOf(cb), 1);
    },
  };
  const matchMedia = vi.fn(() => mql);
  vi.stubGlobal('matchMedia', matchMedia);
  return { listeners, matchMedia };
}

describe('PaneFlip', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    document.documentElement.removeAttribute(PANE_FLIP_ATTR);
  });

  it('subscribes to the pane query and sets nothing on mount', () => {
    const { matchMedia, listeners } = stubMatchMedia(false);
    render(<PaneFlip />);
    expect(matchMedia).toHaveBeenCalledWith(PANE_QUERY);
    expect(listeners).toHaveLength(1);
    expect(document.documentElement.hasAttribute(PANE_FLIP_ATTR)).toBe(false);
  });

  it('alternates a / b on every change, so the fade replays each time', () => {
    const { listeners } = stubMatchMedia(false);
    render(<PaneFlip />);
    act(() => listeners.forEach((cb) => cb()));
    expect(document.documentElement.getAttribute(PANE_FLIP_ATTR)).toBe('a');
    act(() => listeners.forEach((cb) => cb()));
    expect(document.documentElement.getAttribute(PANE_FLIP_ATTR)).toBe('b');
    act(() => listeners.forEach((cb) => cb()));
    expect(document.documentElement.getAttribute(PANE_FLIP_ATTR)).toBe('a');
  });

  it('unsubscribes and clears the attribute on unmount', () => {
    const { listeners } = stubMatchMedia(true);
    const { unmount } = render(<PaneFlip />);
    act(() => listeners.forEach((cb) => cb()));
    unmount();
    expect(listeners).toHaveLength(0);
    expect(document.documentElement.hasAttribute(PANE_FLIP_ATTR)).toBe(false);
  });

  it('does nothing where matchMedia does not exist', () => {
    vi.stubGlobal('matchMedia', undefined);
    expect(() => render(<PaneFlip />)).not.toThrow();
  });

  it('is the same query as the CSS pane block, and the stylesheet carries both keyframes and the reduced-motion keep', () => {
    const css = readFileSync(join(__dirname, '..', 'app', 'globals.css'), 'utf8');
    // The CSS block writes the query over two lines with a leading `@media ` and
    // an indented second condition; compare whitespace-normalised.
    const flat = css.replace(/\s+/g, ' ');
    expect(flat).toContain(`@media ${PANE_QUERY} {`);
    expect(css).toMatch(/html\[data-pane-flip='a'\] \[data-app-shell\]\s*\{\s*animation:\s*paneFlipA/);
    expect(css).toMatch(/html\[data-pane-flip='b'\] \[data-app-shell\]\s*\{\s*animation:\s*paneFlipB/);
    expect(css).toMatch(/@keyframes paneFlipA\s*\{\s*from\s*\{\s*opacity:\s*0;\s*\}\s*to\s*\{\s*opacity:\s*1;\s*\}\s*\}/);
    // Opacity only, so reduced motion keeps it (the `.motion-fade` rule).
    const reduced = css.slice(css.indexOf('@keyframes paneFlipA'));
    expect(reduced).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{\s*html\[data-pane-flip='a'\] \[data-app-shell\]\s*\{\s*animation:[^}]*!important/);
    expect(css).toContain('[data-pane-flip');
  });
});
