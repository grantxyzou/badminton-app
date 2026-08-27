'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { BottomSheet, BottomSheetHeader, BottomSheetBody } from '@/components/BottomSheet';
import { setIdentity } from '@/lib/identity';
import { PASSWORD_MIN_LENGTH, isCommonPassword } from '@/lib/passwordRules';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

interface Props {
  open: boolean;
  request: { token: string; email: string } | null;
  sessionId: string;
  onClose: () => void;
  /** Password changed and the user is signed in. */
  onDone: () => void;
  /** The link was dead; send them somewhere they can ask for a fresh one. */
  onNeedNewLink: () => void;
}

/**
 * Set a new password from an emailed reset link.
 *
 * The link lands on `/bpm?reset=<token>&email=…`; `HomeShell` reads and strips
 * those params (the token is a live credential and must not linger in history
 * or in the URL the iOS PWA restores) and opens this.
 *
 * `POST /api/auth/reset-password` signs the user in on success — they have just
 * proven control of the mailbox — so this writes the identity rather than
 * sending them back to a sign-in form they no longer need.
 *
 * The two failure modes are deliberately NOT collapsed into one message:
 *
 *  - `invalid_token` — the link is used or expired. They need a new one, and
 *    the copy has to say so or they will keep retrying a dead link.
 *  - `weak_password` — the route validates strength BEFORE touching the token,
 *    so the link is still good. The copy says that explicitly; sending them off
 *    for another link would be wrong and would waste the one they hold.
 */
export default function ResetPasswordSheet({
  open,
  request,
  sessionId,
  onClose,
  onDone,
  onNeedNewLink,
}: Props) {
  const t = useTranslations('profile.auth');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);

  // Mirrors the server's rules for instant feedback, with LOCALIZED copy — the
  // server's own `reason` is English prose and would show untranslated.
  const tooShort = password.length > 0 && password.length < PASSWORD_MIN_LENGTH;
  const tooCommon = password.length >= PASSWORD_MIN_LENGTH && isCommonPassword(password);
  const mismatch = confirm.length > 0 && password !== confirm;
  const canSubmit =
    !busy && password.length >= PASSWORD_MIN_LENGTH && !tooCommon && password === confirm;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || !request) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${BASE}/api/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: request.email, token: request.token, password }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        if (res.status === 429) setError(t('resetRateLimited'));
        else if (data.error === 'weak_password') setError(t('resetWeak'));
        else if (data.error === 'invalid_token') setExpired(true);
        else setError(t('resetFailed'));
        setBusy(false);
        return;
      }

      // The endpoint signed them in; mirror it so the app agrees.
      setIdentity({ name: data.name, sessionId });
      onDone();
    } catch {
      setError(t('resetFailed'));
      setBusy(false);
    }
  }

  return (
    <BottomSheet open={open} onClose={onClose} ariaLabel={t('resetTitle')}>
      <BottomSheetHeader>{t('resetTitle')}</BottomSheetHeader>
      <BottomSheetBody>
        {expired ? (
          <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
            <p style={{ fontSize: 'var(--fs-md)', color: 'var(--text-primary)', margin: '0' }}>
              {t('resetExpired')}
            </p>
            <button
              type="button"
              onClick={onNeedNewLink}
              className="cc-btn cc-btn-primary cc-btn-lg"
              style={{ width: '100%' }}
            >
              {t('resetGetNewLink')}
            </button>
          </div>
        ) : (
          <form onSubmit={submit} style={{ display: 'grid', gap: 'var(--space-4)' }}>
            <p style={{ fontSize: 'var(--fs-md)', color: 'var(--text-primary)', margin: '0' }}>
              {t('resetBody')}
            </p>
            <input
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setError(null);
              }}
              placeholder={t('newPasswordLabel')}
              aria-label={t('newPasswordLabel')}
              maxLength={200}
              autoFocus
            />
            <input
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => {
                setConfirm(e.target.value);
                setError(null);
              }}
              placeholder={t('confirmPasswordLabel')}
              aria-label={t('confirmPasswordLabel')}
              maxLength={200}
            />
            {tooShort && <p className="field-error">{t('passwordTooShort')}</p>}
            {tooCommon && <p className="field-error">{t('passwordTooCommon')}</p>}
            {mismatch && <p className="field-error">{t('passwordMismatch')}</p>}
            {error && <p className="field-error">{error}</p>}
            <button
              type="submit"
              disabled={!canSubmit}
              className="cc-btn cc-btn-primary cc-btn-lg"
              style={{ width: '100%' }}
            >
              {busy ? t('resetSaving') : t('resetCta')}
            </button>
          </form>
        )}
      </BottomSheetBody>
    </BottomSheet>
  );
}
