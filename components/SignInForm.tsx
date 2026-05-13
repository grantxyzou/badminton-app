'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import PinInput from './PinInput';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

interface SignInFormProps {
  /** Active sessionId — used both in the recover POST body and (by the
   *  caller) when wiring identity. */
  sessionId: string;
  /** Called when sign-in succeeds. The caller decides what to do next
   *  (set identity, show a welcome message, close a modal, transition the
   *  page). This component intentionally owns no post-success UI. */
  onSuccess: (result: { name: string; token?: string }) => void;
  /** When provided, render a "Forgot your PIN?" link below the submit
   *  button. Click invokes the callback (typically opens EnterCodeSheet
   *  or navigates to the recovery surface). */
  onForgotPin?: () => void;
}

/**
 * Unified sign-in form (name + 4-digit PIN). Lives inline; the caller
 * supplies any surrounding container, padding, header, or modal chrome.
 *
 * Error mapping intentionally distinguishes 5xx (network/server) from 4xx
 * (bad credentials) — without this, a Cosmos throttle or /recover 500
 * looks identical to "wrong PIN" and the user retries until rate-limited.
 *
 * Used by:
 * - RecoverySheet (wraps in a modal + welcome-back animation)
 * - ProfileTab anonymous view (renders directly in the card)
 */
export default function SignInForm({ sessionId, onSuccess, onForgotPin }: SignInFormProps) {
  const t = useTranslations('recovery');
  const [name, setName] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState<'invalid' | 'rate_limited' | 'admin_logged_in' | 'network' | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const trimmed = name.trim();
  const canSubmit = trimmed.length > 0 && pin.length === 4 && !submitting;

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
      // Admin cookie set: /api/players/recover refuses (admins must use
      // /reset-access instead). Surface this distinctly so the user knows
      // they're not just typing the wrong PIN.
      if (res.status === 403) { setError('admin_logged_in'); return; }
      // 5xx (network/server) vs 4xx (bad credentials) — without the split,
      // a Cosmos throttle reads as "wrong PIN" and the user retries until
      // they hit the rate limiter.
      if (res.status >= 500) { setError('network'); return; }
      if (!res.ok) { setError('invalid'); return; }
      const body = await res.json();
      if (!body || typeof body.deleteToken === 'undefined') {
        setError('network');
        return;
      }
      onSuccess({ name: trimmed, token: body.deleteToken });
    } catch {
      // fetch threw (offline, DNS, CORS) or res.json() threw on malformed
      // response. Treat as network so user knows to retry vs. double-check PIN.
      setError('network');
    } finally {
      setSubmitting(false);
    }
  }

  function handleForgotPin() {
    onForgotPin?.();
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <input
        type="text"
        aria-label={t('nameLabel')}
        placeholder={t('nameLabel')}
        value={name}
        onChange={(e) => { setName(e.target.value); setError(null); }}
        autoComplete="nickname"
        maxLength={50}
      />
      <PinInput
        value={pin}
        onChange={(v) => { setPin(v); setError(null); }}
        digits={4}
        label={t('pinLabel')}
        ariaInvalid={error === 'invalid'}
      />
      <button
        type="button"
        disabled={!canSubmit}
        onClick={submit}
        className="cc-btn cc-btn-primary cc-btn-lg"
        style={{ marginTop: 4 }}
      >
        {submitting ? t('submitting') : t('submitPin')}
      </button>
      {onForgotPin && (
        <button
          type="button"
          onClick={handleForgotPin}
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--text-secondary)',
            fontSize: 12,
            textDecoration: 'underline',
            cursor: 'pointer',
            alignSelf: 'center',
            padding: '0 12px',
            minHeight: 44,
            display: 'inline-flex',
            alignItems: 'center',
          }}
        >
          {t('forgotPinLink')}
        </button>
      )}
      {error === 'invalid' && (
        <p role="alert" style={{ color: 'var(--color-red, #ef4444)', fontSize: 12, margin: 0 }}>
          {t('errorInvalid')}
        </p>
      )}
      {error === 'rate_limited' && (
        <p role="alert" style={{ color: 'var(--color-amber, #f59e0b)', fontSize: 12, margin: 0 }}>
          {t('errorRateLimited')}
        </p>
      )}
      {error === 'admin_logged_in' && (
        <p role="alert" style={{ color: 'var(--color-amber, #f59e0b)', fontSize: 12, margin: 0 }}>
          {t('errorAdminLoggedIn')}
        </p>
      )}
      {error === 'network' && (
        <p role="alert" style={{ color: 'var(--color-amber, #f59e0b)', fontSize: 12, margin: 0 }}>
          {t('errorNetwork')}
        </p>
      )}
    </div>
  );
}
