'use client';

import { useTranslations } from 'next-intl';
import TopBar from '@/components/primitives/TopBar';
import CardSkeleton from '@/components/primitives/CardSkeleton';
import ProfileEyebrow from '@/components/primitives/ProfileEyebrow';
import SignInMethodsCard from '@/components/auth/SignInMethodsCard';
import type { UseSignInMethods } from '@/components/auth/useSignInMethods';
import SettingsList, { type SettingsRow } from './SettingsList';

interface Props {
  /** Shared with the Profile row that opens this page, so the two agree. */
  state: UseSignInMethods;
  /** Whether the member has a PIN: `null` while unknown or after a failed read. */
  pinIsSet: boolean | null;
  onChangePin: () => void;
  onRecoveryCode: () => void;
  onBack: () => void;
}

/**
 * "How you sign in" (docs/superpowers/specs/2026-11-09-profile-reorg-design.md §9,
 * build step 3): everything about getting back into the account, on one page.
 *
 * It used to be three rows on Profile — How you sign in, Update PIN, Have a
 * recovery code? — answering one question three times. The list keeps one row
 * (its summary says what is connected); this page holds the rest: the ways you
 * have and can add (Apple, Google, an email and password), then the PIN and the
 * recovery code underneath.
 *
 * A page, not a sheet, like Edit profile beside it (Grant, 2026-11-08). The PIN
 * row shows only while the member has one: PINs are being phased out
 * (2026-11-07), so nobody is offered a new one here, and an unknown answer
 * shows the neutral title rather than claiming either way.
 */
export default function WaysToSignInPage({ state, pinIsSet, onChangePin, onRecoveryCode, onBack }: Props) {
  const tAuth = useTranslations('profile.auth');
  const t = useTranslations('profile');
  const tSettings = useTranslations('profile.settings');
  const tPage = useTranslations('profile.waysToSignIn');

  const rows: SettingsRow[] = [
    ...(pinIsSet === false
      ? []
      : [{
          icon: 'key',
          label: pinIsSet ? tSettings('updatePin') : t('pinSectionTitle'),
          onClick: onChangePin,
        }]),
    { icon: 'help_outline', label: tSettings('recoveryCode'), onClick: onRecoveryCode },
  ];

  return (
    // NOT a header-only wrapper: TopBar is sticky (StatsPrivacyScreen says why).
    <div className="animate-slideInRight flex flex-col gap-4" data-ways-to-sign-in-page>
      <TopBar title={tAuth('methodsTitle')} onBack={onBack} backLabel={tPage('back')} />
      {/* `embedded`: the page bar already carries the title, so the card drops
          its own header and chrome and sits in one plain card, as it did in
          the sheet this page replaced. */}
      {state.methods || state.loadError ? (
        <div className="glass-card p-5">
          <SignInMethodsCard state={state} embedded />
        </div>
      ) : (
        // The card's place while the methods load: never an empty box.
        <CardSkeleton height={120} />
      )}
      <ProfileEyebrow>{tPage('moreGroup')}</ProfileEyebrow>
      <SettingsList rows={rows} />
    </div>
  );
}
