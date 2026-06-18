'use client';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { BottomSheet, BottomSheetHeader, BottomSheetBody } from './BottomSheet';
import { useOnline } from '@/lib/useOnline';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Reporter's name, if signed in — attached so I know who to follow up with. */
  name?: string;
}

export default function ReportProblemSheet({ open, onClose, name }: Props) {
  const t = useTranslations('report');
  const online = useOnline();
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<'required' | 'server' | null>(null);
  const [success, setSuccess] = useState(false);

  async function submit() {
    const trimmed = message.trim();
    if (!trimmed) {
      setError('required');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`${BASE}/api/report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: trimmed,
          name: name?.trim() || undefined,
          // Which tab they were on — the most useful context for reproducing.
          tab:
            typeof document !== 'undefined'
              ? document.documentElement.getAttribute('data-tab') || undefined
              : undefined,
          url: typeof window !== 'undefined' ? window.location.pathname : undefined,
        }),
      });
      if (!res.ok) {
        setError('server');
        return;
      }
      setSuccess(true);
      setMessage('');
      setTimeout(() => {
        onClose();
        setSuccess(false);
      }, 1600);
    } catch {
      // Network failure (fetch rejects) — retryable, not the user's fault.
      setError('server');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <BottomSheet open={open} onClose={onClose} ariaLabel={t('title')} className="max-w-lg mx-auto">
      <BottomSheetHeader className="flex items-center justify-between p-4">
        <span style={{ fontSize: 16, fontWeight: 600 }}>{t('title')}</span>
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
        {success ? (
          <p style={{ textAlign: 'center', fontSize: 18, color: 'var(--text-primary)' }}>
            {t('success')}
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: 0 }}>{t('help')}</p>
            <textarea
              aria-label={t('placeholder')}
              placeholder={t('placeholder')}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={4}
              maxLength={2000}
              style={{
                width: '100%',
                padding: 12,
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--glass-border)',
                background: 'var(--input-bg, rgba(255,255,255,0.05))',
                color: 'var(--text-primary)',
                resize: 'vertical',
                fontFamily: 'inherit',
                fontSize: 14,
              }}
            />
            <button
              type="button"
              disabled={submitting || !message.trim() || !online}
              onClick={submit}
              className="cc-btn cc-btn-primary cc-btn-lg"
              style={{ marginTop: 4 }}
            >
              {submitting ? t('sending') : t('send')}
            </button>
            {!online && (
              <p role="status" style={{ color: 'var(--color-amber, #f59e0b)', fontSize: 12 }}>
                {t('offline')}
              </p>
            )}
            {error === 'required' && (
              <p role="alert" style={{ color: 'var(--color-red, #ef4444)', fontSize: 12 }}>
                {t('errorRequired')}
              </p>
            )}
            {error === 'server' && (
              <p role="alert" style={{ color: 'var(--color-amber, #f59e0b)', fontSize: 12 }}>
                {t('errorServer')}
              </p>
            )}
          </div>
        )}
      </BottomSheetBody>
    </BottomSheet>
  );
}
