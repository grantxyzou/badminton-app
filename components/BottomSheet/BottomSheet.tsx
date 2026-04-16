'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useBodyScrollLock } from './useBodyScrollLock';
import { useFocusTrap } from './useFocusTrap';

export interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  ariaLabel: string;
  children: React.ReactNode;
  maxHeight?: string;
  triggerRef?: React.RefObject<HTMLElement>;
  className?: string;
}

type SheetState = 'closed' | 'opening' | 'open' | 'closing';

export default function BottomSheet({
  open,
  onClose,
  ariaLabel,
  children,
  maxHeight = '80vh',
  triggerRef,
  className,
}: BottomSheetProps) {
  const [mounted, setMounted] = useState(false);
  const [state, setState] = useState<SheetState>('closed');
  const sheetRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Drive the state machine off the open prop: request opening/closing.
  useEffect(() => {
    if (open && (state === 'closed' || state === 'closing')) {
      setState('opening');
      return;
    }
    if (!open && (state === 'open' || state === 'opening')) {
      setState('closing');
      return;
    }
  }, [open, state]);

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

  // Escape key dismiss while visible.
  useEffect(() => {
    if (!visible) return;
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
    <div
      ref={sheetRef}
      data-state={state}
      className={`bottom-sheet fixed bottom-0 left-0 right-0 rounded-t-2xl overflow-hidden flex flex-col ${className ?? ''}`}
      style={{ zIndex: 60, maxHeight }}
      role="dialog"
      aria-label={ariaLabel}
    >
      {children}
    </div>,
    document.body,
  );
}
