'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import ProviderButtons from './ProviderButtons';
import { PASSWORD_MIN_LENGTH, isCommonPassword } from '@/lib/passwordRules';
import { useOnline } from '@/lib/useOnline';
import { useSignInMethods } from './useSignInMethods';
import AuthStage from '@/components/onboarding/AuthStage';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

interface Props {
  /** Straight after a PIN log-in: the person's name, for "{name}, a PIN is the only way in". */
  name?: string;
  /**
   * `pinOnly`: shown straight after a PIN log-in, when the PIN is the only
   * way in (docs/plans/sign-in-redesign.md, "Ask PIN-only members sooner").
   * Absent: Home's "Keep your account" card, opened on any day.
   */
  reason?: 'pinOnly';
  /** An email and password were saved: the account has a way back in. */
  onSaved?: () => void;
  /** "Not now", or "Done" after saving. */
  onDone: () => void;
  /** Home's page has somewhere to go back to; the one after a log-in does not. */
  onBack?: () => void;
}

/**
 * "Keep your account": add a way back in that needs nobody else — Apple or
 * Google (linked to the account this phone is signed in to, `mode="link"`),
 * or an email and password (`POST /api/auth/password`). It never offers a PIN:
 * nobody new is offered one (Grant, 2026-11-07).
 *
 * A PAGE on the sign-in layout (docs/plans/sign-in-redesign.md), never a
 * sheet: shown straight after a PIN log-in, and from Home's card.
 */
export default function KeepAccountPage({ name, reason, onSaved, onDone, onBack }: Props) {
  const t = useTranslations('keepAccount');
  const tAuth = useTranslations('profile.auth');
  const online = useOnline();
  // Which providers this deployment has, and which this member already linked:
  // the buttons draw from it. Unknown draws no buttons.
  const { methods } = useSignInMethods();
  const linked = methods?.linked ?? [];
  const offered = (methods?.available ?? []).filter((p) => !linked.includes(p));
  const [useEmail, setUseEmail] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ email: string; mailed: boolean } | null>(null);

  const tooShort = password.length > 0 && password.length < PASSWORD_MIN_LENGTH;
  const tooCommon = password.length >= PASSWORD_MIN_LENGTH && isCommonPassword(password);
  const canSave = !busy && online && !!email.trim() && password.length >= PASSWORD_MIN_LENGTH && !tooCommon;

  async function save() {
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
      onSaved?.();
    } catch {
      setError(t('failed'));
    } finally {
      setBusy(false);
    }
  }

  const copy =
    reason === 'pinOnly' && name ? (
      <>
        <p className="auth-copy">{t('pinOnlyBody', { name })}</p>
        <p className="auth-copy">{t('pinOnlyMore')}</p>
      </>
    ) : (
      <p className="auth-copy">{t('body')}</p>
    );

  if (saved) {
    return (
      <AuthStage
        data-page="keep-account-saved"
        title={t('title')}
        backLabel={t('back')}
        heading={t('heading')}
        copy={
          <p className="auth-copy" role="status">
            {saved.mailed ? t('savedMailed', { email: saved.email }) : t('saved', { email: saved.email })}
          </p>
        }
        actions={
          <button type="button" className="auth-btn auth-btn--primary" onClick={onDone}>
            {t('done')}
          </button>
        }
      />
    );
  }

  if (useEmail) {
    return (
      <AuthStage
        data-page="keep-account-email"
        title={t('title')}
        onBack={() => {
          setUseEmail(false);
          setError(null);
        }}
        backLabel={t('back')}
        heading={t('heading')}
        copy={copy}
        actions={
          <>
            {error && (
              <p className="field-error" role="alert">
                {error}
              </p>
            )}
            <button type="button" className="auth-btn auth-btn--primary" disabled={!canSave} onClick={() => void save()}>
              {busy ? t('saving') : t('save')}
            </button>
          </>
        }
        links={
          <button type="button" className="link-quiet link-quiet--plain" onClick={onDone}>
            {t('notNow')}
          </button>
        }
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
          style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}
        >
          <input
            className="auth-field"
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
            autoFocus
          />
          <input
            className="auth-field"
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
        </form>
      </AuthStage>
    );
  }

  return (
    <AuthStage
      data-page="keep-account"
      title={t('title')}
      onBack={onBack}
      backLabel={t('back')}
      heading={t('heading')}
      copy={copy}
      actions={
        <>
          {offered.length > 0 && <ProviderButtons mode="link" size="auth" available={methods?.available ?? []} linked={linked} />}
          <button type="button" className="auth-btn auth-btn--neutral" onClick={() => setUseEmail(true)}>
            {t('useEmail')}
          </button>
        </>
      }
      links={
        <button type="button" className="link-quiet link-quiet--plain" onClick={onDone}>
          {t('notNow')}
        </button>
      }
    />
  );
}
