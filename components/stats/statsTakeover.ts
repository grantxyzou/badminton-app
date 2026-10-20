'use client';

import { createContext, useContext, useEffect } from 'react';

/**
 * A page inside the Stats tab — the fit profile, a frame's page — stands in
 * for the whole tab: no Stats heading, no overview strip, no register switch
 * above it. The app has no router, so the page is rendered IN PLACE by the
 * register that owns its data, and asks the shell to step aside.
 *
 * The shell HIDES its chrome rather than unmounting the register, because the
 * register holds the page's state (the one `useGear`, the picks): unmounting
 * it to show the page would throw away the very data the page reads.
 */
export const StatsTakeoverContext = createContext<(on: boolean) => void>(() => {});

/** While `on`, the Stats shell hides its own chrome. Released on unmount. */
export function useStatsTakeover(on: boolean): void {
  const set = useContext(StatsTakeoverContext);
  useEffect(() => {
    set(on);
    return () => set(false);
  }, [on, set]);
}

/**
 * Switch the Stats register from inside one (Stats canvas, 2026-10-20: "Work
 * on next" ends in "Open this week's focus in Learn"). The shell owns the
 * switch; a card asks it, the same way a page asks it to step aside. Outside a
 * shell (a card rendered on its own) the request is a no-op.
 */
export const StatsRegisterContext = createContext<((view: 'you' | 'play' | 'learn' | 'gear') => void) | null>(null);

export function useOpenStatsRegister() {
  return useContext(StatsRegisterContext);
}
