'use client';

import { useEffect, useRef, useState } from 'react';
import { openSheetCount } from '@/lib/sheetStack';
import { HOLD, MIN_SPIN_MS, SCROLL_SETTLE_MS, TRIGGER, pullDistance, pullProgress } from '@/lib/pullToRefresh';

/**
 * Pull-to-refresh. There is no fetch-intercepting service worker (live-only by
 * design), so "refresh" re-runs the current view's data fetches — the parent
 * does that by remounting the active tab when `onRefresh` fires.
 *
 * The feel lives in `lib/pullToRefresh.ts` (a damped curve, a ~110px trigger);
 * this file is the gesture and the paint. Three rules:
 *
 * 1. NO RENDER PER FRAME. The indicator's transform and the ring are written
 *    straight to the DOM during the drag — the rule `SwipeRow` and the sheet
 *    drag follow. React state holds only "is a refresh running".
 * 2. THE LISTENERS STAY PASSIVE. A non-passive `touchmove` on `document` makes
 *    the browser wait for JavaScript before scrolling ANY touch in the app,
 *    which is the opposite of smooth. The page's own rubber-band is switched
 *    off in CSS instead (`overscroll-behavior-y: none` on the root), so the
 *    indicator is the only thing that moves and nothing has to be prevented.
 * 3. A SCROLL IS NEVER A PULL. The gesture must start at the top with no sheet
 *    open, and with the page STILL: a touch within `SCROLL_SETTLE_MS` of the
 *    last scroll is the tail of scrolling up, not a new pull. Any upward
 *    travel, or sideways travel that beats vertical, retires it for good — so
 *    a scroll that bounces off the top edge can't flip into a refresh halfway
 *    through.
 *
 * The body is the scroll container in this app, so listeners live on `document`.
 */
const UP_CANCEL = 8; // px of upward travel that marks the gesture as a scroll
const H_SLOP = 10; // px of sideways travel tolerated before a diagonal drag disqualifies

export default function PullToRefresh({ onRefresh }: { onRefresh: () => Promise<void> | void }) {
  const [refreshing, setRefreshing] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const ringRef = useRef<HTMLSpanElement>(null);

  const onRefreshRef = useRef(onRefresh);
  useEffect(() => {
    onRefreshRef.current = onRefresh;
  }, [onRefresh]);

  useEffect(() => {
    let startY: number | null = null;
    let startX = 0;
    let pull = 0;
    let armed = false;
    let busy = false;
    let disqualified = false;
    // When the page last moved. Momentum scrolling fires `scroll` without a
    // finger on the glass, which is exactly the window this guards.
    let lastScrollAt = -Infinity;
    const onScroll = () => {
      lastScrollAt = Date.now();
    };

    /** One paint: where the indicator is, and how much of the ring is drawn. */
    function paint(next: number, settle: boolean) {
      pull = next;
      const wrap = wrapRef.current;
      const ring = ringRef.current;
      if (!wrap || !ring) return;
      // A settle (release, refresh start, refresh end) animates; a drag follows
      // the finger exactly, so it must not.
      wrap.dataset.settle = settle ? 'true' : 'false';
      wrap.style.transform = `translate3d(0, ${next}px, 0)`;
      wrap.style.opacity = next > 0 || busy ? '1' : '0';
      const progress = pullProgress(next);
      if (!busy) {
        ring.style.transform = `rotate(${progress * 270}deg)`;
        ring.style.opacity = String(0.35 + progress * 0.65);
      }
      // Crossing the trigger is a moment, not a number: the disc pops, and on
      // Android the phone ticks. Once per crossing, both ways.
      const nowArmed = next >= TRIGGER;
      if (nowArmed !== armed) {
        armed = nowArmed;
        wrap.dataset.armed = nowArmed ? 'true' : 'false';
        if (nowArmed && typeof navigator !== 'undefined' && 'vibrate' in navigator) {
          try { navigator.vibrate(8); } catch { /* not allowed here: fine */ }
        }
      }
    }

    function onStart(e: TouchEvent) {
      if (busy || window.scrollY > 0 || openSheetCount() > 0) return;
      if (Date.now() - lastScrollAt < SCROLL_SETTLE_MS) return;
      startY = e.touches[0]?.clientY ?? null;
      startX = e.touches[0]?.clientX ?? 0;
      disqualified = false;
    }

    function onMove(e: TouchEvent) {
      if (startY === null || busy || disqualified) return;
      if (window.scrollY > 0) {
        startY = null;
        paint(0, true);
        return;
      }
      const dy = (e.touches[0]?.clientY ?? 0) - startY;
      const dx = (e.touches[0]?.clientX ?? 0) - startX;
      if (dy < -UP_CANCEL || (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > H_SLOP)) {
        disqualified = true;
        paint(0, true);
        return;
      }
      paint(pullDistance(dy), false);
    }

    async function onEnd() {
      if (startY === null) return;
      startY = null;
      if (pull < TRIGGER) {
        paint(0, true);
        return;
      }
      busy = true;
      setRefreshing(true);
      paint(HOLD, true);
      const began = Date.now();
      try {
        await onRefreshRef.current();
      } finally {
        const left = MIN_SPIN_MS - (Date.now() - began);
        if (left > 0) await new Promise((r) => setTimeout(r, left));
        busy = false;
        setRefreshing(false);
        paint(0, true);
      }
    }

    window.addEventListener('scroll', onScroll, { passive: true });
    document.addEventListener('touchstart', onStart, { passive: true });
    document.addEventListener('touchmove', onMove, { passive: true });
    document.addEventListener('touchend', onEnd, { passive: true });
    document.addEventListener('touchcancel', onEnd, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      document.removeEventListener('touchstart', onStart);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onEnd);
      document.removeEventListener('touchcancel', onEnd);
    };
  }, []);

  return (
    <div ref={wrapRef} className="ptr" aria-hidden={!refreshing} data-settle="true" data-armed="false">
      <div className="ptr-disc" role="status" aria-label={refreshing ? 'Refreshing' : 'Pull to refresh'}>
        <span
          ref={ringRef}
          className="ring-spinner"
          style={{ animationPlayState: refreshing ? 'running' : 'paused' }}
        />
      </div>
    </div>
  );
}
