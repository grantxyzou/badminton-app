'use client';

import { useTranslations } from 'next-intl';
import { BottomSheet, BottomSheetHeader, BottomSheetBody } from '@/components/BottomSheet';
import SignInMethodsCard from './SignInMethodsCard';
import type { UseSignInMethods } from './useSignInMethods';

export interface SignInMethodsSheetProps {
  open: boolean;
  onClose: () => void;
  /** Shared with the Profile row that opens this, so the two agree. */
  state: UseSignInMethods;
}

/**
 * Profile → "How you sign in".
 *
 * This used to be a permanently-expanded card sitting in the middle of the
 * ACCOUNT list — a block with its own heading, a subtitle, a checklist, a
 * bordered Google button and a "Not now", wedged between two plain rows. It
 * read as an interruption rather than a setting, and the nudge variant of it
 * was the loudest thing on a screen whose other jobs are one line each.
 *
 * It is a row now, like PIN and recovery code beside it, and those two both
 * open a BottomSheet — so this does too, rather than inventing a third
 * container. The nudge survives as `accent` on the row, which is how this
 * design system already says "this one is asking for you" (the admin row's
 * live count uses the same signal). Accent is currency: it marks the row that
 * wants action, and the card no longer has to shout to be that row.
 */
export default function SignInMethodsSheet({ open, onClose, state }: SignInMethodsSheetProps) {
  const t = useTranslations('profile.auth');
  // `close` lives in the recovery namespace; every other sheet reuses it
  // rather than minting a second copy of the word.
  const tCommon = useTranslations('recovery');

  return (
    <BottomSheet open={open} onClose={onClose} ariaLabel={t('methodsTitle')}>
      <BottomSheetHeader>
        <span style={{ fontSize: 'var(--fs-lg)', fontWeight: 600 }}>{t('methodsTitle')}</span>
        <button
          type="button"
          onClick={onClose}
          aria-label={tCommon('close')}
          style={{
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            minWidth: 44,
            minHeight: 44,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <span className="material-icons" style={{ fontSize: 'var(--fs-stat)' }}>
            close
          </span>
        </button>
      </BottomSheetHeader>
      <BottomSheetBody>
        {/* `embedded`: the sheet header carries the title and the surface, so
            the card drops its own CardHeader and glass-card chrome. */}
        <SignInMethodsCard state={state} embedded />
      </BottomSheetBody>
    </BottomSheet>
  );
}
