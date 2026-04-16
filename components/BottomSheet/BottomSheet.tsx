'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

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
  ariaLabel,
  children,
  maxHeight = '80vh',
  className,
}: BottomSheetProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!open || !mounted) return null;

  return createPortal(
    <div
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
