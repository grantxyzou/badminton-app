// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { QUICK_RETURN_KEY, QUICK_RETURN_MS, QUICK_RETURN_PREPAINT, forgetActive, isQuickReturn, noteActive } from '../lib/quickReturn';
import { clearDeviceTraces } from '../lib/clearDeviceTraces';

/**
 * Grant, 2026-11-05: slow when "switching apps". iOS drops the installed app
 * in the background, so coming back is a fresh load and the launch screen
 * replayed its whole shot. Back within half an hour skips it.
 */
const html = document.documentElement;
function runPrepaint(): void {
  // The script's own text, as app/layout.tsx inlines it (with `d` its <html>).
  new Function('d', QUICK_RETURN_PREPAINT)(html);
}

beforeEach(() => {
  localStorage.clear();
  html.setAttribute('data-launch', 'loading');
  html.removeAttribute('data-launch-skipped');
});

describe('a quick return skips the launch screen', () => {
  it('back within half an hour: the splash is lifted before it is drawn', () => {
    noteActive(Date.now() - 5 * 60 * 1000);
    expect(isQuickReturn()).toBe(true);
    runPrepaint();
    expect(html.getAttribute('data-launch')).toBe('lifted');
    expect(html.getAttribute('data-launch-skipped')).toBe('return');
  });

  it('a first open, or one after a long gap, keeps the full shot', () => {
    runPrepaint();
    expect(html.getAttribute('data-launch')).toBe('loading');
    noteActive(Date.now() - QUICK_RETURN_MS - 1000);
    expect(isQuickReturn()).toBe(false);
    runPrepaint();
    expect(html.getAttribute('data-launch')).toBe('loading');
  });

  it('a note from the future (a clock change) or not a number counts as a fresh open', () => {
    localStorage.setItem(QUICK_RETURN_KEY, String(Date.now() + 60_000));
    runPrepaint();
    expect(html.getAttribute('data-launch')).toBe('loading');
    localStorage.setItem(QUICK_RETURN_KEY, 'soon');
    runPrepaint();
    expect(html.getAttribute('data-launch')).toBe('loading');
  });

  it('sign-out forgets it, so the next person gets the full launch screen', async () => {
    noteActive();
    await clearDeviceTraces(10);
    expect(isQuickReturn()).toBe(false);
    forgetActive();
  });
});
