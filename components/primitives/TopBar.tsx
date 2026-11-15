'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { useScrollCondensed } from './useScrollCondensed';
import { useBesideList } from './PaneDetail';

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

/**
 * Whether this bar is the page on screen. Pages are KEPT, not rebuilt: every
 * visited tab stays mounted under `hidden` (HomeShell), and the Admin console
 * stays mounted, hidden, under each Admin page (AdminDashboard). Each of those
 * bars still had its swipe and Escape listeners on `document`, so one swipe
 * back from an Admin page ran its Back AND the hidden console's ("Back to
 * profile") in the same frame: Late cancellations went straight to Profile
 * instead of one page back, and the whole app swapped screens under the
 * finger (Grant, 2026-11-13, on the App Store app). A `hidden` ancestor is
 * the one test that holds for both, and it reads the same in jsdom.
 */
export function isBarOnScreen(el: HTMLElement | null): boolean {
  return !!el && el.isConnected && el.closest('[hidden]') === null;
}

export default function TopBar({ title, crumb, onBack: onBackProp, right, backLabel = 'Back' }: TopBarProps) {
  const ref = useRef<HTMLDivElement>(null);
  // On a foldable's right page the list that opened this page is beside it:
  // no Back, no edge swipe and no Escape closing it (components/primitives/PaneDetail.tsx).
  const besideList = useBesideList();
  const onBack = besideList ? undefined : onBackProp;
  /* The listeners read the LATEST Back through a ref and are attached once
     per "has a Back". Keyed on the function itself, a page that passes a new
     arrow on every render (Roster's) tore them down and re-attached them
     whenever its parent re-rendered, and the teardown's settle() dropped a
     swipe in progress: one cause of "not always work" (2026-11-15). */
  const backRef = useRef(onBack);
  useEffect(() => { backRef.current = onBack; }, [onBack]);
  const hasBack = !!onBack;

  // Scroll-condense (shared with PageHeader), on whichever element scrolls —
  // see useScrollCondensed.
  useScrollCondensed(ref);

  useEffect(() => {
    if (!hasBack) return;
    const onKey = (e: KeyboardEvent) => {
      // An open sheet answers Escape first (BottomSheet listens on document,
      // which hears it before window) and marks it handled: Escape closes the
      // sheet, never the sheet AND the page under it.
      if (e.key === 'Escape' && !e.defaultPrevented && isBarOnScreen(ref.current)) backRef.current?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [hasBack]);

  // Edge swipe-back gesture with live micro-interaction. A touch that
  // starts in the left 24px gutter and travels mostly horizontally
  // rightward triggers onBack on release if it crosses the threshold.
  //
  // During the drag we write a 0..1 progress to `--swipe-back` on
  // `<html>` and toggle `data-swiping="true"`. CSS rules consume these
  // to nudge the back chevron and glow the left edge. The page itself
  // never moves (globals.css, "THE PAGE ITSELF DOES NOT MOVE").
  // On commit we navigate; on cancel we drop `data-swiping` so the
  // springback transition runs.
  // Edge swipe-back gesture with live micro-interaction. A touch that
  // starts in the left 24px gutter and travels mostly horizontally
  // rightward triggers onBack on release if it crosses the threshold.
  //
  // State machine on `<html>`:
  //   - `data-swiping="active"` during the drag (no CSS transition;
  //     transforms track the finger 1:1).
  //   - `data-swiping="release"` for ~260ms after release while the
  //     springback transition runs.
  //   - attribute absent at rest, so the glow and the chevron's nudge
  //     paint only during a gesture. Nothing ever transforms the page
  //     shell: even `translateX(0)` would establish a containing block
  //     and break `position: fixed` descendants (the "containing-block
  //     trap"), and while dragging it broke the top bar's frost.
  useEffect(() => {
    if (!hasBack) return;
    const root = document.documentElement;
    // Outlives the `--duration-normal` (250ms) release transitions in globals.css.
    const RELEASE_MS = 260;
    /* FORGIVING, LIKE THE PHONE'S OWN BACK SWIPE (Grant, 2026-11-15: "the
       swipe is janky, not always work"). It used to need a start inside 24px,
       a release inside 600ms and under 40px of drift, so a thumb in a case, a
       deliberate slow drag or a natural arc was dropped; and the page kept
       scrolling under the finger while it moved. Now: a start inside
       EDGE_PX; a release past COMMIT_PX at any speed, or past FLICK_PX when
       quick; the drag more sideways than up or down; and once the drag is
       plainly sideways the page holds still (a touchmove listener that can
       cancel the scroll, added only for a gesture that began at the edge, so
       no other touch waits on it). */
    const EDGE_PX = 32;
    const FLICK_PX = 60;
    const FLICK_MS = 600;
    const COMMIT_PX = 110;
    const LOCK_PX = 10;
    let startX = 0;
    let startY = 0;
    let startT = 0;
    let tracking = false;
    let locked = false;
    let releaseTimer: number | null = null;
    // Non-passive, so it can hold the page still. Attached per gesture.
    const holdPage = (e: TouchEvent) => {
      if (locked && e.cancelable) e.preventDefault();
    };
    const detachHold = () => {
      locked = false;
      document.removeEventListener('touchmove', holdPage);
    };
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
      detachHold();
    };
    const beginRelease = () => {
      tracking = false;
      detachHold();
      root.setAttribute('data-swiping', 'release');
      setVar(0);
      releaseTimer = window.setTimeout(settle, RELEASE_MS);
    };
    const onStart = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!t || t.clientX > EDGE_PX || !isBarOnScreen(ref.current)) { tracking = false; return; }
      tracking = true;
      locked = false;
      document.addEventListener('touchmove', holdPage, { passive: false });
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
      // If the gesture goes vertical first, hand off to scroll.
      if (!locked && dy > LOCK_PX && dy > Math.abs(dx)) {
        beginRelease();
        return;
      }
      // Plainly sideways: from here the page holds still under the finger.
      if (!locked && dx > LOCK_PX && dx > dy) locked = true;
      const progress = Math.max(0, Math.min(1, dx / 120));
      setVar(progress);
    };
    const onEnd = (e: TouchEvent) => {
      if (!tracking) return;
      const t = e.changedTouches[0];
      const dx = t ? t.clientX - startX : 0;
      const dy = t ? Math.abs(t.clientY - startY) : 0;
      const dt = Date.now() - startT;
      const sideways = dx > dy;
      const committed = sideways && (dx > COMMIT_PX || (dx > FLICK_PX && dt < FLICK_MS));
      if (committed) {
        // Visual full-commit hold for one frame; the new screen will
        // mount with the attribute absent on next layout pass.
        setVar(1);
        requestAnimationFrame(() => {
          settle();
          if (isBarOnScreen(ref.current)) backRef.current?.();
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
  }, [hasBack]);

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
