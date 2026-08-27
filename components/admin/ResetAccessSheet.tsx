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
    <BottomSheet open={open} onClose={onClose} ariaLabel={titleText}>
      <BottomSheetHeader>
        <span style={{ fontSize: 'var(--fs-lg)', fontWeight: 600 }}>{titleText}</span>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('close')}
          style={{ background: 'transparent', border: 'none', cursor: 'pointer', minWidth: 44, minHeight: 44, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <span className="material-icons" style={{ fontSize: 'var(--fs-stat)' }}>close</span>
        </button>
      </BottomSheetHeader>
      <BottomSheetBody>
        <div style={{ textAlign: 'center' }}>
          <p
            role="img"
            aria-label={`Recovery code: ${code.split('').join(' ')}`}
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 36,
              letterSpacing: '0.3em',
              margin: 'var(--space-7) 0 var(--space-5)',
            }}
          >
            {code}
          </p>
          <p style={{ fontSize: 'var(--fs-base)', color: 'var(--text-secondary)', marginBottom: 'var(--space-6)' }}>
            {t('expiresIn', { time: `${mm}:${ss}` })}
          </p>
          <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
            <button type="button" onClick={copy} className="btn-ghost" style={{ flex: 1 }}>
              {t('copy')}
            </button>
            <button type="button" onClick={onClose} className="cc-btn cc-btn-primary" style={{ flex: 1 }}>
              {t('done')}
            </button>
          </div>
        </div>
      </BottomSheetBody>
    </BottomSheet>
  );
}
