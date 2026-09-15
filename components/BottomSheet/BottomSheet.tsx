'use client';

import { useEffect, useRef, useState } from 'react';
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
      >
        {children}
      </div>
    </>,
    document.body,
  );
}
