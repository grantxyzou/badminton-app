'use client';

import { useCallback, useLayoutEffect, useRef } from 'react';
import { pageScrollTop, scrollPageTo } from './pageScroll';

/**
 * Where you were, per level of a page trail (Grant, 2026-11-15: "Remember
 * position").
 *
 * Admin opens its pages ON TOP of the console, which stays mounted under
 * `hidden`, and the page is one scroller for every level. So a page opened
 * from far down the console opened part-way down itself, and Back showed the
 * console at the PAGE's height, not where the console had been left.
 *
 * Call `remember()` just before pushing a page: it notes the scroll of the
 * level being left. When the depth then grows, the new page opens at its top;
 * when it shrinks, the level returned to gets its own position back. Both
 * happen before paint, so the wrong height never shows for a frame. Off
 * (`active: false`) on two pages, where the console keeps its own side.
 */
export function useTrailScroll(depth: number, active: boolean): () => void {
  const saved = useRef<number[]>([]);
  const shown = useRef(depth);
  const remember = useCallback(() => {
    if (active) saved.current[shown.current] = pageScrollTop();
  }, [active]);
  useLayoutEffect(() => {
    const was = shown.current;
    shown.current = depth;
    if (!active || depth === was) return;
    if (depth > was) {
      scrollPageTo(0);
      return;
    }
    scrollPageTo(saved.current[depth] ?? 0);
    saved.current.length = depth + 1;
  }, [depth, active]);
  return remember;
}
