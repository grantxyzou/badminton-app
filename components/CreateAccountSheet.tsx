'use client';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { BottomSheet, BottomSheetHeader, BottomSheetBody } from './BottomSheet';
import PinInput from './PinInput';
import { setIdentity } from '@/lib/identity';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

interface Props {
  open: boolean;
  onClose: () => void;
  sessionId: string;
}

type ErrorKind = 'mismatch' | 'too_common' | 'invalid' | 'rate_limited' | 'network' | 'name_required' | 'account_exists' | 'invite_only' | null;

export default function CreateAccountSheet({ open, onClose, sessionId }: Props) {
  const t = useTranslations('profile.createAccount');
  const tRecovery = useTranslations('recovery');
  const [name, setName] = useState('');
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [error, setError] = useState<ErrorKind>(null);
  const [submitting, setSubmitting] = useState(false);
  const [successName, setSuccessName] = useState<string | null>(null);

  const trimmed = name.trim();
  const canSubmit = trimmed.length > 0 && pin.length === 4 && confirmPin.length === 4 && !submitting;

  async function submit() {
    setError(null);
    if (!trimmed) { setError('name_required'); return; }
    if (pin !== confirmPin) { setError('mismatch'); return; }
    setSubmitting(true);
    try {
      const res = await fetch(`${BASE}/api/players`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed, pin, sessionSignup: false }),
      });
      if (res.status === 429) { setError('rate_limited'); return; }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (data.error === 'pin_too_common') { setError('too_common'); return; }
        if (data.error === 'Invalid PIN format') { setError('invalid'); return; }
        if (data.error === 'account_exists') { setError('account_exists'); return; }
        if (data.error === 'invite_list_not_found') { setError('invite_only'); return; }
        setError('network');
        return;
      }
      setIdentity({ name: trimmed, sessionId });
      setSuccessName(trimmed);
      setTimeout(() => {
        onClose();
        setSuccessName(null);
        setName('');
        setPin('');
        setConfirmPin('');
      }, 1500);
    } catch {
      setError('network');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <BottomSheet open={open} onClose={onClose} ariaLabel={t('title')} maxHeight="75vh" className="max-w-lg mx-auto">
      <BottomSheetHeader className="flex items-center justify-between p-4">
        <span style={{ fontSize: 16, fontWeight: 600 }}>{t('title')}</span>
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
        {successName ? (
          <p style={{ textAlign: 'center', fontSize: 18, color: 'var(--text-primary)' }}>
            {t('successWelcome', { name: successName })}
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: 0 }}>{t('body')}</p>
            <input
              type="text"
              aria-label={t('nameLabel')}
              placeholder={t('namePlaceholder')}
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={50}
              autoComplete="nickname"
            />
            <div>
              <p style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 4 }}>{t('pinLabel')}</p>
              <PinInput value={pin} onChange={setPin} digits={4} label={t('pinLabel')} ariaInvalid={error === 'invalid' || error === 'too_common'} />
            </div>
            <div>
              <p style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 4 }}>{t('confirmPinLabel')}</p>
              <PinInput value={confirmPin} onChange={setConfirmPin} digits={4} label={t('confirmPinLabel')} ariaInvalid={error === 'mismatch'} />
            </div>
            <button
              type="button"
              disabled={!canSubmit}
              onClick={submit}
              className="btn-primary"
              style={{ marginTop: 4, width: '100%' }}
            >
              {submitting ? t('submitting') : t('submit')}
            </button>
            {error === 'mismatch' && (
              <p role="alert" style={{ color: 'var(--color-red, #ef4444)', fontSize: 12 }}>{t('errorMismatch')}</p>
            )}
            {error === 'too_common' && (
              <p role="alert" style={{ color: 'var(--color-red, #ef4444)', fontSize: 12 }}>{t('errorTooCommon')}</p>
            )}
            {error === 'invalid' && (
              <p role="alert" style={{ color: 'var(--color-red, #ef4444)', fontSize: 12 }}>{t('errorInvalid')}</p>
            )}
            {error === 'rate_limited' && (
              <p role="alert" style={{ color: 'var(--color-amber, #f59e0b)', fontSize: 12 }}>{t('errorRateLimited')}</p>
            )}
            {error === 'network' && (
              <p role="alert" style={{ color: 'var(--color-amber, #f59e0b)', fontSize: 12 }}>{t('errorNetwork')}</p>
            )}
            {error === 'account_exists' && (
              <p role="alert" style={{ color: 'var(--color-amber, #f59e0b)', fontSize: 12 }}>{t('errorAccountExists')}</p>
            )}
            {error === 'invite_only' && (
              <p role="alert" style={{ color: 'var(--color-amber, #f59e0b)', fontSize: 12 }}>{t('errorInviteOnly')}</p>
            )}
          </div>
        )}
      </BottomSheetBody>
    </BottomSheet>
  );
}
