'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Pull-to-refresh for the iOS saved-to-homescreen PWA. The app has no service
 * worker (live-only by design), so "refresh" simply re-runs the current view's
 * data fetches — the parent does that by remounting the active tab when
 * `onRefresh` fires.
 *
 * Listens for a downward drag that STARTS at the top of the page (scrollY <= 0)
 * and isn't inside an open BottomSheet (which pins `body { position: fixed }`
 * to block iOS rubber-band). Past the threshold it calls `onRefresh` and holds
 * the spinner until it resolves.
 *
 * The body is the scroll container in this app, so listeners live on `document`.
 */
const THRESHOLD = 115; // px of (resisted) pull needed to trigger (~283px raw drag)
const MAX = 160; // px the indicator can travel
const RESISTANCE = 0.45; // drag feels heavier than 1:1
const DEAD_ZONE = 28; // px of raw drag ignored before any pull registers
const UP_CANCEL = 8; // px of upward movement that disqualifies the gesture as a scroll
const H_SLOP = 10; // px of horizontal travel tolerated before a sideways drag disqualifies the gesture

export default function PullToRefresh({
  onRefresh,
}: {
  onRefresh: () => Promise<void> | void;
}) {
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  // Refs so the touch handlers (attached once) always see fresh values without
  // re-attaching listeners on every render — re-attaching mid-gesture drops
  // touchmove events.
  const startY = useRef<number | null>(null);
  const startX = useRef<number | null>(null);
  const pullRef = useRef(0);
  const refreshingRef = useRef(false);
  // Once a gesture moves upward (a scroll), it can't become a pull — even if
  // the finger later crosses back down past the top edge. Cleared per gesture.
  const disqualified = useRef(false);
  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;

  useEffect(() => {
    function sheetOpen() {
      return typeof document !== 'undefined' && document.body.style.position === 'fixed';
    }
    function setPullBoth(v: number) {
      pullRef.current = v;
      setPull(v);
    }

    function onStart(e: TouchEvent) {
      if (refreshingRef.current) return;
      if (window.scrollY > 0 || sheetOpen()) return;
      startY.current = e.touches[0]?.clientY ?? null;
      startX.current = e.touches[0]?.clientX ?? null;
      disqualified.current = false;
    }
    function onMove(e: TouchEvent) {
      if (startY.current === null || refreshingRef.current || disqualified.current) return;
      // Bail if the page scrolled (user is scrolling content, not pulling).
      if (window.scrollY > 0) {
        startY.current = null;
        setPullBoth(0);
        return;
      }
      const dy = (e.touches[0]?.clientY ?? 0) - startY.current;
      // Any meaningful upward travel means this is a scroll gesture that
      // happened to start at the top — never a refresh. Disqualify it so a
      // scroll-up that bounces at the top edge can't flip into a refresh.
      if (dy < -UP_CANCEL) {
        disqualified.current = true;
        setPullBoth(0);
        return;
      }
      // Horizontal-dominant gesture (a sideways / diagonal swipe that happened to
      // start at the top) is never a pull. Disqualify once horizontal travel both
      // exceeds vertical and clears a small slop floor, so early sub-slop jitter
      // can't kill a genuine straight-down pull.
      const dx = (e.touches[0]?.clientX ?? 0) - (startX.current ?? 0);
      if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > H_SLOP) {
        disqualified.current = true;
        setPullBoth(0);
        return;
      }
      // Dead zone: ignore the first DEAD_ZONE px of drag so a small overscroll
      // (and the natural jitter at the top of a scroll) registers nothing.
      const effective = dy - DEAD_ZONE;
      if (effective <= 0) {
        setPullBoth(0);
        return;
      }
      setPullBoth(Math.min(MAX, effective * RESISTANCE));
    }
    async function onEnd() {
      if (startY.current === null) return;
      const trigger = pullRef.current >= THRESHOLD;
      startY.current = null;
      if (!trigger) {
        setPullBoth(0);
        return;
      }
      refreshingRef.current = true;
      setRefreshing(true);
      setPullBoth(THRESHOLD);
      try {
        await onRefreshRef.current();
      } finally {
        refreshingRef.current = false;
        setRefreshing(false);
        setPullBoth(0);
      }
    }

    document.addEventListener('touchstart', onStart, { passive: true });
    document.addEventListener('touchmove', onMove, { passive: true });
    document.addEventListener('touchend', onEnd);
    document.addEventListener('touchcancel', onEnd);
    return () => {
      document.removeEventListener('touchstart', onStart);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onEnd);
      document.removeEventListener('touchcancel', onEnd);
    };
  }, []);

  const visible = pull > 0 || refreshing;
  const progress = Math.min(1, pull / THRESHOLD);

  return (
    <div
      aria-hidden={!visible}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        display: 'flex',
        justifyContent: 'center',
        pointerEvents: 'none',
        zIndex: 40,
        transform: `translateY(${visible ? pull : 0}px)`,
        transition: startY.current === null ? 'transform 180ms ease-out, opacity 180ms ease-out' : 'none',
        opacity: visible ? 1 : 0,
      }}
    >
      <div
        role="status"
        aria-label={refreshing ? 'Refreshing' : 'Pull to refresh'}
        style={{
          marginTop: 10,
          width: 32,
          height: 32,
          borderRadius: '50%',
          background: 'var(--glass-bg, rgba(20,20,24,0.7))',
          border: '1px solid var(--glass-border, rgba(255,255,255,0.12))',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: '0 2px 10px rgba(0,0,0,0.25)',
        }}
      >
        <span
          className="ring-spinner"
          style={{
            // Static ring construction lives in `.ring-spinner`; while idle we
            // suppress its spin and drive rotation/opacity from pull progress.
            animationPlayState: refreshing ? 'running' : 'paused',
            opacity: refreshing ? 1 : 0.4 + progress * 0.6,
            transform: refreshing ? undefined : `rotate(${progress * 270}deg)`,
          }}
        />
      </div>
    </div>
  );
}
