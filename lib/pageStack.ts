'use client';

import { useEffect, useRef } from 'react';
import { useTabActive } from './tabActivity';

/**
 * Which in-tab PAGE is open on top of its screen, top-most last — the twin of
 * `lib/sheetStack.ts`, one level down.
 *
 * Exists for the Android hardware back button. The app has no router: an
 * admin page, a Profile sub-screen or a Stats page is rendered in place, so
 * `history.back()` cannot see it. Before this, back from any of them skipped
 * every page and went to Home (docs/plans/back-navigation.md). A screen with a
 * page open registers its own Back while it is ON SCREEN (`useTabActive`) —
 * a tab kept mounted behind another must not answer for it — and
 * `NativeBridge` asks this module after the sheets and before the tabs.
 *
 * Module state, not React state: the bridge runs outside every tab's tree.
 */
const stack: Array<{ onBack: () => void; depth: number }> = [];

/**
 * Register an open page's Back. Returns the unregister. `depth` orders pages
 * nested inside a page — the bench's job inside the admin trail is depth 1 —
 * so the innermost answers first whatever order the effects ran in.
 */
export function registerPageBack(onBack: () => void, depth = 0): () => void {
  const entry = { onBack, depth };
  stack.push(entry);
  return () => {
    const i = stack.lastIndexOf(entry);
    if (i >= 0) stack.splice(i, 1);
  };
}

/** Go back one page in the innermost open page. False when no page is open. */
export function goBackInPage(): boolean {
  let top: (typeof stack)[number] | undefined;
  for (const entry of stack) if (!top || entry.depth >= top.depth) top = entry;
  if (!top) return false;
  top.onBack();
  return true;
}

/**
 * While `open` and the tab is on screen, this screen answers the hardware
 * back button with `onBack`. The latest `onBack` is always the one called.
 */
export function usePageBack(open: boolean, onBack: () => void, depth = 0): void {
  const onScreen = useTabActive();
  const latest = useRef(onBack);
  useEffect(() => { latest.current = onBack; });
  useEffect(() => {
    if (!open || !onScreen) return;
    return registerPageBack(() => latest.current(), depth);
  }, [open, onScreen, depth]);
}
