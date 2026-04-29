'use client';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { getIdentity, clearIdentity } from '@/lib/identity';
import PinInput from './PinInput';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/**
 * Blocking full-screen overlay that fires when an existing identity has no
 * PIN set. Per the auth revamp, every account needs a PIN — this modal
 * forces the existing PIN-less players to set one on their next visit so
 * they can recover access if they switch devices later.
 *
 * Cannot be dismissed except by:
 *   - successfully saving a 4-digit PIN, or
 *   - tapping "Sign out instead" (which clears the local identity so they
 *     can sign up fresh next session with a PIN-required form).
 *
 * Distinct primitive from `BottomSheet` — fires above it (z-index 70),
 * portal-less because there's only ever one of these at a time and it's
 * mounted at the SPA root in `app/page.tsx`.
 */
export default function ForcePinModal() {
  const t = useTranslations('forcePinModal');
  const [open, setOpen] = useState(false);
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<'mismatch' | 'too_common' | 'invalid' | 'network' | null>(null);
  const [whatIsThisOpen, setWhatIsThisOpen] = useState(false);

  // Decide on mount whether to fire. Re-evaluates only when identity or the
  // localStorage flag would have changed (after signup, set-pin, or sign-out).
  useEffect(() => {
    function evaluate() {
      const id = getIdentity();
      if (!id) {
        setOpen(false);
        return;
      }
      const flag = localStorage.getItem('badminton_pin_set');
      // 'true' = PIN already saved. 'never' = the user opted to sign out
      // instead and should NOT be re-prompted on the same identity if they
      // somehow come back. Anything else (including missing) = needs PIN.
      if (flag === 'true' || flag === 'never') {
        setOpen(false);
        return;
      }
      setOpen(true);
    }
    evaluate();
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'badminton_pin_set' || e.key === 'badminton_identity') evaluate();
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  // Disable Escape-to-close — this modal is intentionally blocking.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') e.preventDefault();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  // Lock body scroll while open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open) return null;

  const valid = pin.length === 4 && pin === confirmPin;

  async function save() {
    if (!valid) {
      if (pin !== confirmPin) setError('mismatch');
      else setError('invalid');
      return;
    }
    const identity = getIdentity();
    if (!identity) return;
    setSubmitting(true);
    setError(null);
    try {
      // Need to fetch the player's id from the active session — PATCH
      // /api/players takes id + deleteToken.
      const meRes = await fetch(`${BASE}/api/players`, { cache: 'no-store' });
      const players = (await meRes.json()) as { id: string; name: string; sessionId: string }[];
      const me = players.find(
        (p) =>
          p.name.toLowerCase() === identity.name.toLowerCase() &&
          p.sessionId === identity.sessionId,
      );
      if (!me) {
        setError('invalid');
        return;
      }
      const patch = await fetch(`${BASE}/api/players`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: me.id, pin, deleteToken: identity.token }),
      });
      if (!patch.ok) {
        const body = await patch.json().catch(() => ({}));
        setError(body.error === 'pin_too_common' ? 'too_common' : 'invalid');
        return;
      }
      localStorage.setItem('badminton_pin_set', 'true');
      setOpen(false);
      setPin('');
      setConfirmPin('');
    } catch {
      setError('network');
    } finally {
      setSubmitting(false);
    }
  }

  function signOutInstead() {
    clearIdentity();
    // 'never' suppresses the modal for this localStorage state — if the user
    // re-acquires identity later (signup with PIN), 'badminton_pin_set' gets
    // overwritten to 'true' so the suppression is automatically lifted.
    localStorage.setItem('badminton_pin_set', 'never');
    setOpen(false);
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="force-pin-title"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 70,
        background: 'rgba(0, 0, 0, 0.6)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        animation: 'force-pin-overlay-in 220ms var(--ease-sheet)',
      }}
    >
      <div
        className="glass-card"
        style={{
          width: '100%',
          maxWidth: 360,
          background: 'var(--page-bg)',
          padding: '24px 20px',
          animation: 'force-pin-card-in 280ms var(--ease-sheet)',
        }}
      >
        <h2 id="force-pin-title" className="bpm-h2" style={{ marginBottom: 8 }}>
          {t('title')}
        </h2>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.55, marginBottom: 14 }}>
          {t('body')}
        </p>
        <details
          open={whatIsThisOpen}
          onToggle={(e) => setWhatIsThisOpen((e.target as HTMLDetailsElement).open)}
          style={{ marginBottom: 16 }}
        >
          <summary
            style={{
              cursor: 'pointer',
              fontSize: 12,
              color: 'var(--text-muted)',
              listStyle: 'none',
              padding: '6px 0',
              textDecoration: 'underline',
            }}
          >
            {t('whatIsThis')}
          </summary>
          <p style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.55, padding: '4px 0 8px' }}>
            {t('whatIsThisBody')}
          </p>
        </details>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 12 }}>
          <PinInput value={pin} onChange={setPin} digits={4} label={t('pinLabel')} autoFocus />
          <PinInput value={confirmPin} onChange={setConfirmPin} digits={4} label={t('confirmLabel')} />
          {error === 'mismatch' && (
            <p role="alert" style={{ fontSize: 12, color: 'var(--color-red, #ef4444)' }}>{t('errMismatch')}</p>
          )}
          {error === 'too_common' && (
            <p role="alert" style={{ fontSize: 12, color: 'var(--color-red, #ef4444)' }}>{t('errTooCommon')}</p>
          )}
          {error === 'invalid' && (
            <p role="alert" style={{ fontSize: 12, color: 'var(--color-red, #ef4444)' }}>{t('errInvalid')}</p>
          )}
          {error === 'network' && (
            <p role="alert" style={{ fontSize: 12, color: 'var(--color-red, #ef4444)' }}>{t('errNetwork')}</p>
          )}
        </div>
        <button
          type="button"
          onClick={save}
          disabled={submitting || !valid}
          className="btn-primary"
          style={{ width: '100%' }}
        >
          {submitting ? t('saving') : t('save')}
        </button>
        <div style={{ textAlign: 'center', marginTop: 12 }}>
          <button
            type="button"
            onClick={signOutInstead}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-secondary)',
              fontSize: 12,
              textDecoration: 'underline',
              cursor: 'pointer',
              padding: '8px 12px',
              minHeight: 44,
            }}
          >
            {t('signOutInstead')}
          </button>
        </div>
      </div>
      <style>{`
        @keyframes force-pin-overlay-in {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes force-pin-card-in {
          from { transform: translateY(20px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
      `}</style>
    </div>
  );
}
