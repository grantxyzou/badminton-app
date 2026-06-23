'use client';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { BottomSheet, BottomSheetHeader, BottomSheetBody } from './BottomSheet';
import PinInput from './PinInput';
import { setIdentity } from '@/lib/identity';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

interface Props {
  open: boolean;
  onClose: () => void;
  sessionId: string;
  /**
   * Called after a successful code redemption. The recovery code clears the
   * user's old PIN server-side, so the parent should immediately walk them
   * into setting a new one (RecoveryPinSheet first-set mode). When provided,
   * this sheet hands off instead of showing its own welcome toast.
   */
  onRecovered?: (name: string) => void;
}

export default function EnterCodeSheet({ open, onClose, sessionId, onRecovered }: Props) {
  const t = useTranslations('recovery');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<'invalid' | 'rate_limited' | 'admin_logged_in' | 'server' | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`${BASE}/api/players/recover`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), sessionId, code }),
      });
      if (res.status === 429) { setError('rate_limited'); return; }
      // Admin cookie set: /api/players/recover refuses (admins must use
      // /reset-access instead). Surface this distinctly so the user knows
      // they're not just typing the wrong code.
      if (res.status === 403) { setError('admin_logged_in'); return; }
      // A 5xx means the server broke, NOT that the code is wrong. Mapping it to
      // 'invalid' tells the user to re-type a code that may be correct — and
      // recovery is rate-limited (10/hr), so burning attempts on a server
      // outage is costly. Split server errors out as a retryable 'server'.
      if (res.status >= 500) { setError('server'); return; }
      if (!res.ok) { setError('invalid'); return; }
      const body = await res.json();
      const recoveredName = name.trim();
      setIdentity({ name: recoveredName, token: body.deleteToken, sessionId });
      if (onRecovered) {
        // Hand off to the parent to prompt a new PIN (the old one was just
        // cleared). Reset local fields so a reopen starts clean.
        setName('');
        setCode('');
        onRecovered(recoveredName);
        return;
      }
      setSuccess(recoveredName);
      setTimeout(() => { onClose(); setSuccess(null); }, 1500);
    } catch {
      // Network failure (fetch rejects) — also not the user's fault.
      setError('server');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <BottomSheet open={open} onClose={onClose} ariaLabel={t('codePathTitle')} className="max-w-lg mx-auto">
      <BottomSheetHeader className="flex items-center justify-between p-4">
        <span style={{ fontSize: 16, fontWeight: 600 }}>{t('codePathTitle')}</span>
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
            {t('welcomeBack', { name: success })}
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: 0 }}>
              {t('codePathHelp')}
            </p>
            <input
              type="text"
              aria-label={t('nameLabel')}
              placeholder={t('nameLabel')}
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="nickname"
              style={{
                width: '100%',
                padding: 12,
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--glass-border)',
                background: 'var(--input-bg, rgba(255,255,255,0.05))',
                color: 'var(--text-primary)',
              }}
            />
            <PinInput
              value={code}
              onChange={setCode}
              digits={6}
              label={t('codeLabel')}
              ariaInvalid={error === 'invalid'}
            />
            <button
              type="button"
              disabled={submitting || !name.trim() || code.length !== 6}
              onClick={submit}
              className="cc-btn cc-btn-primary cc-btn-lg"
              style={{ marginTop: 4 }}
            >
              {t('submitCode')}
            </button>
            {error === 'invalid' && (
              <p role="alert" style={{ color: 'var(--color-red, #ef4444)', fontSize: 12 }}>
                {t('errorInvalid')}
              </p>
            )}
            {error === 'rate_limited' && (
              <p role="alert" style={{ color: 'var(--color-amber, #f59e0b)', fontSize: 12 }}>
                {t('errorRateLimited')}
              </p>
            )}
            {error === 'admin_logged_in' && (
              <p role="alert" style={{ color: 'var(--color-amber, #f59e0b)', fontSize: 12 }}>
                {t('errorAdminLoggedIn')}
              </p>
            )}
            {error === 'server' && (
              <p role="alert" style={{ color: 'var(--color-amber, #f59e0b)', fontSize: 12 }}>
                {t('errorNetwork')}
              </p>
            )}
          </div>
        )}
      </BottomSheetBody>
    </BottomSheet>
  );
}
