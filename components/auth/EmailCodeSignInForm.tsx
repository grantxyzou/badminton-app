'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useOnline } from '@/lib/useOnline';
import EmailSignInForm from '@/components/auth/EmailSignInForm';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

interface Props {
  onSuccess: (result: { name: string }) => void;
  /** Shown only on the password route, which is the only place a password can be forgotten. */
  onForgotPassword?: () => void;
}

/**
 * Log in with a 6-digit code emailed to you (docs/plans/one-way-in.md,
 * step 3). Two steps on one card: the address, then the code. A password is
 * one tap away ("Use my password instead"), because existing passwords keep
 * working.
 *
 * The "sent" line says IF the address has an account, a code is on its way:
 * the server answers every address the same so it cannot be asked which ones
 * have accounts, and the screen must not claim more than the server knows.
 *
 * Like the other sign-in forms it owns no post-success UI; the caller decides
 * what being signed in means.
 */
export default function EmailCodeSignInForm({ onSuccess, onForgotPassword }: Props) {
  const t = useTranslations('profile.auth');
  const online = useOnline();
  const [usePassword, setUsePassword] = useState(false);
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function sendCode() {
    if (busy || !online || !email.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${BASE}/api/auth/email-code/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      });
      if (res.status === 429) setError(t('codeRateLimited'));
      else if (!res.ok) setError(t('signInService'));
      else {
        setCode('');
        setStep('code');
      }
    } catch {
      setError(t('signInService'));
    } finally {
      setBusy(false);
    }
  }

  async function logIn() {
    const typed = code.replace(/\s/g, '');
    if (busy || !online || typed.length !== 6) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${BASE}/api/auth/email-code/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), code: typed }),
      });
      if (res.status === 429) {
        setError(t('codeRateLimited'));
      } else if (res.status >= 500) {
        setError(t('signInService'));
      } else if (!res.ok) {
        // One message for every refusal: the server answers a wrong, expired
        // or used-up code, and an address with no account, the same way.
        setError(t('codeInvalid'));
      } else {
        const body = await res.json().catch(() => null);
        if (body && typeof body.name === 'string') {
          onSuccess({ name: body.name });
          return;
        }
        setError(t('signInService'));
      }
    } catch {
      setError(t('signInService'));
    }
    setBusy(false);
  }

  const switchRoute = (
    <button
      type="button"
      className="link-quiet"
      onClick={() => {
        setUsePassword((p) => !p);
        setError(null);
      }}
    >
      {usePassword ? t('codeUseCode') : t('codeUsePassword')}
    </button>
  );

  if (usePassword) {
    return (
      <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
        <EmailSignInForm onSuccess={onSuccess} onForgotPassword={onForgotPassword} />
        {switchRoute}
      </div>
    );
  }

  if (step === 'code') {
    const ready = code.replace(/\s/g, '').length === 6;
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void logIn();
        }}
        style={{ display: 'grid', gap: 'var(--space-3)' }}
      >
        <p role="status" style={{ margin: 0, fontSize: 'var(--fs-md)', color: 'var(--text-secondary)' }}>
          {t('codeSent', { email: email.trim() })}
        </p>
        <input
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9 ]*"
          value={code}
          onChange={(e) => {
            setCode(e.target.value.replace(/[^0-9 ]/g, '').slice(0, 7));
            setError(null);
          }}
          placeholder={t('codeLabel')}
          aria-label={t('codeLabel')}
          maxLength={7}
          autoFocus
        />
        {error && <p className="field-error" role="alert">{error}</p>}
        <button
          type="submit"
          disabled={busy || !online || !ready}
          className="cc-btn cc-btn-primary cc-btn-lg"
          style={{ width: '100%' }}
        >
          {busy ? t('codeChecking') : t('codeCta')}
        </button>
        <div style={{ display: 'flex', justifyContent: 'center', flexWrap: 'wrap' }}>
          <button type="button" className="link-quiet" disabled={busy || !online} onClick={() => void sendCode()}>
            {t('codeResend')}
          </button>
          <button
            type="button"
            className="link-quiet"
            onClick={() => {
              setStep('email');
              setCode('');
              setError(null);
            }}
          >
            {t('codeOtherEmail')}
          </button>
        </div>
      </form>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void sendCode();
      }}
      style={{ display: 'grid', gap: 'var(--space-3)' }}
    >
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
      {error && <p className="field-error" role="alert">{error}</p>}
      <button
        type="submit"
        disabled={busy || !online || !email.trim()}
        className="cc-btn cc-btn-primary cc-btn-lg"
        style={{ width: '100%' }}
      >
        {busy ? t('codeSending') : t('codeSendCta')}
      </button>
      {switchRoute}
    </form>
  );
}
