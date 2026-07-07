'use client';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { BottomSheet, BottomSheetHeader, BottomSheetBody } from './BottomSheet';
import PinInput from './PinInput';
import type { Identity } from '@/lib/identity';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

interface Props {
  open: boolean;
  onClose: () => void;
  identity: Identity;
  hasPin: boolean;
  /**
   * Whether this device holds a valid member_session cookie for the identity
   * (from `GET /api/members/me` → `authed`). Tri-state: `null` = unknown
   * (fetch pending/failed) — don't block on unknown, let the server be the
   * backstop. Only `false` (known-not-authed) gates the first-PIN set, since
   * the server requires that cookie for the claim flow.
   */
  authed?: boolean | null;
  /** Fires after a successful save with the new state. */
  onSaved: (newHasPin: boolean) => void;
}

type PinError =
  | 'too_common'
  | 'invalid'
  | 'failed'
  | 'wrong_current'
  | 'rate_limited'
  | 'needs_signin'
  | null;

export default function RecoveryPinSheet({ open, onClose, identity, hasPin, authed = null, onSaved }: Props) {
  const t = useTranslations('profile');
  const tSettings = useTranslations('profile.settings');
  const tPin = useTranslations('pin');
  const tRecovery = useTranslations('recovery');
  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [pinError, setPinError] = useState<PinError>(null);
  const [submitting, setSubmitting] = useState(false);

  function reset() {
    setCurrentPin('');
    setNewPin('');
    setConfirmPin('');
    setPinError(null);
  }

  async function savePin(value: string) {
    setPinError(null);
    setSubmitting(true);
    try {
      // Batch B (expanded): PATCH the member record directly. PIN is an
      // account-level secret — coupling it to the session-scoped player
      // record meant the PIN appeared "lost" every week. The endpoint
      // verifies `currentPin` against `members.pinHash` when one exists,
      // closing the "anyone with browser access can rewrite my PIN" hole.
      const patchRes = await fetch(`${BASE}/api/members/me`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: identity.name,
          // currentPin only required when a PIN is already set. The server
          // also enforces this and returns 401 'current_pin_required' if
          // we forget — but defending in depth.
          currentPin: hasPin ? currentPin : undefined,
          newPin: value,
        }),
      });
      if (!patchRes.ok) {
        const body = await patchRes.json().catch(() => ({}));
        if (patchRes.status === 429) setPinError('rate_limited');
        else if (body.error === 'pin_too_common') setPinError('too_common');
        else if (body.error === 'Invalid PIN format') setPinError('invalid');
        else if (body.error === 'invalid_credentials' || body.error === 'current_pin_required') setPinError('wrong_current');
        // Server's first-set guard rejected us — the cookie expired since the
        // client last checked `authed`. Show the same actionable guidance.
        else if (body.error === 'auth_required') setPinError('needs_signin');
        else setPinError('failed');
        return;
      }
      onSaved(true);
      reset();
      onClose();
    } catch {
      setPinError('failed');
    } finally {
      setSubmitting(false);
    }
  }

  // First-set requires a member_session cookie (server enforces it). Block the
  // form only when we KNOW the device isn't authed; `null` (unknown) falls
  // through to let the user try, with the server as the backstop.
  const firstSetBlocked = !hasPin && authed === false;
  const title = hasPin ? tSettings('updatePin') : tSettings('newPin');
  const submitLabel = hasPin ? tSettings('updatePin') : tPin('save');
  const canSubmit =
    !submitting &&
    newPin.length === 4 &&
    newPin === confirmPin &&
    (!hasPin || currentPin.length === 4);

  return (
    <BottomSheet open={open} onClose={onClose} ariaLabel={title} maxHeight="75vh" className="max-w-lg mx-auto">
      <BottomSheetHeader className="flex items-center justify-between p-4">
        <span style={{ fontSize: 'var(--fs-lg)', fontWeight: 600 }}>{title}</span>
        <button
          type="button"
          onClick={onClose}
          aria-label={tRecovery('close')}
          style={{ background: 'transparent', border: 'none', cursor: 'pointer', minWidth: 44, minHeight: 44, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <span className="material-icons" style={{ fontSize: 'var(--fs-stat)' }}>close</span>
        </button>
      </BottomSheetHeader>
      <BottomSheetBody className="p-5 pb-8">
        {firstSetBlocked ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <p role="alert" style={{ fontSize: 'var(--fs-md)', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.5 }}>
              {t('pinNeedsSignIn')}
            </p>
            <button type="button" className="cc-btn cc-btn-secondary cc-btn-lg" onClick={onClose}>
              {tRecovery('close')}
            </button>
          </div>
        ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {hasPin && (
            <div>
              <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-secondary)', marginBottom: 4 }}>{tPin('currentLabel')}</p>
              <PinInput
                value={currentPin}
                onChange={(v) => { setCurrentPin(v); setPinError(null); }}
                digits={4}
                label={tPin('currentLabel')}
                autoFocus
                ariaInvalid={pinError === 'wrong_current'}
              />
            </div>
          )}
          <div>
            <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-secondary)', marginBottom: 4 }}>{tPin('newLabel')}</p>
            <PinInput
              value={newPin}
              onChange={(v) => { setNewPin(v); setPinError(null); }}
              digits={4}
              label={tPin('newLabel')}
              autoFocus={!hasPin}
            />
          </div>
          <div>
            <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-secondary)', marginBottom: 4 }}>{tPin('confirmLabel')}</p>
            <PinInput
              value={confirmPin}
              onChange={(v) => { setConfirmPin(v); setPinError(null); }}
              digits={4}
              label={tPin('confirmLabel')}
            />
          </div>
          {pinError === 'too_common' && (
            <p role="alert" style={{ fontSize: 'var(--fs-sm)', color: 'var(--color-red)', margin: 0 }}>
              {t('pinTooCommon')}
            </p>
          )}
          {pinError === 'invalid' && (
            <p role="alert" style={{ fontSize: 'var(--fs-sm)', color: 'var(--color-red)', margin: 0 }}>
              {t('pinInvalid')}
            </p>
          )}
          {pinError === 'wrong_current' && (
            <p role="alert" style={{ fontSize: 'var(--fs-sm)', color: 'var(--color-red)', margin: 0 }}>
              {t('pinWrongCurrent')}
            </p>
          )}
          {pinError === 'rate_limited' && (
            <p role="alert" style={{ fontSize: 'var(--fs-sm)', color: 'var(--color-amber)', margin: 0 }}>
              {t('pinRateLimited')}
            </p>
          )}
          {pinError === 'failed' && (
            <p role="alert" style={{ fontSize: 'var(--fs-sm)', color: 'var(--color-red)', margin: 0 }}>
              {t('pinUpdateFailed')}
            </p>
          )}
          {pinError === 'needs_signin' && (
            <p role="alert" style={{ fontSize: 'var(--fs-sm)', color: 'var(--color-amber)', margin: 0 }}>
              {t('pinNeedsSignIn')}
            </p>
          )}
          {newPin && confirmPin && newPin !== confirmPin && (
            <p role="alert" style={{ fontSize: 'var(--fs-sm)', color: 'var(--color-red)', margin: 0 }}>
              {tPin('mismatch')}
            </p>
          )}
          <button
            type="button"
            className="cc-btn cc-btn-primary cc-btn-lg"
            disabled={!canSubmit}
            onClick={() => savePin(newPin)}
          >
            {submitLabel}
          </button>
        </div>
        )}
      </BottomSheetBody>
    </BottomSheet>
  );
}
