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
  const sheetRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Body scroll lock — only when open.
  useBodyScrollLock(open && mounted);

  // Focus trap + return focus on close — only when open.
  useFocusTrap(open && mounted, sheetRef, triggerRef);

  // Escape key dismiss
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open || !mounted) return null;

  return createPortal(
    <div
      ref={sheetRef}
      className={`fixed bottom-0 left-0 right-0 rounded-t-2xl overflow-hidden ${className ?? ''}`}
      style={{ zIndex: 60, maxHeight }}
      role="dialog"
      aria-label={ariaLabel}
    >
      {children}
    </div>,
    document.body,
  );
}
