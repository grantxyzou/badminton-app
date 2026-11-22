'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useOnline } from '@/lib/useOnline';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

export const CODE_LENGTH = 6;

interface Options {
  /** The code proved an address that already has an account: it is signed in. */
  onSuccess: (result: { name: string }) => void;
  /**
   * A club's link (docs/plans/one-way-in.md, step 4): with it, an address
   * with no account gets a code that can MAKE one.
   */
  doorToken?: string;
  /** The code proved an address with no account yet: the caller asks for a name next. */
  onNewAccount?: (email: string) => void;
}

/**
 * Sign in with a 6-digit code emailed to you (docs/plans/one-way-in.md,
 * step 3), as state the pages draw: the address on the page with the sign-in
 * buttons, the code on its own "Check your email" page
 * (docs/plans/sign-in-redesign.md). The server answers every address the same
 * at `start` and every refusal the same at `verify`, so nothing here can tell
 * which addresses have accounts, and neither can the person holding the phone.
 */
export function useEmailCode({ onSuccess, doorToken, onNewAccount }: Options) {
  const t = useTranslations('profile.auth');
  const online = useOnline();
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmailRaw] = useState('');
  const [code, setCodeRaw] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** A fresh code went out from the code page: say so once. */
  const [resent, setResent] = useState(false);

  const setEmail = (v: string) => {
    setEmailRaw(v);
    setError(null);
  };
  const setCode = (v: string) => {
    setCodeRaw(v);
    setError(null);
  };

  async function send(): Promise<void> {
    if (busy || !online || !email.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${BASE}/api/auth/email-code/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), ...(doorToken ? { doorToken } : {}) }),
      });
      if (res.status === 429) setError(t('codeRateLimited'));
      else if (!res.ok) setError(t('signInService'));
      else {
        setResent(step === 'code');
        setCodeRaw('');
        setStep('code');
      }
    } catch {
      setError(t('signInService'));
    } finally {
      setBusy(false);
    }
  }

  async function verify(): Promise<void> {
    if (busy || !online || code.length !== CODE_LENGTH) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${BASE}/api/auth/email-code/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), code }),
      });
      if (res.status === 429) setError(t('codeRateLimited'));
      else if (res.status >= 500) setError(t('signInService'));
      // One message for every refusal: a wrong, expired or used code, and an
      // address with no account, all answer the same.
      else if (!res.ok) setError(t('codeInvalid'));
      else {
        const body = await res.json().catch(() => null);
        if (body && body.signup === true && onNewAccount) {
          onNewAccount(email.trim());
          return;
        }
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

  /** "Use a different email": back to the address. */
  function restart() {
    setStep('email');
    setCodeRaw('');
    setResent(false);
    setError(null);
  }

  return { step, email, setEmail, code, setCode, busy, error, resent, online, send, verify, restart };
}

export type EmailCode = ReturnType<typeof useEmailCode>;
