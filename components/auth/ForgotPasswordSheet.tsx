'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { BottomSheet, BottomSheetHeader, BottomSheetBody } from '@/components/BottomSheet';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

interface Props {
  open: boolean;
  onClose: () => void;
}

/**
 * Ask for a password-reset link.
 *
 * `POST /api/auth/forgot-password` ALWAYS answers 200 with the same body,
 * whether or not the address has an account — otherwise the response would tell
 * an attacker which of the group's members have accounts, and member names are
 * already enumerable via `GET /api/members`.
 *
 * The UI has to honour that: the confirmation is deliberately conditional
 * ("if that address has an account…") and is shown for every 200. The one case
 * where it must NOT appear is a network or 5xx failure — nothing was sent, and
 * claiming otherwise would leave someone waiting for mail that never comes.
 *
 * The confirmation copy is ours, not the server's `message`: that field is
 * English prose and would render untranslated in zh-CN.
 */
export default function ForgotPasswordSheet({ open, onClose }: Props) {
  const t = useTranslations('profile.auth');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !email.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${BASE}/api/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      });
      if (res.status === 429) {
        setError(t('forgotRateLimited'));
        setBusy(false);
        return;
      }
      if (!res.ok) {
        // Nothing was sent. Showing the neutral confirmation here would leave
        // someone waiting on an email that does not exist.
        setError(t('forgotFailed'));
        setBusy(false);
        return;
      }
      setSent(true);
    } catch {
      setError(t('forgotFailed'));
      setBusy(false);
    }
  }

  return (
    <BottomSheet open={open} onClose={onClose} ariaLabel={t('forgotTitle')}>
      <BottomSheetHeader>{t('forgotTitle')}</BottomSheetHeader>
      <BottomSheetBody>
        {sent ? (
          <p
            role="status"
            style={{ fontSize: 'var(--fs-md)', color: 'var(--text-primary)', margin: 0 }}
          >
            {t('forgotSent')}
          </p>
        ) : (
          <form onSubmit={submit} style={{ display: 'grid', gap: 'var(--space-4)' }}>
            <p style={{ fontSize: 'var(--fs-md)', color: 'var(--text-primary)', margin: 0 }}>
              {t('forgotBody')}
            </p>
            <input
              type="email"
              inputMode="email"
              autoComplete="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setError(null);
              }}
              placeholder={t('emailLabel')}
              aria-label={t('emailLabel')}
              maxLength={254}
              autoFocus
            />
            {error && <p className="field-error">{error}</p>}
            <button
              type="submit"
              disabled={busy || !email.trim()}
              className="cc-btn cc-btn-primary cc-btn-lg"
              style={{ width: '100%' }}
            >
              {busy ? t('forgotSending') : t('forgotCta')}
            </button>
          </form>
        )}
      </BottomSheetBody>
    </BottomSheet>
  );
}
