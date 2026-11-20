'use client';

import { useState } from 'react';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

export type PinSignInError = 'invalid' | 'rate_limited' | 'admin_logged_in' | 'network';

/**
 * Name and PIN sign-in (`POST /api/players/recover`), as state a form draws:
 * the shared `SignInForm` and Log in's "Other ways" page both read it, so the
 * call and its error mapping live in one place.
 *
 * Error mapping distinguishes 5xx (network/server) from 4xx (bad credentials):
 * without it a Cosmos throttle reads as "wrong PIN" and the person retries
 * until the rate limiter stops them.
 */
export function usePinSignIn({
  sessionId,
  initialName = '',
  onSuccess,
}: {
  sessionId: string;
  initialName?: string;
  onSuccess: (result: { name: string; token?: string }) => void;
}) {
  const [name, setNameRaw] = useState(initialName);
  const [pin, setPinRaw] = useState('');
  const [error, setError] = useState<PinSignInError | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const trimmed = name.trim();
  const canSubmit = trimmed.length > 0 && pin.length === 4 && !submitting;

  const setName = (v: string) => {
    setNameRaw(v);
    setError(null);
  };
  const setPin = (v: string) => {
    setPinRaw(v);
    setError(null);
  };

  async function submit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`${BASE}/api/players/recover`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed, sessionId, pin }),
      });
      if (res.status === 429) { setError('rate_limited'); return; }
      // Admin cookie set: /api/players/recover refuses (admins use
      // /reset-access instead), so say that rather than "wrong PIN".
      if (res.status === 403) { setError('admin_logged_in'); return; }
      if (res.status >= 500) { setError('network'); return; }
      if (!res.ok) { setError('invalid'); return; }
      const body = await res.json();
      if (!body || typeof body.deleteToken === 'undefined') {
        setError('network');
        return;
      }
      onSuccess({ name: trimmed, token: body.deleteToken });
    } catch {
      // Offline, DNS, or a malformed answer: a retry, not a wrong PIN.
      setError('network');
    } finally {
      setSubmitting(false);
    }
  }

  return { name, setName, pin, setPin, error, submitting, canSubmit, submit };
}
