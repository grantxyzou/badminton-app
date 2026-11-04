'use client';

import { useEffect } from 'react';

/**
 * The moment a foldable crosses from one pane to two — unfolding, or turning
 * an open one sideways — Home reflows from a column to two panes and the tab
 * bar may move to the side (docs/plans/foldable-layout.md). Apple's rule for
 * that moment is "favor small adjustments over rearrangement"; a reflow is a
 * rearrangement, so the app shell CROSSFADES through it (`--duration-normal`,
 * opacity only: the same recipe as a tab switch, and the one motion reduced
 * motion keeps).
 *
 * This is the ONE place that knows when the flip happens. CSS cannot replay an
 * animation on a media-query change by itself, so the shell carries
 * `data-pane-flip`, alternating `a` / `b` on every change, and two identical
 * keyframes under those two names restart the fade. Nothing on mount: the
 * first paint is the launch screen's job.
 *
 * `PANE_QUERY` is the SAME condition as the CSS pane block, verbatim; the
 * foldable canary pins the two together.
 */
export const PANE_QUERY =
  '(min-width: 720px) and (min-height: 480px) and (pointer: coarse), (horizontal-viewport-segments: 2)';

export const PANE_FLIP_ATTR = 'data-pane-flip';

export function usePaneFlip(): void {
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(PANE_QUERY);
    const root = document.documentElement;
    const onChange = () => {
      root.setAttribute(PANE_FLIP_ATTR, root.getAttribute(PANE_FLIP_ATTR) === 'a' ? 'b' : 'a');
    };
    mq.addEventListener('change', onChange);
    return () => {
      mq.removeEventListener('change', onChange);
      root.removeAttribute(PANE_FLIP_ATTR);
    };
  }, []);
}
