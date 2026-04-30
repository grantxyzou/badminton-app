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
  /** When provided, a small "Forgot your PIN?" text link is rendered below the
   *  Sign in button. Click closes the sheet and invokes this callback so the
   *  caller can hand off to a code-redemption surface (e.g. open EnterCodeSheet
   *  or navigate to Profile). */
  onForgotPin?: () => void;
}

export default function RecoverySheet({ open, onClose, sessionId, onForgotPin }: Props) {
  const t = useTranslations('recovery');
  const [name, setName] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState<'invalid' | 'rate_limited' | 'admin_logged_in' | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`${BASE}/api/players/recover`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), sessionId, pin }),
      });
      if (res.status === 429) { setError('rate_limited'); return; }
      // Admin cookie set: /api/players/recover refuses (admins must use
      // /reset-access instead). Surface this distinctly so the user knows
      // they're not just typing the wrong PIN.
      if (res.status === 403) { setError('admin_logged_in'); return; }
      if (!res.ok) { setError('invalid'); return; }
      const body = await res.json();
      setIdentity({ name: name.trim(), token: body.deleteToken, sessionId });
      setSuccess(name.trim());
      setTimeout(() => { onClose(); setSuccess(null); }, 1500);
    } finally {
      setSubmitting(false);
    }
  }

  function handleForgotPin() {
    onClose();
    onForgotPin?.();
  }

  return (
    <BottomSheet open={open} onClose={onClose} ariaLabel={t('sheetTitle')} className="max-w-lg mx-auto">
      <BottomSheetHeader className="flex items-center justify-between p-4">
        <span style={{ fontSize: 16, fontWeight: 600 }}>{t('sheetTitle')}</span>
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
            <input
              type="text"
              aria-label={t('nameLabel')}
              placeholder={t('nameLabel')}
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="username"
            />
            <PinInput
              value={pin}
              onChange={setPin}
              digits={4}
              label={t('pinLabel')}
              ariaInvalid={error === 'invalid'}
            />
            <button
              type="button"
              disabled={submitting || !name.trim() || pin.length !== 4}
              onClick={submit}
              className="btn-primary"
              style={{ marginTop: 4, width: '100%' }}
            >
              {t('submitPin')}
            </button>
            {onForgotPin && (
              <button
                type="button"
                onClick={handleForgotPin}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--text-secondary)',
                  fontSize: 12,
                  textDecoration: 'underline',
                  cursor: 'pointer',
                  alignSelf: 'center',
                  padding: '0 12px',
                  minHeight: 44,
                  display: 'inline-flex',
                  alignItems: 'center',
                }}
              >
                {t('forgotPinLink')}
              </button>
            )}
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
          </div>
        )}
      </BottomSheetBody>
    </BottomSheet>
  );
}
