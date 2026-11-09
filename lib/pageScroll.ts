/**
 * The page's scroll, whichever element is doing the scrolling.
 *
 * `html, body { height: 100% }` makes `<body>` the scroller in this app:
 * `window.scrollY` reads 0 however far down the page is, `window.scrollTo`
 * moves nothing, and a body `scroll` event does not reach `window`
 * (measured on production, 2026-09-17; `components/PullToRefresh.tsx`).
 * These read and write both, so a caller works whichever one scrolls.
 */
export function pageScrollTop(): number {
  if (typeof window === 'undefined') return 0;
  return Math.max(window.scrollY, document.documentElement.scrollTop, document.body?.scrollTop ?? 0);
}

export function scrollPageTo(y: number): void {
  if (typeof window === 'undefined') return;
  document.documentElement.scrollTop = y;
  if (document.body) document.body.scrollTop = y;
}

/** Calls `fn` on any page scroll; a body scroll does not bubble, so this captures on `document`. */
export function onPageScroll(fn: () => void): () => void {
  document.addEventListener('scroll', fn, { capture: true, passive: true });
  return () => document.removeEventListener('scroll', fn, { capture: true });
}
