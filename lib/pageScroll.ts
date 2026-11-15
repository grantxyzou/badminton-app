/**
 * The page's scroll, whichever element is doing the scrolling.
 *
 * The DOCUMENT scrolls since 2026-11-15 (`docs/plans/page-scroll.md`). Until
 * then `html, body { height: 100% }` made `<body>` the scroller: `window.scrollY`
 * read 0 however far down the page was, `window.scrollTo` moved nothing, and a
 * body `scroll` event never reached `window` (measured on production,
 * 2026-09-17). These read and write both, so a caller is right either way, and
 * a browser that falls back to the old rules (one older than `overflow: clip`)
 * still works.
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
