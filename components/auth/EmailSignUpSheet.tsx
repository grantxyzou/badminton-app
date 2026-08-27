'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { BottomSheet, BottomSheetHeader, BottomSheetBody } from '@/components/BottomSheet';
import { PASSWORD_MIN_LENGTH, isCommonPassword } from '@/lib/passwordRules';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Account created and signed in. */
  onSuccess: (result: { name: string }) => void;
}

/**
 * Create an account with a name, an email address and a password.
 *
 * The strength check mirrors `lib/passwordRules.ts` so a too-short password is
 * caught before any request — but the SERVER stays authoritative, and its own
 * `reason` string is deliberately never rendered: it is English prose and would
 * appear untranslated in zh-CN.
 *
 * `name_taken` and `email_taken` get distinct copy on purpose. They need
 * different actions from the user — one means "sign in instead", the other
 * "that address is spoken for" — and a shared "couldn't create that" would
 * leave them guessing which.
 *
 * On success the route reports `verificationSent`. When it is false the sheet
 * says so plainly rather than closing while implying a mail is on its way; the
 * account is real and usable either way.
 */
export default function EmailSignUpSheet({ open, onClose, onSuccess }: Props) {
  const t = useTranslations('profile.auth');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unsentNote, setUnsentNote] = useState<string | null>(null);

  const tooShort = password.length > 0 && password.length < PASSWORD_MIN_LENGTH;
  const tooCommon = password.length >= PASSWORD_MIN_LENGTH && isCommonPassword(password);
  const canSubmit =
    !busy &&
    !!name.trim() &&
    !!email.trim() &&
    password.length >= PASSWORD_MIN_LENGTH &&
    !tooCommon;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${BASE}/api/auth/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), email: email.trim(), password }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        if (res.status === 429) setError(t('signUpRateLimited'));
        else if (data.error === 'name_taken') setError(t('signUpNameTaken'));
        else if (data.error === 'email_taken') setError(t('signUpEmailTaken'));
        else if (data.error === 'weak_password') setError(t('passwordTooCommon'));
        else if (data.error === 'invalid_request') setError(t('signUpInvalidEmail'));
        else setError(t('signUpFailed'));
        setBusy(false);
        return;
      }

      if (data.verificationSent === false) {
        // Real account, no mail. Say it rather than implying one is coming.
        setUnsentNote(t('verifyMailUnsent'));
        setBusy(false);
        // The caller still signs them in; the note is dismissed by closing.
        onSuccess({ name: data.name });
        return;
      }
      onSuccess({ name: data.name });
    } catch {
      setError(t('signUpFailed'));
      setBusy(false);
    }
  }

  return (
    <BottomSheet open={open} onClose={onClose} ariaLabel={t('emailSignUpTitle')}>
      <BottomSheetHeader>{t('emailSignUpTitle')}</BottomSheetHeader>
      <BottomSheetBody>
        {unsentNote ? (
          <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
            <p
              role="status"
              style={{ fontSize: 'var(--fs-md)', color: 'var(--text-primary)', margin: '0' }}
            >
              {unsentNote}
            </p>
            <button
              type="button"
              onClick={onClose}
              className="cc-btn cc-btn-primary cc-btn-lg"
              style={{ width: '100%' }}
            >
              {t('chooseNameCta')}
            </button>
          </div>
        ) : (
          <form onSubmit={submit} style={{ display: 'grid', gap: 'var(--space-3)' }}>
            <p style={{ fontSize: 'var(--fs-md)', color: 'var(--text-primary)', margin: '0' }}>
              {t('emailSignUpBody')}
            </p>
            <input
              type="text"
              autoComplete="nickname"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setError(null);
              }}
              placeholder={t('yourNameLabel')}
              aria-label={t('yourNameLabel')}
              maxLength={50}
              autoFocus
            />
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
            />
            <input
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setError(null);
              }}
              placeholder={t('passwordLabel')}
              aria-label={t('passwordLabel')}
              maxLength={200}
            />
            {tooShort && <p className="field-error">{t('passwordTooShort')}</p>}
            {tooCommon && <p className="field-error">{t('passwordTooCommon')}</p>}
            {error && <p className="field-error">{error}</p>}
            <button
              type="submit"
              disabled={!canSubmit}
              className="cc-btn cc-btn-primary cc-btn-lg"
              style={{ width: '100%' }}
            >
              {busy ? t('emailSignUpSaving') : t('emailSignUpCta')}
            </button>
          </form>
        )}
      </BottomSheetBody>
    </BottomSheet>
  );
}
