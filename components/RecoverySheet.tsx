'use client';
import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { BottomSheet, BottomSheetHeader, BottomSheetBody } from './BottomSheet';
import SignInForm from './SignInForm';
import { setIdentity } from '@/lib/identity';

interface Props {
  open: boolean;
  onClose: () => void;
  sessionId: string;
  /** When provided, a small "Forgot your PIN?" text link is rendered below the
   *  Sign in button. Click closes the sheet and invokes this callback so the
   *  caller can hand off to a code-redemption surface (e.g. open EnterCodeSheet
   *  or navigate to Profile). */
  onForgotPin?: () => void;
}

/**
 * Modal sheet wrapper around <SignInForm>. Adds:
 * - The 1.5s "Welcome back, {name}" success animation before auto-close
 * - Identity write on success (so callers of this sheet don't have to)
 *
 * Most of the form lives in <SignInForm> now (shared with ProfileTab's
 * inline sign-in path).
 */
export default function RecoverySheet({ open, onClose, sessionId, onForgotPin }: Props) {
  const t = useTranslations('recovery');
  const [success, setSuccess] = useState<string | null>(null);

  // Reset success state when the sheet closes so reopening shows the form.
  useEffect(() => {
    if (!open) setSuccess(null);
  }, [open]);

  function handleSuccess({ name, token }: { name: string; token?: string }) {
    setIdentity({ name, token, sessionId });
    setSuccess(name);
    setTimeout(() => { onClose(); }, 1500);
  }

  function handleForgotPin() {
    onClose();
    onForgotPin?.();
  }

  return (
    <BottomSheet open={open} onClose={onClose} ariaLabel={t('sheetTitle')} className="max-w-lg mx-auto">
      <BottomSheetHeader className="flex items-center justify-between p-4">
        <span style={{ fontSize: 16, fontWeight: 600 }}>{t('sheetTitle')}</span>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('close')}
          style={{ background: 'transparent', border: 'none', cursor: 'pointer', minWidth: 44, minHeight: 44, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <span className="material-icons" style={{ fontSize: 20 }}>close</span>
        </button>
      </BottomSheetHeader>
      <BottomSheetBody className="p-5 pb-8">
        {success ? (
          <p style={{ textAlign: 'center', fontSize: 18, color: 'var(--text-primary)' }}>
            {t('welcomeBack', { name: success })}
          </p>
        ) : (
          <SignInForm
            sessionId={sessionId}
            onSuccess={handleSuccess}
            onForgotPin={onForgotPin ? handleForgotPin : undefined}
          />
        )}
      </BottomSheetBody>
    </BottomSheet>
  );
}
