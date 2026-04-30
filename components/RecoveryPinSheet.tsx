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
  /** Fires after a successful save with the new state. */
  onSaved: (newHasPin: boolean) => void;
}

type PinError = 'too_common' | 'invalid' | 'failed' | null;

export default function RecoveryPinSheet({ open, onClose, identity, hasPin, onSaved }: Props) {
  const t = useTranslations('profile');
  const tSettings = useTranslations('profile.settings');
  const tPin = useTranslations('pin');
  const tRecovery = useTranslations('recovery');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [pinError, setPinError] = useState<PinError>(null);
  const [submitting, setSubmitting] = useState(false);

  function reset() {
    setNewPin('');
    setConfirmPin('');
    setPinError(null);
  }

  async function savePin(value: string) {
    setPinError(null);
    setSubmitting(true);
    try {
      const meRes = await fetch(`${BASE}/api/players`, { cache: 'no-store' });
      const players = (await meRes.json()) as { id: string; name: string; sessionId: string }[];
      const me = players.find(
        (p) => p.name.toLowerCase() === identity.name.toLowerCase() && p.sessionId === identity.sessionId,
      );
      if (!me) {
        setPinError('failed');
        return;
      }
      const patchRes = await fetch(`${BASE}/api/players`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: me.id, pin: value, deleteToken: identity.token }),
      });
      if (!patchRes.ok) {
        const body = await patchRes.json().catch(() => ({}));
        if (body.error === 'pin_too_common') setPinError('too_common');
        else if (body.error === 'Invalid PIN format') setPinError('invalid');
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

  const title = hasPin ? tSettings('updatePin') : tSettings('newPin');
  const submitLabel = hasPin ? tSettings('updatePin') : tPin('save');

  return (
    <BottomSheet open={open} onClose={onClose} ariaLabel={title} maxHeight="75vh" className="max-w-lg mx-auto">
      <BottomSheetHeader className="flex items-center justify-between p-4">
        <span style={{ fontSize: 16, fontWeight: 600 }}>{title}</span>
        <button
          type="button"
          onClick={onClose}
          aria-label={tRecovery('close')}
          style={{ background: 'transparent', border: 'none', cursor: 'pointer', minWidth: 44, minHeight: 44, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <span className="material-icons" style={{ fontSize: 20 }}>close</span>
        </button>
      </BottomSheetHeader>
      <BottomSheetBody className="p-5 pb-8">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <p style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 4 }}>{tPin('newLabel')}</p>
            <PinInput value={newPin} onChange={setNewPin} digits={4} label={tPin('newLabel')} autoFocus />
          </div>
          <div>
            <p style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 4 }}>{tPin('confirmLabel')}</p>
            <PinInput value={confirmPin} onChange={setConfirmPin} digits={4} label={tPin('confirmLabel')} />
          </div>
          {pinError === 'too_common' && (
            <p role="alert" style={{ fontSize: 12, color: 'var(--color-red, #ef4444)', margin: 0 }}>
              {t('pinTooCommon')}
            </p>
          )}
          {pinError === 'invalid' && (
            <p role="alert" style={{ fontSize: 12, color: 'var(--color-red, #ef4444)', margin: 0 }}>
              {t('pinInvalid')}
            </p>
          )}
          {pinError === 'failed' && (
            <p role="alert" style={{ fontSize: 12, color: 'var(--color-red, #ef4444)', margin: 0 }}>
              {t('pinUpdateFailed')}
            </p>
          )}
          {newPin && confirmPin && newPin !== confirmPin && (
            <p role="alert" style={{ fontSize: 12, color: 'var(--color-red, #ef4444)', margin: 0 }}>
              {tPin('mismatch')}
            </p>
          )}
          <button
            type="button"
            className="btn-primary"
            disabled={submitting || newPin.length !== 4 || newPin !== confirmPin}
            onClick={() => savePin(newPin)}
            style={{ width: '100%' }}
          >
            {submitLabel}
          </button>
        </div>
      </BottomSheetBody>
    </BottomSheet>
  );
}
