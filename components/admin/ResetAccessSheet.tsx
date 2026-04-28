'use client';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { BottomSheet, BottomSheetHeader, BottomSheetBody } from '@/components/BottomSheet';

interface Props {
  open: boolean;
  onClose: () => void;
  playerName: string;
  code: string;
  expiresAt: number;
}

export default function ResetAccessSheet({ open, onClose, playerName, code, expiresAt }: Props) {
  const t = useTranslations('admin.resetAccess');
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!open) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [open]);

  const remainingSec = Math.max(0, Math.floor((expiresAt - now) / 1000));
  const mm = Math.floor(remainingSec / 60).toString().padStart(2, '0');
  const ss = (remainingSec % 60).toString().padStart(2, '0');
  const titleText = t('title', { name: playerName });

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      // best-effort; silent.
    }
  }

  return (
    <BottomSheet open={open} onClose={onClose} ariaLabel={titleText} className="max-w-lg mx-auto">
      <BottomSheetHeader className="flex items-center justify-between p-4">
        <span style={{ fontSize: 16, fontWeight: 600 }}>{titleText}</span>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('close')}
          style={{ background: 'transparent', border: 'none', cursor: 'pointer', minWidth: 44, minHeight: 44, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <span className="material-icons" style={{ fontSize: 20 }}>close</span>
        </button>
      </BottomSheetHeader>
      <BottomSheetBody className="p-5 pb-8">
        <div style={{ textAlign: 'center' }}>
          <p
            role="text"
            aria-label={`Recovery code: ${code.split('').join(' ')}`}
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 36,
              letterSpacing: '0.3em',
              margin: '24px 0 16px',
            }}
          >
            {code}
          </p>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 20 }}>
            {t('expiresIn', { time: `${mm}:${ss}` })}
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" onClick={copy} className="btn-ghost" style={{ flex: 1 }}>
              {t('copy')}
            </button>
            <button type="button" onClick={onClose} className="btn-primary" style={{ flex: 1 }}>
              {t('done')}
            </button>
          </div>
        </div>
      </BottomSheetBody>
    </BottomSheet>
  );
}
