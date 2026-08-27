'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

interface Props {
  onSuccess: (result: { name: string }) => void;
  onForgotPassword: () => void;
}

/**
 * Sign in with an email address and password.
 *
 * WHY THIS IS NOT `SignInForm`
 * ----------------------------
 * `SignInForm` (name + PIN) hard-gates on `body.deleteToken` being present and
 * treats its absence as a NETWORK error. That is correct for its own flow —
 * it registers you for a session — but `POST /api/auth/signin` is
 * account-level and returns no `deleteToken`, so reusing it would reject every
 * successful sign-in as a connection failure.
 *
 * This form therefore gates on nothing optional. It reads `name`; if that is
 * missing the response is genuinely malformed, which is a service failure and
 * says so — a different thing from rejecting a valid answer.
 *
 * Like `SignInForm`, it owns no post-success UI: the caller decides what
 * becoming signed-in means.
 */
export default function EmailSignInForm({ onSuccess, onForgotPassword }: Props) {
  const t = useTranslations('profile.auth');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !email.trim() || !password) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${BASE}/api/auth/signin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password }),
      });

      if (res.status === 429) {
        setError(t('signInRateLimited'));
        setBusy(false);
        return;
      }
      if (res.status >= 500) {
        setError(t('signInService'));
        setBusy(false);
        return;
      }
      if (!res.ok) {
        // One message for every credential failure — the server deliberately
        // answers identically for a wrong password and an unknown address, and
        // splitting them here would undo that.
        setError(t('signInInvalid'));
        setBusy(false);
        return;
      }

      const body = await res.json().catch(() => null);
      if (!body || typeof body.name !== 'string') {
        setError(t('signInService'));
        setBusy(false);
        return;
      }
      onSuccess({ name: body.name });
    } catch {
      setError(t('signInService'));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} style={{ display: 'grid', gap: 'var(--space-3)' }}>
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
        autoComplete="current-password"
        value={password}
        onChange={(e) => {
          setPassword(e.target.value);
          setError(null);
        }}
        placeholder={t('passwordLabel')}
        aria-label={t('passwordLabel')}
        maxLength={200}
      />
      {error && <p className="field-error">{error}</p>}
      <button
        type="submit"
        disabled={busy || !email.trim() || !password}
        className="cc-btn cc-btn-primary cc-btn-lg"
        style={{ width: '100%' }}
      >
        {busy ? t('emailSignInChecking') : t('emailSignInCta')}
      </button>
      <button
        type="button"
        onClick={onForgotPassword}
        className="btn-ghost"
        style={{ width: '100%', fontSize: 'var(--fs-base)' }}
      >
        {t('forgotPasswordLink')}
      </button>
    </form>
  );
}
