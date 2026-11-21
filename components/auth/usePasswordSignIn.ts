'use client';

import { useState } from 'react';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

export type PasswordSignInError = 'invalid' | 'rate_limited' | 'service';

/**
 * Email and password sign-in (`POST /api/auth/signin`), as state a form draws:
 * `EmailSignInForm` and Log in's password page both read it, so the call and
 * its error mapping live in one place.
 *
 * Nobody new is offered a password, but accounts that have one keep it — an
 * organizer who made a club with one, or a member who saved one on "Keep your
 * account" — so Log in keeps a way to use it (behind "Other ways").
 *
 * It gates on nothing optional: the route returns no `deleteToken`, so a
 * success is a body carrying `name`. One error for every credential failure —
 * the server answers a wrong password and an unknown address alike, and
 * splitting them here would undo that.
 */
export function usePasswordSignIn({ onSuccess }: { onSuccess: (result: { name: string }) => void }) {
  const [email, setEmailRaw] = useState('');
  const [password, setPasswordRaw] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<PasswordSignInError | null>(null);

  const canSubmit = !busy && !!email.trim() && !!password;

  async function submit() {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${BASE}/api/auth/signin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      if (res.status === 429) return setError('rate_limited');
      if (res.status >= 500) return setError('service');
      if (!res.ok) return setError('invalid');
      const body = await res.json().catch(() => null);
      if (!body || typeof body.name !== 'string') return setError('service');
      onSuccess({ name: body.name });
    } catch {
      setError('service');
    } finally {
      setBusy(false);
    }
  }

  return {
    email,
    setEmail: (v: string) => {
      setEmailRaw(v);
      setError(null);
    },
    password,
    setPassword: (v: string) => {
      setPasswordRaw(v);
      setError(null);
    },
    busy,
    error,
    canSubmit,
    submit,
  };
}
