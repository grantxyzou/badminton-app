'use client';

import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';

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

function findScroller(el: HTMLElement): HTMLElement | Window {
  let node: HTMLElement | null = el.parentElement;
  while (node) {
    const style = getComputedStyle(node);
    if (/(auto|scroll|overlay)/.test(style.overflowY)) return node;
    node = node.parentElement;
  }
  return window;
}

export default function TopBar({ title, crumb, onBack, right, backLabel = 'Back' }: TopBarProps) {
  const ref = useRef<HTMLDivElement>(null);

  // Sync the initial state in a layout effect so we don't paint at-rest
  // for one frame when navigating to a screen that's already scrolled.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof window === 'undefined') return;
    const scroller = findScroller(el);
    const top = scroller === window ? window.scrollY : (scroller as HTMLElement).scrollTop;
    el.classList.toggle('scrolled', top > 8);
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const scroller = findScroller(el);
    const getTop = () =>
      scroller === window ? window.scrollY : (scroller as HTMLElement).scrollTop;
    const update = () => el.classList.toggle('scrolled', getTop() > 8);
    scroller.addEventListener('scroll', update, { passive: true } as AddEventListenerOptions);
    return () => scroller.removeEventListener('scroll', update);
  }, []);

  useEffect(() => {
    if (!onBack) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onBack();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onBack]);

  // Edge swipe-back gesture: a touch that starts in the left 24px gutter,
  // travels mostly horizontally rightward more than 60px in under 600ms,
  // triggers onBack. Mirrors the iOS interactive-pop affordance for our
  // in-app sub-pages (which use prop-driven navigation, not browser history).
  useEffect(() => {
    if (!onBack) return;
    let startX = 0;
    let startY = 0;
    let startT = 0;
    let tracking = false;
    const onStart = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!t || t.clientX > 24) { tracking = false; return; }
      tracking = true;
      startX = t.clientX;
      startY = t.clientY;
      startT = Date.now();
    };
    const onEnd = (e: TouchEvent) => {
      if (!tracking) return;
      tracking = false;
      const t = e.changedTouches[0];
      if (!t) return;
      const dx = t.clientX - startX;
      const dy = Math.abs(t.clientY - startY);
      const dt = Date.now() - startT;
      if (dx > 60 && dy < 40 && dt < 600) onBack();
    };
    document.addEventListener('touchstart', onStart, { passive: true });
    document.addEventListener('touchend', onEnd, { passive: true });
    document.addEventListener('touchcancel', onEnd, { passive: true });
    return () => {
      document.removeEventListener('touchstart', onStart);
      document.removeEventListener('touchend', onEnd);
      document.removeEventListener('touchcancel', onEnd);
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
