'use client';

import { useEffect } from 'react';

interface Props {
  onClose: () => void;
}

/**
 * Placeholder demo overlay. Triggered by the 7-tap title easter egg
 * (`app/page.tsx`). Full-screen, dismissible via the top-right X or Escape.
 *
 * This is intentionally bare — content lands here in a future pass.
 */
export default function DemoMode({ onClose }: Props) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Demo mode"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100,
        background: 'var(--page-bg)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Exit demo mode"
        style={{
          position: 'absolute',
          top: 16,
          right: 16,
          width: 44,
          height: 44,
          borderRadius: 22,
          border: '1px solid var(--glass-border)',
          background: 'var(--glass-bg)',
          color: 'var(--text-primary)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          backdropFilter: 'blur(10px)',
          WebkitBackdropFilter: 'blur(10px)',
        }}
      >
        <span className="material-icons" aria-hidden="true">close</span>
      </button>

      <div style={{ textAlign: 'center', maxWidth: 360 }}>
        <h1
          className="bpm-h1"
          style={{ marginBottom: 12 }}
        >
          Demo mode
        </h1>
        <p style={{ fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.5 }}>
          Placeholder. A guided tour of the app lands here in a future pass.
        </p>
      </div>
    </div>
  );
}
