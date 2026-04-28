'use client';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { BottomSheet, BottomSheetHeader, BottomSheetBody } from './BottomSheet';
import PinInput from './PinInput';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved?: () => void;
  playerId: string;
  deleteToken: string;
}

export default function SetPinSheet({ open, onClose, onSaved, playerId, deleteToken }: Props) {
  const t = useTranslations('home.signup.pinPrompt');
  const tPin = useTranslations('pin');
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [error, setError] = useState<'too_common' | 'invalid' | 'mismatch' | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [saved, setSaved] = useState(false);

  function reset() {
    setPin('');
    setConfirmPin('');
    setError(null);
    setSaved(false);
  }

  function handleClose() {
    reset();
    onClose();
  }

  async function save() {
    setError(null);
    if (pin.length !== 4) {
      setError('invalid');
      return;
    }
    if (pin !== confirmPin) {
      setError('mismatch');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`${BASE}/api/players`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: playerId, pin, deleteToken }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error === 'pin_too_common' ? 'too_common' : 'invalid');
        return;
      }
      localStorage.setItem('badminton_pin_set', 'true');
      setSaved(true);
      onSaved?.();
      setTimeout(() => {
        handleClose();
      }, 1200);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <BottomSheet open={open} onClose={handleClose} ariaLabel={t('sheetTitle')} className="max-w-lg mx-auto">
      <BottomSheetHeader className="flex items-center justify-between p-4">
        <span style={{ fontSize: 16, fontWeight: 600 }}>{t('sheetTitle')}</span>
        <button
          type="button"
          onClick={handleClose}
          aria-label={tPin('cancel')}
          style={{ background: 'transparent', border: 'none', cursor: 'pointer', minWidth: 44, minHeight: 44, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <span className="material-icons" style={{ fontSize: 20 }}>close</span>
        </button>
      </BottomSheetHeader>
      <BottomSheetBody className="p-5 pb-8">
        {saved ? (
          <p style={{ textAlign: 'center', fontSize: 16, color: 'var(--color-green, #10b981)', padding: '24px 0' }}>
            {t('savedToast')}
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{t('sheetBody')}</p>
            <PinInput value={pin} onChange={setPin} digits={4} label={tPin('newLabel')} autoFocus />
            <PinInput value={confirmPin} onChange={setConfirmPin} digits={4} label={tPin('confirmLabel')} />
            {error === 'too_common' && (
              <p role="alert" style={{ fontSize: 12, color: 'var(--color-red, #ef4444)' }}>
                {t('errorTooCommon')}
              </p>
            )}
            {error === 'invalid' && (
              <p role="alert" style={{ fontSize: 12, color: 'var(--color-red, #ef4444)' }}>
                {t('errorInvalid')}
              </p>
            )}
            {(error === 'mismatch' || (pin && confirmPin && pin !== confirmPin)) && (
              <p role="alert" style={{ fontSize: 12, color: 'var(--color-red, #ef4444)' }}>
                {tPin('mismatch')}
              </p>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                onClick={save}
                disabled={submitting || pin.length !== 4 || pin !== confirmPin}
                className="btn-primary"
                style={{ flex: 1 }}
              >
                {submitting ? '…' : t('save')}
              </button>
              <button type="button" onClick={handleClose} className="btn-ghost" style={{ flex: 1 }}>
                {t('skip')}
              </button>
            </div>
          </div>
        )}
      </BottomSheetBody>
    </BottomSheet>
  );
}
