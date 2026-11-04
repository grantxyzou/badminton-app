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

/** Past this many pixels of scroll, the bar condenses (TopBar Spec §03). */
const THRESHOLD = 8;

/**
 * Condense or expand the bar WITHOUT moving anything below it.
 *
 * The bar is in flow, so a shrinking bar pulled the page up under the
 * reader; Chrome's scroll anchoring then scrolled back by the same amount to
 * hold the content still, which a few pixels past the threshold landed at 0,
 * expanded the bar, and swallowed the scroll. Every short scroll on Home was
 * eaten that way (2026-11-04, measured: eight 10px wheel steps never left 0),
 * and a long club name, which shrinks the bar by up to 40px, ate more. Safari
 * has no anchoring, so there the page JUMPED by the shrink instead.
 *
 * So the height the bar gives up is handed back as margin below it: the
 * bar's footprint never changes, the content never moves, and there is
 * nothing to anchor. Anchoring is paused for the one synchronous measure
 * (a forced layout with the bar shrunk and the margin not yet set).
 */
function setCondensed(el: HTMLElement, scroller: HTMLElement | Window, on: boolean) {
  if (el.classList.contains('scrolled') === on) return;
  const anchorBox = (scroller === window ? document.scrollingElement : scroller) as HTMLElement | null;
  const prevAnchor = anchorBox?.style.overflowAnchor ?? '';
  if (anchorBox) anchorBox.style.overflowAnchor = 'none';
  if (on) {
    const rest = el.offsetHeight;
    // The gap below the bar AS RENDERED: margins collapse (with a `space-y`
    // sibling's, and through an empty wrapper — Home has one), so reading
    // any one margin under-counts. Measure to the first thing with height.
    let next = el.nextElementSibling;
    while (next && next.getBoundingClientRect().height === 0) next = next.nextElementSibling;
    const gap = next
      ? Math.max(0, next.getBoundingClientRect().top - el.getBoundingClientRect().bottom)
      : parseFloat(getComputedStyle(el).marginBottom) || 0;
    el.classList.add('scrolled');
    const shrink = Math.max(0, rest - el.offsetHeight);
    // `gap + shrink` out-sizes every margin it collapses with, so the
    // collapsed result is exactly that and the content stays put.
    el.style.marginBottom = shrink > 0 ? `${gap + shrink}px` : '';
  } else {
    el.classList.remove('scrolled');
    el.style.marginBottom = '';
  }
  if (anchorBox) requestAnimationFrame(() => { anchorBox.style.overflowAnchor = prevAnchor; });
}

/**
 * Toggles `.scrolled` on the ref'd bar once its real scroll ancestor
 * passes the 8px threshold (TopBar Spec §03). Shared by
 * `TopBar` and `PageHeader` so both variants condense identically
 * regardless of whether the page scrolls on `window` or `<body>`.
 */
export function useScrollCondensed(ref: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof window === 'undefined') return;
    const scroller = findScroller(el);
    const top = scroller === window ? window.scrollY : (scroller as HTMLElement).scrollTop;
    setCondensed(el, scroller, top > THRESHOLD);
  }, [ref]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const scroller = findScroller(el);
    const getTop = () =>
      scroller === window ? window.scrollY : (scroller as HTMLElement).scrollTop;
    const update = () => setCondensed(el, scroller, getTop() > THRESHOLD);
    scroller.addEventListener('scroll', update, { passive: true } as AddEventListenerOptions);
    return () => scroller.removeEventListener('scroll', update);
  }, [ref]);
}
