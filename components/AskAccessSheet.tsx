'use client';

import { useTranslations } from 'next-intl';
import { BottomSheet, BottomSheetHeader, BottomSheetBody } from '@/components/BottomSheet';
import { setIdentity } from '@/lib/identity';
import AskAccessForm from '@/components/auth/AskAccessForm';

/**
 * "Can't sign in?" as a sheet, for Profile's anonymous card. The signed-out
 * screen shows the same form as a PAGE (`AskAccessPage` in SignedOutShell):
 * a real person approves it, so it should not feel like a passing pop-up
 * (Grant, 2026-11-08). The form lives in `components/auth/AskAccessForm.tsx`.
 *
 * Here an approval signs the phone in at once: the identity is written as the
 * server answers, and the caller hears about it through `onSignedIn`.
 */
export default function AskAccessSheet({
  open,
  onClose,
  sessionId,
  initialName = '',
  onSignedIn,
  claim,
}: {
  open: boolean;
  onClose: () => void;
  sessionId: string;
  initialName?: string;
  /** Fired once they are actually signed in. `hasPin` decides whether it is
   *  worth offering them one. */
  onSignedIn: (result: { name: string; hasPin: boolean; email?: string }) => void;
  claim?: { token: string; clubName: string } | null;
}) {
  const t = useTranslations('recovery');
  const club = claim?.clubName ?? null;
  const title = club ? t('claimTitle', { club }) : t('askTitle');

  return (
    <BottomSheet open={open} onClose={onClose} ariaLabel={title}>
      <BottomSheetHeader>
        <span style={{ fontSize: 'var(--fs-lg)', fontWeight: 600 }}>{title}</span>
        <button type="button" onClick={onClose} aria-label={t('close')} className="sheet-close-btn">
          <span className="material-icons" style={{ fontSize: 'var(--fs-stat)' }}>close</span>
        </button>
      </BottomSheetHeader>
      <BottomSheetBody>
        <AskAccessForm
          active={open}
          initialName={initialName}
          claim={claim}
          onApproved={(result) => {
            setIdentity({ name: result.name, sessionId });
            onSignedIn(result);
          }}
        />
      </BottomSheetBody>
    </BottomSheet>
  );
}
