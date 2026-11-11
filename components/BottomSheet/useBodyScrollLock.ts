import { useEffect } from 'react';

/**
 * Locks body scroll using the position:fixed technique. Plain `overflow: hidden`
 * doesn't stop iOS rubber-band / pull-to-refresh — `position: fixed` pins the
 * body to its current scroll offset so no gesture can move it.
 *
 * REFERENCE-COUNTED across instances, because two sheets can hold the lock at
 * once: a sheet swap (`GearPickRail` closes the pick sheet and opens the fit
 * sheet in the same commit) leaves the first sheet in its 220 ms `closing`
 * phase — lock still held — while the second sheet mounts. Per-instance
 * snapshots got that wrong twice over: the second instance snapshotted the
 * body while it was ALREADY fixed (`top: -0px`, since scrollY is 0 on a fixed
 * body), the first instance's cleanup then restored the page to scrollable
 * beneath the still-open second sheet, and the second sheet's cleanup finally
 * restored `position: fixed` with nothing on screen — a Stats tab that could
 * not scroll until reload. Only the FIRST lock snapshots and pins; only the
 * LAST unlock restores and scrolls back.
 *
 * Idempotent per instance: each instance releases at most the one hold it
 * took.
 */
/*
 * `window.scrollY` / `window.scrollTo` below are deliberate, NOT the
 * body-is-the-scroller bug `lib/pageScroll.ts` fixes elsewhere. In this app
 * the BODY scrolls (`html, body { height: 100% }`), so `window.scrollY` is 0
 * and the pin is `top: -0px`; a fixed body is still its own scroller, so it
 * keeps its `scrollTop` and the page neither moves under the sheet nor after
 * it (measured 2026-11-11, Chromium: 400 before, open and after). Reading the
 * real offset with `pageScrollTop()` would pin `top: -400px` ON TOP of that
 * 400 and jump the page by the offset twice. On a page where the WINDOW
 * scrolls, the window numbers are the right ones.
 */
let holds = 0;
let saved: { position: string; top: string; width: string; scrollY: number } | null = null;

export function useBodyScrollLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const body = document.body;
    if (holds === 0) {
      saved = {
        position: body.style.position,
        top: body.style.top,
        width: body.style.width,
        scrollY: window.scrollY,
      };
      body.style.position = 'fixed';
      body.style.top = `-${saved.scrollY}px`;
      body.style.width = '100%';
    }
    holds += 1;
    return () => {
      holds -= 1;
      if (holds > 0 || !saved) return;
      const s = saved;
      saved = null;
      body.style.position = s.position;
      body.style.top = s.top;
      body.style.width = s.width;
      window.scrollTo(0, s.scrollY);
    };
  }, [active]);
}
