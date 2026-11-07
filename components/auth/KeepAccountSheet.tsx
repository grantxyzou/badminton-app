'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { BottomSheet, BottomSheetHeader, BottomSheetBody } from '@/components/BottomSheet';
import ProviderButtons from './ProviderButtons';
import { PASSWORD_MIN_LENGTH, isCommonPassword } from '@/lib/passwordRules';
import { useOnline } from '@/lib/useOnline';
import { useSignInMethods } from './useSignInMethods';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/**
 * "Keep your account" — the step after an organiser lets someone in
 * (docs/plans/door-link.md; Grant, 2026-11-07: "after approval create an
 * account with Apple, Gmail, or email n password").
 *
 * An approval signs a person in with a 30-day session and nothing to sign in
 * WITH after it. This is where they pick one: Apple or Google (linked to the
 * account they are already signed in to, `ProviderButtons mode="link"`), or an
 * email and password (`POST /api/auth/password`). It never offers a PIN: PIN
 * sign-in is being phased out (Grant, 2026-11-05), and Profile still has its
 * row for anyone who wants one.
 *
 * `initialEmail` is what the person typed at the door, so they are not asked
 * for it twice. It never left their phone until they save here.
 */
export default function KeepAccountSheet({
  open,
  onClose,
  name,
  initialEmail = '',
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  name: string;
  initialEmail?: string;
  /** An email and password were saved: the account has a way back in. */
  onSaved: () => void;
}) {
  const t = useTranslations('keepAccount');
  const tAuth = useTranslations('profile.auth');
  const online = useOnline();
  // Which providers this deployment has, and which this member already linked:
  // the buttons draw from it, and the "or" between them and the email form
  // only shows when there is a button above it. Unknown draws no buttons.
  const { methods } = useSignInMethods(open);
  const linked = methods?.linked ?? [];
  const offered = (methods?.available ?? []).filter((p) => !linked.includes(p));
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ email: string; mailed: boolean } | null>(null);

  // The door's email arrives after the first render (Home reads it from the
  // one-shot marker in an effect), so take it when it lands — unless the
  // person has already typed one of their own.
  const [prevInitial, setPrevInitial] = useState(initialEmail);
  if (prevInitial !== initialEmail) {
    setPrevInitial(initialEmail);
    if (!email) setEmail(initialEmail);
  }

  const tooShort = password.length > 0 && password.length < PASSWORD_MIN_LENGTH;
  const tooCommon = password.length >= PASSWORD_MIN_LENGTH && isCommonPassword(password);
  const canSave = !busy && online && !!email.trim() && password.length >= PASSWORD_MIN_LENGTH && !tooCommon;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!canSave) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${BASE}/api/auth/password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 429) setError(tAuth('signUpRateLimited'));
        else if (data.error === 'email_taken') setError(tAuth('signUpEmailTaken'));
        else if (data.error === 'invalid_email') setError(tAuth('signUpInvalidEmail'));
        else if (data.error === 'weak_password') setError(tAuth('passwordTooCommon'));
        else if (data.error === 'password_exists') setError(t('passwordExists'));
        else setError(t('failed'));
        return;
      }
      setPassword('');
      setSaved({ email: typeof data.email === 'string' ? data.email : email.trim(), mailed: data.verificationSent === true });
      onSaved();
    } catch {
      setError(t('failed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <BottomSheet open={open} onClose={onClose} ariaLabel={t('title')}>
      <BottomSheetHeader>
        <span style={{ fontSize: 'var(--fs-lg)', fontWeight: 600 }}>{t('title')}</span>
        <button type="button" onClick={onClose} aria-label={t('close')} className="sheet-close-btn">
          <span className="material-icons" style={{ fontSize: 'var(--fs-stat)' }}>close</span>
        </button>
      </BottomSheetHeader>
      <BottomSheetBody>
        {saved ? (
          <div className="motion-fade" style={{ display: 'grid', gap: 'var(--space-4)' }}>
            <p role="status" className="fs-md" style={{ margin: 0 }}>
              {saved.mailed ? t('savedMailed', { email: saved.email }) : t('saved', { email: saved.email })}
            </p>
            <button type="button" className="btn-primary" style={{ width: '100%' }} onClick={onClose}>
              {t('done')}
            </button>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
            <p className="fs-md" style={{ margin: 0, color: 'var(--text-secondary)' }}>
              {name ? t('body', { name }) : t('bodyNoName')}
            </p>
            {/* Apple and Google, linked to the account this phone is signed in to. */}
            {offered.length > 0 && (
              <>
                <ProviderButtons mode="link" available={methods?.available ?? []} linked={linked} />
                <p className="fs-sm" style={{ margin: 0, textAlign: 'center', color: 'var(--text-muted)' }}>{t('or')}</p>
              </>
            )}
            <form onSubmit={save} style={{ display: 'grid', gap: 'var(--space-3)' }}>
              <input
                type="email"
                inputMode="email"
                autoComplete="email"
                autoCapitalize="none"
                spellCheck={false}
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setError(null);
                }}
                placeholder={tAuth('emailLabel')}
                aria-label={tAuth('emailLabel')}
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
                placeholder={tAuth('passwordLabel')}
                aria-label={tAuth('passwordLabel')}
                maxLength={200}
              />
              {tooShort && <p className="field-error">{tAuth('passwordTooShort')}</p>}
              {tooCommon && <p className="field-error">{tAuth('passwordTooCommon')}</p>}
              {error && <p className="field-error" role="alert">{error}</p>}
              <button type="submit" className="btn-primary" style={{ width: '100%' }} disabled={!canSave}>
                {busy ? t('saving') : t('save')}
              </button>
            </form>
            <button type="button" className="link-quiet" style={{ justifySelf: 'center' }} onClick={onClose}>
              {t('notNow')}
            </button>
          </div>
        )}
      </BottomSheetBody>
    </BottomSheet>
  );
}
