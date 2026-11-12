'use client';

import { createContext, useContext, useLayoutEffect, type ReactNode, type RefObject } from 'react';
import { pageScrollTop, scrollPageTo } from '@/lib/pageScroll';

/**
 * A foldable's RIGHT page, beside the list that opened it (Apple's
 * list-detail; docs/plans/foldable-layout.md). Inside it a page's top bar
 * drops its Back: the list is still on screen, so there is nothing to go back
 * to, and the edge swipe and Escape that close a page would close the right
 * page for no reason. A page opened FROM the right page (Edit profile → your
 * name) is `nested` and keeps its Back to the page under it.
 *
 * Only rendered in two-page mode (`usePaneMode()`), so one screen never sees
 * any of this and keeps every page exactly as it was.
 */
const BesideList = createContext(false);

export function PaneDetail({ nested = false, children }: { nested?: boolean; children: ReactNode }) {
  return <BesideList.Provider value={!nested}>{children}</BesideList.Provider>;
}

/** True inside a right page whose list is beside it. */
export function useBesideList(): boolean {
  return useContext(BesideList);
}

/** Room left above an opened right page: the top bar's height clears the
 *  round buttons over a portrait right pane. */
const REVEAL_MARGIN_PX = 16;

/**
 * Brings the right page into view when what it shows changes. The body is
 * the one scroller, so a row tapped far down a long list opened a page whose
 * top was already above the screen. Only ever scrolls UP to it, and only when
 * it is out of sight; a page already visible leaves the list where it was.
 * Smooth unless the person asked for reduced motion.
 */
export function usePaneDetailReveal(target: RefObject<HTMLElement | null> | HTMLElement | null, key: string | null) {
  useLayoutEffect(() => {
    // A ref (a page that owns its right page) or the element itself (a portal slot).
    const el = target instanceof HTMLElement ? target : target?.current ?? null;
    if (!el || key === null) return;
    const top = el.getBoundingClientRect().top;
    if (top >= 0) return;
    const to = Math.max(0, pageScrollTop() + top - REVEAL_MARGIN_PX);
    let reduce = false;
    try { reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { /* no matchMedia: jump */ }
    if (reduce || typeof window.scrollTo !== 'function') {
      scrollPageTo(to);
      return;
    }
    // The body scrolls (lib/pageScroll.ts), so it is the body that glides.
    const scroller = document.scrollingElement ?? document.documentElement;
    try {
      scroller.scrollTo({ top: to, behavior: 'smooth' });
    } catch {
      scrollPageTo(to);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when what is open changes
  }, [key]);
}
