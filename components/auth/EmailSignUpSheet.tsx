'use client';

import { useTranslations } from 'next-intl';
import { BottomSheet, BottomSheetHeader, BottomSheetBody } from '@/components/BottomSheet';
import EmailSignUpForm from './EmailSignUpForm';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Account created and signed in. */
  onSuccess: (result: { name: string; verificationSent: boolean }) => void;
  /** See `EmailSignUpForm` — the invite the device arrived on, if any. */
  inviteToken?: string | null;
}

/**
 * The sheet wrapper around `EmailSignUpForm`.
 *
 * Everything that was here moved to the form so the onboarding create flow can
 * embed it as a step without portalling a sheet over a full-screen page. What
 * is left is the chrome and the one behaviour that is genuinely sheet-shaped:
 * `onDismiss`, which gives the no-mail note somewhere to go. A page has no
 * such place and carries the note onto its next step instead.
 */
export default function EmailSignUpSheet({ open, onClose, onSuccess, inviteToken }: Props) {
  const t = useTranslations('profile.auth');
  return (
    <BottomSheet open={open} onClose={onClose} ariaLabel={t('emailSignUpTitle')}>
      <BottomSheetHeader>{t('emailSignUpTitle')}</BottomSheetHeader>
      <BottomSheetBody>
        <EmailSignUpForm inviteToken={inviteToken} onSuccess={onSuccess} onDismiss={onClose} />
      </BottomSheetBody>
    </BottomSheet>
  );
}
