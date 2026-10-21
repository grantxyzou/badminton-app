/**
 * Has the screen a signed-in member landed on finished loading?
 *
 * Asked of the DOM, not of each card: every loading frame in the app draws
 * `.shimmer-line` (`components/primitives/CardSkeleton.tsx`, the tab
 * fallbacks), so "no shimmer showing in the tab on screen" is "every card in it
 * has its data". Read by the launch screen, which waits for it before lifting
 * (so the first screen arrives whole), and by `HomeShell`, which waits for it
 * before mounting the other tabs (so their reads never compete with the first
 * screen's).
 *
 * VISIBLE shimmer only: a hidden tab, a collapsed section or a register not on
 * screen can hold a skeleton nobody is looking at. `getClientRects()` is empty
 * for anything under `display: none`.
 *
 * No app shell (Welcome, `/legal`, `/design`) or no tab panel (the onboarding
 * doors) is settled: there is nothing of ours still loading to wait for.
 */
export const APP_SHELL_ATTR = 'data-app-shell';
export const TAB_PANEL_ATTR = 'data-tab-panel';

export function appSettled(doc: Document): boolean {
  const shell = doc.querySelector(`[${APP_SHELL_ATTR}]`);
  if (!shell) return true;
  const panel = shell.querySelector(`[${TAB_PANEL_ATTR}]:not([hidden])`);
  if (!panel) return true;
  for (const el of Array.from(panel.querySelectorAll('.shimmer-line'))) {
    if (el.getClientRects().length > 0) return false;
  }
  return true;
}
