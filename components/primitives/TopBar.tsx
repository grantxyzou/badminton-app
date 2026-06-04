'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { useScrollCondensed } from './useScrollCondensed';

/**
 * Sticky, scroll-condensed top bar. Implements `TopBar Spec.html`
 * from the 2026-05-06 design handoff. Used on every Admin sub-page
 * reachable from another screen (Roster, Birds, Session details,
 * Releases, Members, Advance, Date/Time).
 *
 * Behavior:
 *   - At rest (scrollY ≤ 8): transparent bg, crumb visible, title at full size.
 *   - Scrolled (scrollY > 8): frosted bg, crumb collapses, title shrinks.
 *   - 8px hysteresis avoids jitter from iOS rubber-band.
 *   - Listens to nearest scrollable ancestor; falls back to window.
 *   - Esc triggers `onBack` when present.
 *   - prefers-reduced-motion drops transitions to 0ms (handled in CSS).
 */
export interface TopBarProps {
  title: ReactNode;
  /** Section label rendered above the title; collapses on scroll. Optional. */
  crumb?: ReactNode;
  /** Back affordance — omit when there's nowhere to go. */
  onBack?: () => void;
  /** Right-aligned slot for Save / overflow / status chip. */
  right?: ReactNode;
  /** aria-label for the back button (default "Back"). */
  backLabel?: string;
}

export default function TopBar({ title, crumb, onBack, right, backLabel = 'Back' }: TopBarProps) {
  const ref = useRef<HTMLDivElement>(null);

  // Scroll-condense (shared with PageHeader). Handles the <body>-is-scroller
  // reality of this app — see useScrollCondensed.
  useScrollCondensed(ref);

  useEffect(() => {
    if (!onBack) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onBack();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onBack]);

  // Edge swipe-back gesture with live micro-interaction. A touch that
  // starts in the left 24px gutter and travels mostly horizontally
  // rightward triggers onBack on release if it crosses the threshold.
  //
  // During the drag we write a 0..1 progress to `--swipe-back` on
  // `<html>` and toggle `data-swiping="true"`. CSS rules consume these
  // to nudge the back chevron, glow the left edge, and dim the page —
  // giving the gesture rubber-band feel without rendering a back-stack.
  // On commit we navigate; on cancel we drop `data-swiping` so the
  // springback transition runs.
  // Edge swipe-back gesture with live micro-interaction. A touch that
  // starts in the left 24px gutter and travels mostly horizontally
  // rightward triggers onBack on release if it crosses the threshold.
  //
  // State machine on `<html>`:
  //   - `data-swiping="active"` during the drag (no CSS transition;
  //     transforms track the finger 1:1).
  //   - `data-swiping="release"` for ~230ms after release while the
  //     springback transition runs.
  //   - attribute absent at rest. CRITICAL: the gating attribute is
  //     what lets us *omit* `transform` on the page shell at rest —
  //     even `translateX(0)` would establish a containing block and
  //     break `position: fixed` descendants (the project's documented
  //     "containing-block trap").
  useEffect(() => {
    if (!onBack) return;
    const root = document.documentElement;
    const RELEASE_MS = 230;
    let startX = 0;
    let startY = 0;
    let startT = 0;
    let tracking = false;
    let releaseTimer: number | null = null;
    const setVar = (n: number) => root.style.setProperty('--swipe-back', String(n));
    const clearRelease = () => {
      if (releaseTimer !== null) {
        window.clearTimeout(releaseTimer);
        releaseTimer = null;
      }
    };
    const settle = () => {
      clearRelease();
      root.removeAttribute('data-swiping');
      setVar(0);
      tracking = false;
    };
    const beginRelease = () => {
      tracking = false;
      root.setAttribute('data-swiping', 'release');
      setVar(0);
      releaseTimer = window.setTimeout(settle, RELEASE_MS);
    };
    const onStart = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!t || t.clientX > 24) { tracking = false; return; }
      tracking = true;
      startX = t.clientX;
      startY = t.clientY;
      startT = Date.now();
      clearRelease();
      root.setAttribute('data-swiping', 'active');
      setVar(0);
    };
    const onMove = (e: TouchEvent) => {
      if (!tracking) return;
      const t = e.touches[0];
      if (!t) return;
      const dx = t.clientX - startX;
      const dy = Math.abs(t.clientY - startY);
      // If the gesture goes vertical, hand off to scroll.
      if (dy > 40 && dy > Math.abs(dx)) {
        beginRelease();
        return;
      }
      const progress = Math.max(0, Math.min(1, dx / 120));
      setVar(progress);
    };
    const onEnd = (e: TouchEvent) => {
      if (!tracking) return;
      const t = e.changedTouches[0];
      const dx = t ? t.clientX - startX : 0;
      const dy = t ? Math.abs(t.clientY - startY) : 0;
      const dt = Date.now() - startT;
      const committed = dx > 60 && dy < 40 && dt < 600;
      if (committed) {
        // Visual full-commit hold for one frame; the new screen will
        // mount with the attribute absent on next layout pass.
        setVar(1);
        requestAnimationFrame(() => {
          settle();
          onBack();
        });
      } else {
        beginRelease();
      }
    };
    const onCancel = () => beginRelease();
    document.addEventListener('touchstart', onStart, { passive: true });
    document.addEventListener('touchmove', onMove, { passive: true });
    document.addEventListener('touchend', onEnd, { passive: true });
    document.addEventListener('touchcancel', onCancel, { passive: true });
    return () => {
      document.removeEventListener('touchstart', onStart);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onEnd);
      document.removeEventListener('touchcancel', onCancel);
      settle();
    };
  }, [onBack]);

  return (
    <div ref={ref} className="bpm-topbar">
      {onBack && (
        <button
          type="button"
          aria-label={backLabel}
          onClick={onBack}
          className="bpm-topbar__back"
        >
          <span className="material-icons" aria-hidden="true">chevron_left</span>
        </button>
      )}
      <div className="bpm-topbar__col">
        {crumb && <span className="bpm-topbar__crumb">{crumb}</span>}
        <h1 className="bpm-topbar__title">{title}</h1>
      </div>
      {right && <div className="bpm-topbar__right">{right}</div>}
    </div>
  );
}
