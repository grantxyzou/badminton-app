'use client';
import { useEffect, useState } from 'react';
import { BottomSheet, BottomSheetHeader, BottomSheetBody } from '@/components/BottomSheet';

interface Props {
  open: boolean;
  onClose: () => void;
  playerName: string;
  code: string;
  expiresAt: number;
}

export default function ResetAccessSheet({ open, onClose, playerName, code, expiresAt }: Props) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!open) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [open]);

  const remainingSec = Math.max(0, Math.floor((expiresAt - now) / 1000));
  const mm = Math.floor(remainingSec / 60).toString().padStart(2, '0');
  const ss = (remainingSec % 60).toString().padStart(2, '0');

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      // best-effort; silent.
    }
  }

  return (
    <BottomSheet open={open} onClose={onClose} ariaLabel={`Recovery code for ${playerName}`} className="max-w-lg mx-auto">
      <BottomSheetHeader className="flex items-center justify-between p-4">
        <span style={{ fontSize: 16, fontWeight: 600 }}>Recovery code for {playerName}</span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}
        >
          <span className="material-icons" style={{ fontSize: 20 }}>close</span>
        </button>
      </BottomSheetHeader>
      <BottomSheetBody className="p-5 pb-8">
        <div style={{ textAlign: 'center' }}>
          <p
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 36,
              letterSpacing: '0.3em',
              margin: '24px 0 16px',
            }}
            aria-live="polite"
          >
            {code}
          </p>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 20 }}>
            Expires in {mm}:{ss}
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" onClick={copy} className="btn-ghost" style={{ flex: 1 }}>
              Copy
            </button>
            <button type="button" onClick={onClose} className="btn-primary" style={{ flex: 1 }}>
              Done
            </button>
          </div>
        </div>
      </BottomSheetBody>
    </BottomSheet>
  );
}
