'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useBodyScrollLock } from './useBodyScrollLock';
import { useFocusTrap } from './useFocusTrap';
import { registerOpenSheet } from '@/lib/sheetStack';
import { useHydrated } from '@/lib/useClientValue';

export interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  ariaLabel: string;
  children: React.ReactNode;
  triggerRef?: React.RefObject<HTMLElement>;
  /**
   * Styling hooks only (e.g. `terminal-sheet`). NOT a size: width and height
   * belong to `.bottom-sheet` in globals.css so every sheet is the same size,
   * and `__tests__/sheet-size-canary.test.ts` refuses a size class here. The
   * per-call-site width and height-cap props this replaced gave the app three
   * widths and nine height caps.
   */
  className?: string;
  /**
   * Escape-to-dismiss. Defaults to true, which is every existing consumer.
   *
   * Set false ONLY for a sheet that must be answered rather than dismissed —
   * currently just the club-comparison consent sheet, where "asked once" is
   * the whole design and a dismissal would mean asking again next week.
   *
   * There is nothing else to switch off: this component never renders a close
   * button (call sites supply their own — `SheetCloseButton` — so one can be
   * omitted) and a tap on the backdrop never dismisses. The focus trap and scroll
   * lock keep working, so a non-dismissible sheet MUST give the user a real
   * way out in its own content — otherwise focus is trapped with no exit.
   */
  closeOnEscape?: boolean;
}

type SheetState = 'closed' | 'opening' | 'open' | 'closing';

/** Past this much travel, letting go dismisses. A quarter of the sheet, with a
 *  floor so a short sheet still needs a deliberate drag. */
const DISMISS_FRACTION = 0.25;
const DISMISS_FLOOR_PX = 88;
/** …or a flick: px per ms, downward. Matches the feel of a native sheet, where
 *  a fast short flick dismisses and a slow long drag can still be taken back. */
const FLICK_VELOCITY = 0.55;
/** Above the sheet's own top edge the drag rubber-bands instead of following,
 *  so an upward pull says "this does not go up" rather than tearing the sheet
 *  off the bottom of the screen. */
const UP_RESISTANCE = 0.18;

export default function BottomSheet({
  open,
  onClose,
  ariaLabel,
  children,
  triggerRef,
  className,
  closeOnEscape = true,
}: BottomSheetProps) {
  const mounted = useHydrated();
  const [state, setState] = useState<SheetState>('closed');
  const sheetRef = useRef<HTMLDivElement>(null);
  /** Live drag, or null. Held in a ref and written straight to the DOM: React
   *  is not involved during the gesture, the same rule `SwipeRow` follows —
   *  a setState per `pointermove` re-renders the whole sheet every frame. */
  const drag = useRef<{ id: number; startY: number; y: number; at: number; v: number } | null>(null);

  // While open, be closable by the Android back button (lib/sheetStack.ts).
  // The cleanup unregisters on close and on unmount alike.
  useEffect(() => {
    if (!open) return;
    return registerOpenSheet(onClose);
  }, [open, onClose]);

  // Drive the state machine off the open prop: request opening/closing.
  //
  // Adjusted DURING RENDER rather than in an effect. React re-renders
  // immediately on a same-component setState here, before anything is
  // committed, so the sheet never paints a frame in the stale state — the
  // effect version always did, which is the flash this replaces.
  //
  // It must stay a plain conditional, NOT one guarded on `open` having just
  // changed: the machine has to react to `state` moving under a constant
  // `open` too. A sheet reopened mid-close lands on open=true/state='closing',
  // and the closing→closed effect can then take it to 'closed' with `open`
  // never changing. Guarding on `open` alone would strand it shut.
  //
  // It terminates: both targets ('opening', 'closing') fail both conditions on
  // the next pass, so at most one extra render happens.
  if (open && (state === 'closed' || state === 'closing')) {
    setState('opening');
  } else if (!open && (state === 'open' || state === 'opening')) {
    setState('closing');
  }

  // 'opening' → 'open' on the next frame so the CSS transition runs from
  // translateY(100%) → translateY(0).
  useEffect(() => {
    if (state !== 'opening') return;
    const raf = requestAnimationFrame(() => setState('open'));
    return () => cancelAnimationFrame(raf);
  }, [state]);

  // 'closing' → 'closed' on transitionend (with a 220ms safety net, since
  // jsdom does not fire CSS transitionend events).
  useEffect(() => {
    if (state !== 'closing') return;
    const sheet = sheetRef.current;
    let cleared = false;
    function finish() {
      if (cleared) return;
      cleared = true;
      setState('closed');
    }
    function onEnd(e: TransitionEvent) {
      if (e.propertyName !== 'transform') return;
      finish();
    }
    sheet?.addEventListener('transitionend', onEnd);
    const safety = setTimeout(finish, 220);
    return () => {
      sheet?.removeEventListener('transitionend', onEnd);
      clearTimeout(safety);
    };
  }, [state]);

  const visible = state !== 'closed';

  // Body lock + focus trap active only while visible.
  useBodyScrollLock(visible && mounted);
  useFocusTrap(visible && mounted, sheetRef, triggerRef);

  // Escape key dismiss while visible (unless the sheet must be answered).
  useEffect(() => {
    if (!visible || !closeOnEscape) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [visible, onClose]);

  /** Put the sheet back where CSS wants it, and let CSS animate again. */
  const releaseDrag = useCallback(() => {
    const sheet = sheetRef.current;
    drag.current = null;
    if (!sheet) return;
    delete sheet.dataset.dragging;
    sheet.style.transform = '';
  }, []);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    // Only from a grab surface: the grabber and the header. Dragging from the
    // body would fight its own scroll, and this sheet's body is the scroller
    // for every list in the app.
    if (!(e.target as HTMLElement).closest('[data-sheet-grab]')) return;
    // 'opening' counts: that state lasts one frame, and a finger already on
    // the glass as the sheet arrives is a real gesture, not a mistake.
    if ((state !== 'open' && state !== 'opening') || !closeOnEscape || drag.current) return;
    const sheet = sheetRef.current;
    if (!sheet) return;
    // `performance.now()`, not `event.timeStamp`: a synthetic event's stamp is
    // read-only and browser-set, so velocity has to come from a clock both the
    // app and a test can read.
    drag.current = { id: e.pointerId, startY: e.clientY, y: 0, at: performance.now(), v: 0 };
    sheet.dataset.dragging = 'true';
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }, [state, closeOnEscape]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const d = drag.current;
    const sheet = sheetRef.current;
    if (!d || !sheet || e.pointerId !== d.id) return;
    const raw = e.clientY - d.startY;
    const y = raw >= 0 ? raw : raw * UP_RESISTANCE;
    const now = performance.now();
    const dt = now - d.at;
    // Velocity from the LAST move only: an average over the whole gesture
    // reads a long slow drag that ends in a flick as slow.
    if (dt > 0) d.v = (y - d.y) / dt;
    d.y = y;
    d.at = now;
    sheet.style.transform = `translateY(${y}px)`;
  }, []);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    const d = drag.current;
    const sheet = sheetRef.current;
    if (!d || e.pointerId !== d.id) return;
    const height = sheet?.getBoundingClientRect().height ?? 0;
    const far = d.y > Math.max(DISMISS_FLOOR_PX, height * DISMISS_FRACTION);
    const flicked = d.v > FLICK_VELOCITY && d.y > 0;
    releaseDrag();
    // `onClose` hands the sheet to the closing state, whose CSS carries it the
    // rest of the way down from wherever the finger left it.
    if (far || flicked) onClose();
  }, [onClose, releaseDrag]);

  // A drag interrupted by anything else (a close from elsewhere, an unmount)
  // must not leave an inline transform pinning the sheet off-screen.
  useEffect(() => {
    if (state === 'open') return;
    releaseDrag();
  }, [state, releaseDrag]);

  if (!mounted || state === 'closed') return null;

  return createPortal(
    <>
      {/* Backdrop — dims the page AND BLOCKS IT. It used to be dim only
          (`pointer-events: none`), so a tap on the dimmed page still reached
          the button underneath: the list behind an open sheet stayed live.
          It now takes the pointer while the sheet is up and does nothing with
          it — still no tap-to-dismiss (per spec: the ✕ or Escape), because a
          stray tap should not throw away a half-filled form. It lets go the
          moment the sheet starts closing (see globals.css), so a tap right
          after closing is never swallowed. */}
      <div
        data-state={state}
        className="bottom-sheet-backdrop fixed inset-0"
        style={{ zIndex: 55 }}
        aria-hidden="true"
      />
      <div
        ref={sheetRef}
        data-state={state}
        className={['bottom-sheet fixed bottom-0 left-0 right-0 rounded-t-2xl overflow-hidden flex flex-col', className]
          .filter(Boolean)
          .join(' ')}
        style={{ zIndex: 60 }}
        role="dialog"
        aria-label={ariaLabel}
        // Always attached, never conditional on a drag being live: the drag
        // lives in a ref (no re-render), so a handler attached "once dragging"
        // would not exist by the time the first move arrived. Each returns
        // immediately when there is nothing to move.
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {/* The grabber. It is what says a sheet can be dragged — every system
            sheet since iOS 13 has one, and without it the gesture is a secret.
            Decorative: the ✕ and Escape remain the named ways out, and a sheet
            that must be ANSWERED (closeOnEscape=false) gets neither a grabber
            nor a drag. */}
        {closeOnEscape && <div className="bottom-sheet-grab" data-sheet-grab aria-hidden="true"><span /></div>}
        {children}
      </div>
    </>,
    document.body,
  );
}
