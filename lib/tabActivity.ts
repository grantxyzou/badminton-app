'use client';

import { createContext, useContext, useEffect, useRef } from 'react';

/**
 * Is the tab this component lives in the one on screen?
 *
 * Tabs are KEPT once visited, and the others are mounted early behind the
 * launch screen (`HomeShell`, docs/plans/tab-keep-alive.md): a tab you leave is
 * hidden, not destroyed, so coming back is instant. That makes "mounted" stop
 * meaning "being looked at", and three kinds of code cared about the
 * difference:
 *
 *   - a sheet, which portals to `<body>` and so escapes the hidden wrapper
 *     (`BottomSheet` reads this and stays shut while its tab is away);
 *   - a one-shot arrival marker consumed "on mount" (the stringing intent, the
 *     Profile sub-screen), which now has to be consumed on ARRIVAL;
 *   - a "this screen was opened" beacon (`stats_open`), which must count
 *     visits, not mounts — a preloaded Stats is not a visit.
 *
 * `true` outside a tab, so a component rendered anywhere else (a test, a sheet
 * the shell owns, `/design`) behaves exactly as it did before tabs were kept.
 */
export const TabActiveContext = createContext(true);

export function useTabActive(): boolean {
  return useContext(TabActiveContext);
}

/**
 * How long a tab must have been away before coming back re-reads it. Bouncing
 * between two tabs inside a few seconds asks the server nothing; leaving Home
 * for longer than this and returning re-checks the roster in the background.
 */
export const RETURN_REFRESH_MS = 10_000;

/**
 * Call `onReturn` when this component's tab comes back on screen after being
 * away for at least `minAwayMs`. Never on mount — the first load is the
 * component's own effect, as it always was.
 *
 * The refresh this triggers must keep what is on screen while it runs (the
 * "a refetch keeps its content" rule in CLAUDE.md): a return that blinked back
 * to a skeleton would undo the point of keeping the tab.
 */
export function useTabReturn(onReturn: () => void, minAwayMs = RETURN_REFRESH_MS): void {
  const active = useTabActive();
  const hiddenAt = useRef<number | null>(null);
  const latest = useRef(onReturn);
  useEffect(() => {
    latest.current = onReturn;
  });
  useEffect(() => {
    if (!active) {
      hiddenAt.current = Date.now();
      return;
    }
    const since = hiddenAt.current;
    hiddenAt.current = null;
    if (since !== null && Date.now() - since >= minAwayMs) latest.current();
  }, [active, minAwayMs]);
}
