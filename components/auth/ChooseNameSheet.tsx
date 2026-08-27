'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { BottomSheet, BottomSheetHeader, BottomSheetBody } from '@/components/BottomSheet';
import { setIdentity } from '@/lib/identity';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

interface Props {
  open: boolean;
  onClose: () => void;
  sessionId: string;
}

/**
 * The step after a provider sign-in that has no member yet.
 *
 * Two modes, because a name collision is the ORDINARY case rather than an
 * error: every existing member already has a name, so "someone already plays
 * under that name" is the first thing any of them sees when they try Google.
 *
 *   `name`  — pick a display name (a genuinely new player).
 *   `claim` — that name is taken; prove it is yours, and link this sign-in to
 *             the account you already have.
 *
 * The claim step accepts a PIN, or an admin-issued 6-digit code for members who
 * never set one (the invite-list case). It never accepts a name alone: names
 * are enumerable, so that would hand any account to anyone who can read the
 * member list.
 *
 * The provider identity itself never touches this component. It lives in a
 * signed, HttpOnly cookie the browser cannot read, and both endpoints take it
 * from there — so all that is posted from here is a name and a credential.
 */
export default function ChooseNameSheet({ open, onClose, sessionId }: Props) {
  const t = useTranslations('profile.auth');
  const [mode, setMode] = useState<'name' | 'claim' | 'expired'>('name');
  const [name, setName] = useState('');
  const [secret, setSecret] = useState('');
  const [useCode, setUseCode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Apple sends a name on the FIRST authorization only, and the callback parks
  // it in a signed HttpOnly cookie this component cannot read. Asking the
  // server for it is the only way to prefill; Google never sends one.
  // No state resets here: the sheet is REMOUNTED on open (keyed in HomeShell),
  // so every field starts fresh without setState-in-effect cascading renders.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetch(`${BASE}/api/auth/complete-signup`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled || !d) return;
        // The GET already knows whether the signed pending cookie survived.
        // Saying so NOW is the difference between "this expired, start again"
        // and letting someone choose a name, commit to it, and only then be
        // told their submit could never have worked.
        if (d.pending === false) {
          setMode('expired');
          return;
        }
        if (d.suggestedName) setName(String(d.suggestedName).slice(0, 50));
      })
      .catch(() => {
        // No prefill is a fine outcome — the user types their name.
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  function finish(returnedName: string) {
    // The server already set member_session; mirror the name into localStorage
    // so the rest of the app (which reads `badminton_identity`) sees the same
    // person. No deleteToken — this is an account, not a session signup.
    setIdentity({ name: returnedName, sessionId });
    onClose();
  }

  async function submitName(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${BASE}/api/auth/complete-signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        // Not a dead end: offer to prove the name is theirs.
        if (data.error === 'name_taken') setMode('claim');
        else if (data.error === 'no_pending_signup') setMode('expired');
        else if (data.error === 'already_linked') setError(t('alreadyLinked'));
        else if (data.error === 'email_taken') setError(t('emailTaken'));
        else setError(t('genericError'));
        setBusy(false);
        return;
      }
      finish(data.name);
    } catch {
      setError(t('genericError'));
      setBusy(false);
    }
  }

  async function submitClaim(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !secret.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${BASE}/api/auth/claim-name`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          ...(useCode ? { code: secret.trim() } : { pin: secret.trim() }),
        }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        if (res.status === 429) setError(t('claimRateLimited'));
        else if (data.error === 'already_linked') setError(t('claimAlreadyLinked'));
        else if (data.error === 'no_pending_signup') setMode('expired');
        else setError(t('claimWrong'));
        setBusy(false);
        return;
      }
      finish(data.name);
    } catch {
      setError(t('genericError'));
      setBusy(false);
    }
  }

  const claiming = mode === 'claim';
  const expired = mode === 'expired';
  const digits = useCode ? 6 : 4;

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      ariaLabel={expired ? t('pendingExpiredTitle') : claiming ? t('claimTitle') : t('chooseNameTitle')}
    >
      <BottomSheetHeader>
        {expired ? t('pendingExpiredTitle') : claiming ? t('claimTitle') : t('chooseNameTitle')}
      </BottomSheetHeader>
      <BottomSheetBody>
        {expired ? (
          <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
            <p style={{ fontSize: 'var(--fs-md)', color: 'var(--text-primary)', margin: 0 }}>
              {t('pendingExpired')}
            </p>
            {/* A way OUT. The old copy said "tap the button again" while the
                sheet contained no such button — a dead end. */}
            <button
              type="button"
              onClick={onClose}
              className="cc-btn cc-btn-primary cc-btn-lg"
              style={{ width: '100%' }}
            >
              {t('pendingExpiredCta')}
            </button>
          </div>
        ) : claiming ? (
          <form onSubmit={submitClaim} style={{ display: 'grid', gap: 'var(--space-4)' }}>
            <p style={{ fontSize: 'var(--fs-md)', color: 'var(--text-primary)', margin: 0 }}>
              {t('claimBody', { name: name.trim() })}
            </p>
            <input
              // type="text" + WebkitTextSecurity, matching the app's other PIN
              // inputs: a numeric keypad without the spinner and autofill mess
              // a number-typed password field brings on iOS.
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={secret}
              onChange={(e) => {
                setSecret(e.target.value.replace(/\D/g, '').slice(0, digits));
                setError(null);
              }}
              maxLength={digits}
              autoFocus
              aria-label={useCode ? t('claimCodeLabel') : t('claimPinLabel')}
              placeholder={useCode ? t('claimCodeLabel') : t('claimPinLabel')}
              style={{ WebkitTextSecurity: 'disc' } as React.CSSProperties}
            />
            {error && <p className="field-error">{error}</p>}
            <button
              type="submit"
              disabled={busy || secret.length < digits}
              className="cc-btn cc-btn-primary cc-btn-lg"
              style={{ width: '100%' }}
            >
              {busy ? t('claimChecking') : t('claimCta')}
            </button>
            <button
              type="button"
              onClick={() => {
                setUseCode((v) => !v);
                setSecret('');
                setError(null);
              }}
              className="btn-ghost"
              style={{ width: '100%', fontSize: 'var(--fs-base)' }}
            >
              {useCode ? t('claimUsePin') : t('claimNoPin')}
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('name');
                setSecret('');
                setError(null);
              }}
              className="btn-ghost"
              style={{ width: '100%', fontSize: 'var(--fs-base)' }}
            >
              {t('claimDifferentName')}
            </button>
          </form>
        ) : (
          <form onSubmit={submitName} style={{ display: 'grid', gap: 'var(--space-4)' }}>
            <p style={{ fontSize: 'var(--fs-md)', color: 'var(--text-primary)', margin: 0 }}>
              {t('chooseNameBody')}
            </p>
            <input
              type="text"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setError(null);
              }}
              placeholder={t('chooseNamePlaceholder')}
              maxLength={50}
              autoFocus
              aria-label={t('chooseNamePlaceholder')}
              autoComplete="nickname"
            />
            {error && <p className="field-error">{error}</p>}
            <button
              type="submit"
              disabled={busy || !name.trim()}
              className="cc-btn cc-btn-primary cc-btn-lg"
              style={{ width: '100%' }}
            >
              {busy ? t('chooseNameSaving') : t('chooseNameCta')}
            </button>
          </form>
        )}
      </BottomSheetBody>
    </BottomSheet>
  );
}
