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

/**
 * Consolidated error states. Internal server errors (mismatch / too_common /
 * invalid PIN format) collapse to one "pin_problem" message — friends just
 * need to pick a different PIN, they don't need to know which check failed.
 * Transient failures (rate_limited / network) collapse to "try_later".
 * account_exists and invite_only stay distinct because they have specific
 * next-step CTAs. name_required is form-level validation — disable submit
 * instead of erroring. #94
 */
type ErrorKind = 'pin_problem' | 'try_later' | 'account_exists' | 'invite_only' | null;

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
    // canSubmit gates the trimmed-name + matching-PIN cases; we never reach
    // submit() when those fail. Keep the mismatch check as a belt-and-
    // suspenders safety net since the PinInput allows submit-via-Enter.
    if (pin !== confirmPin) { setError('pin_problem'); return; }
    setSubmitting(true);
    try {
      const res = await fetch(`${BASE}/api/players`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed, pin, sessionSignup: false }),
      });
      if (res.status === 429) { setError('try_later'); return; }
      if (!res.ok) {
        // Batch C M4: clone the response so we can both attempt JSON
        // parse AND log the raw body if parsing fails. The previous
        // .catch(() => ({})) silently masked Azure proxy HTML error pages
        // as "Network error" — leaving operators no breadcrumb when a
        // deploy was misconfigured.
        const cloned = res.clone();
        let data: { error?: string } = {};
        try {
          data = await res.json();
        } catch {
          const raw = await cloned.text().catch(() => '');
          console.warn(`POST /api/players ${res.status} non-JSON body:`, raw.slice(0, 200));
        }
        // PIN-shape failures all collapse to "pin_problem" — the friend's
        // next action is the same regardless: pick a different PIN.
        if (data.error === 'pin_too_common' || data.error === 'Invalid PIN format') {
          setError('pin_problem'); return;
        }
        if (data.error === 'account_exists') { setError('account_exists'); return; }
        if (data.error === 'invite_list_not_found') { setError('invite_only'); return; }
        setError('try_later');
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
      setError('try_later');
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
              <PinInput value={pin} onChange={setPin} digits={4} label={t('pinLabel')} ariaInvalid={error === 'pin_problem'} />
            </div>
            <div>
              <p style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 4 }}>{t('confirmPinLabel')}</p>
              <PinInput value={confirmPin} onChange={setConfirmPin} digits={4} label={t('confirmPinLabel')} ariaInvalid={error === 'pin_problem'} />
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
            {error === 'pin_problem' && (
              <p role="alert" style={{ color: 'var(--color-red, #ef4444)', fontSize: 12 }}>{t('errorPinProblem')}</p>
            )}
            {error === 'try_later' && (
              <p role="alert" style={{ color: 'var(--color-amber, #f59e0b)', fontSize: 12 }}>{t('errorTryLater')}</p>
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
