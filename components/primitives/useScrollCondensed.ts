'use client';

import { useEffect, useLayoutEffect, type RefObject } from 'react';

/**
 * Walks up from `el` to the nearest scrollable ancestor. Falls back to
 * `window`. CRITICAL for this app: `app/globals.css` sets
 * `html, body { height: 100%; overflow-x: hidden }`, which makes the
 * browser compute `body`'s overflow-y to `auto` — so the **<body> is the
 * scroller, not the window**. A header that listens to `window` scroll /
 * reads `window.scrollY` never sees the scroll and never condenses. This
 * is exactly the bug that left PageHeader's frosted bar dead on every tab.
 */
function findScroller(el: HTMLElement): HTMLElement | Window {
  let node: HTMLElement | null = el.parentElement;
  while (node) {
    if (/(auto|scroll|overlay)/.test(getComputedStyle(node).overflowY)) return node;
    node = node.parentElement;
  }
  return window;
}

/**
 * Toggles `.scrolled` on the ref'd bar once its real scroll ancestor
 * passes the 8px hysteresis threshold (TopBar Spec §03). Shared by
 * `TopBar` and `PageHeader` so both variants condense identically
 * regardless of whether the page scrolls on `window` or `<body>`.
 */
export function useScrollCondensed(ref: RefObject<HTMLElement | null>) {
  // Sync the initial state pre-paint so we don't flash at-rest for one
  // frame when landing on an already-scrolled screen.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof window === 'undefined') return;
    const scroller = findScroller(el);
    const top = scroller === window ? window.scrollY : (scroller as HTMLElement).scrollTop;
    el.classList.toggle('scrolled', top > 8);
  }, [ref]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const scroller = findScroller(el);
    const getTop = () =>
      scroller === window ? window.scrollY : (scroller as HTMLElement).scrollTop;
    const update = () => el.classList.toggle('scrolled', getTop() > 8);
    scroller.addEventListener('scroll', update, { passive: true } as AddEventListenerOptions);
    return () => scroller.removeEventListener('scroll', update);
  }, [ref]);
}
