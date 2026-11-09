'use client';
import { usePageBack } from '@/lib/pageStack';
import { useEffect, useLayoutEffect, useState } from 'react';
import { sharedFetch } from '@/lib/sharedRead';
import { useTranslations } from 'next-intl';
import { getIdentity, clearIdentity, IDENTITY_EVENT, type Identity } from '@/lib/identity';
import type { Release } from '@/lib/types';
import EnterCodeSheet from './EnterCodeSheet';
import AskAccessSheet from './AskAccessSheet';
import MigrateSheet from './MigrateSheet';
import MigrateCodeSheet from './MigrateCodeSheet';
import CreateAccountSheet from './CreateAccountSheet';
import DeleteAccountSheet from '@/components/auth/DeleteAccountSheet';
import RecoveryPinSheet from './RecoveryPinSheet';
import ReleaseNotesSheet from './ReleaseNotesSheet';
import ReportProblemSheet from './ReportProblemSheet';
import InstallSheet from './InstallSheet';
import SignInForm from './SignInForm';
import ProviderButtons, { type Provider as AuthProvider } from './auth/ProviderButtons';
import { useSignInMethods, methodsSummary } from './auth/useSignInMethods';
import EmailSignInForm from './auth/EmailSignInForm';
import EmailSignUpSheet from './auth/EmailSignUpSheet';
import ForgotPasswordSheet from './auth/ForgotPasswordSheet';
import type { UsePushResult } from '@/lib/usePush';
import { isStandalone } from '@/lib/standalone';
import { isNative } from '@/lib/native';
import PageHeader from './primitives/PageHeader';
import { ProfileSkeleton } from './TabFallbacks';
import ProfileEyebrow from './primitives/ProfileEyebrow';
import StatsPrivacyScreen from './StatsPrivacyScreen';
import NicknamePage from './profile/NicknamePage';
import { useStatsPrivacy } from '@/lib/useStatsPrivacy';
import { takeProfileView } from '@/lib/profileView';
import { useTabActive } from '@/lib/tabActivity';
import { isFlagOn } from '@/lib/flags';
import { useAdminNeedsYou } from '@/lib/useAdminNeedsYou';
import { useCurrentGroup } from '@/lib/useCurrentGroup';
import GroupsPage from './profile/GroupsPage';
import SettingsList, { type SettingsRow } from './profile/SettingsList';
import StatusBanner from './primitives/StatusBanner';
import MemberAvatar from './primitives/MemberAvatar';
import EditProfilePage from './profile/EditProfilePage';
import WaysToSignInPage from './profile/WaysToSignInPage';
import GiftCardsPage, { fmtCents } from './profile/GiftCardsPage';
import GiveGiftPage from './profile/GiveGiftPage';
import { useCredit } from './profile/useCredit';
import { normalizeAvatar, type MemberAvatar as MemberAvatarValue } from '@/lib/memberAvatar';
import { clearDeviceTraces } from '@/lib/clearDeviceTraces';
import { useBuildSha } from '@/lib/buildSha';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
/** The deployed commit, baked in at build time (`deploy-next.yml`); `dev` locally. */

interface Props {
  sessionId: string;
  sessionLabel: string;
  isAdmin: boolean;
  onAdminTools: () => void;
  /**
   * Providers this deployment can offer, resolved on the server and threaded
   * down from `app/page.tsx`. See `ProviderButtons` for why it is not probed
   * here: these buttons lead the anonymous card, and a probe would reflow it.
   */
  authProviders?: AuthProvider[];
  /**
   * Set by HomeShell when the page was opened from the public
   * /legal/delete-account page (`?tab=profile&intent=delete`). The delete
   * sheet opens as soon as an identity exists — immediately if signed in,
   * after sign-in otherwise — and the intent is consumed so a later reload
   * doesn't reopen it.
   */
  deleteIntent?: boolean;
  onDeleteIntentConsumed?: () => void;
  /** Remount the tabs after a group switch — HomeShell's `refreshNonce`. */
  onGroupSwitched?: () => void;
  /** Open the onboarding sheets, which HomeShell owns. */
  onJoinGroup?: () => void;
  onCreateGroup?: () => void;
  /**
   * The invite this device arrived on, threaded to the email signup terminal so
   * a stranger who followed a club's link becomes an account IN THAT CLUB. See
   * the note on `EmailSignUpSheet`'s prop.
   */
  inviteToken?: string | null;
  /**
   * Push state, owned by HomeShell and shared with the Notifications page, so
   * the row's On/Off and the page's switch cannot disagree. Absent (a test, or
   * a render outside the shell) shows the row with no status — unknown, not Off.
   */
  push?: UsePushResult;
  /** The row opens the Notifications page, which HomeShell owns. */
  onOpenNotifications?: () => void;
}

export default function ProfileTab({
  sessionId,
  isAdmin,
  onAdminTools,
  authProviders = [],
  deleteIntent = false,
  onDeleteIntentConsumed,
  onGroupSwitched,
  onJoinGroup,
  onCreateGroup,
  inviteToken,
  push,
  onOpenNotifications,
}: Props) {
  const t = useTranslations('profile');
  const tGroups = useTranslations('groups');
  const buildSha = useBuildSha();
  // Multi-group: the switcher's data. Resolves to `group: null` with the flag
  // off (the endpoints 404 by design), so the row simply does not render.
  const { group, groups, loading: groupsLoading, error: groupsError, refresh: refreshGroups } = useCurrentGroup();
  // `undefined` = not read yet. It used to start as `null` — "signed out" — so
  // a signed-in member's first frame was the anonymous sign-in card, before
  // the effect below read localStorage. Not read yet renders the loading frame.
  const [identity, setLocalIdentity] = useState<Identity | null | undefined>(undefined);
  /**
   * Which credential the anonymous card is asking for. One form is visible at a
   * time — a PIN form, an email form and two account-creation buttons stacked
   * together would be four competing calls to action on the first screen a
   * signed-out person sees.
   *
   * Defaults to 'pin', and that is a fact about the POPULATION rather than a
   * judgement about the credential: every existing member has a PIN and none
   * has a password yet, so someone who declines the providers and reaches for a
   * form can only use this one. Flip the default once real password accounts
   * exist.
   */
  const [credMode, setCredMode] = useState<'pin' | 'email'>('pin');
  const [emailSignUpOpen, setEmailSignUpOpen] = useState(false);
  const [forgotPasswordOpen, setForgotPasswordOpen] = useState(false);
  // null = unknown/loading or fetch failed. Used to avoid the bug where a
  // 5xx on /api/members/me silently rendered "Recovery PIN: Not set" and
  // pushed users into a re-create loop that 409'd on `account_exists`.
  const [pinIsSet, setPinIsSet] = useState<boolean | null>(null);
  // Whether this device holds a valid member_session cookie. Gates first-PIN
  // set in RecoveryPinSheet (the server requires the cookie for the claim flow).
  // null = unknown — don't block on it.
  const [pinAuthed, setPinAuthed] = useState<boolean | null>(null);
  /* Whether the members/me probe has ANSWERED (either way) for the current
     identity. Until it has, Profile cannot tell a signed-in member from a
     device that only remembers a name, and must show neither. */
  const [authKnown, setAuthKnown] = useState(false);
  const [memberCreatedAt, setMemberCreatedAt] = useState<string | null>(null);
  const [avatar, setAvatar] = useState<MemberAvatarValue | null>(null);
  // This club's rank (roles v2). `null` = not known yet, or the read failed:
  // the card then falls back to the shell's admin verdict.
  const [rank, setRank] = useState<ProfileRank | null>(null);
  const [enterCodeOpen, setEnterCodeOpen] = useState(false);
  // Whether this member may give out gift cards (`Member.canGift`), asked of
  // the server once an identity exists; unknown and no both hide the row.
  const [canGift, setCanGift] = useState(false);
  const [askAccessOpen, setAskAccessOpen] = useState(false);
  const [createAccountOpen, setCreateAccountOpen] = useState(false);
  const [deleteAccountOpen, setDeleteAccountOpen] = useState(false);
  // "Move to the app" (PWA/web → native). The row shows on the web only; the
  // native shell shows the code-entry sheet on its signed-out card instead.
  const [migrateOpen, setMigrateOpen] = useState(false);
  const [migrateCodeOpen, setMigrateCodeOpen] = useState(false);
  const migrateOn = isFlagOn('NEXT_PUBLIC_FLAG_NATIVE_MIGRATE');
  // Signed-in state PIN management: tap the Settings "Recovery PIN" row to
  // open RecoveryPinSheet (set / change / remove + forgot-it handoff).
  const [recoveryPinOpen, setRecoveryPinOpen] = useState(false);
  const [releaseSheetOpen, setReleaseSheetOpen] = useState(false);
  // Stats & privacy is a full-screen SUB-VIEW, not a sheet — every other row
  // here opens a BottomSheet, so this is new structure for ProfileTab. The
  // pattern (view state + early return + slideInRight + TopBar) is borrowed
  // from AdminDashboard, which is the only place in the app that already does
  // sub-screens.
  // 'profile' is Edit profile, opened from the card; 'name' opens from it, so
  // its Back returns there rather than to the list.
  const [view, setView] = useState<'root' | 'stats-privacy' | 'groups' | 'name' | 'profile' | 'signin' | 'gift-cards' | 'give-gift'>('root');
  // A sub-screen answers the Android back button (lib/pageStack.ts).
  usePageBack(view !== 'root', () => setView((v) => (v === 'name' ? 'profile' : 'root')));
  // Read once here so the row's summary and the sheet's body agree.
  //
  // Gated on `identity`: the row only exists for a
  // signed-in member, and the anonymous card must not probe at all -- the
  // server has already resolved availability by the time that card renders,
  // and a probe would reflow it. Same shape as `useStatsPrivacy` above, which
  // takes null when there is nobody to read for.
  const methodsState = useSignInMethods(!!identity);
  // Store credit (docs/plans/payments.md): read once here so the MONEY row's
  // figure and the Gift cards & credit page agree. Flag off, nothing is read.
  const creditOn = isFlagOn('NEXT_PUBLIC_FLAG_STORE_CREDIT');
  const credit = useCredit(!!identity && creditOn);
  const privacyState = useStatsPrivacy(identity?.name ?? null);
  // Called unconditionally, and gated by its own argument, because the two
  // early returns below (anonymous, and the Stats & privacy sub-screen) sit
  // between here and the row that renders the count.
  const showAdminRow = isAdmin;
  const adminSignals = useAdminNeedsYou(showAdminRow);
  const [reportOpen, setReportOpen] = useState(false);
  const [installOpen, setInstallOpen] = useState(false);
  // Only offer "Add to Home Screen" when NOT already installed. Resolved
  // post-mount (display-mode/navigator.standalone are client-only); defaults
  // to false so the row shows in the browser, which is exactly when it helps.
  const [installed, setInstalled] = useState(false);
  const [releases, setReleases] = useState<Release[] | null>([]);
  const tSettings = useTranslations('profile.settings');
  const tAuth = useTranslations('profile.auth');
  const tNav = useTranslations('nav');
  const tPush = useTranslations('profile.push');

  // A layout effect, not an effect: the check is synchronous, and running it
  // after paint showed the "Add to Home Screen" row for a frame and then
  // removed it — in the native shell and every installed PWA, i.e. most of
  // the people who open this screen. ProfileTab is client-only (ssr: false),
  // so there is no server render for this to disagree with.
  useLayoutEffect(() => {
    // The native shell IS the installed app; the "Add to Home Screen" row
    // would be telling it to install itself.
    setInstalled(isStandalone() || isNative());
  }, []);

  useEffect(() => {
    const id = getIdentity();
    setLocalIdentity(id);
    sharedFetch('/api/releases')
      .then(async (r) => {
        if (!r.ok) throw new Error(`releases fetch ${r.status}`);
        return r.json();
      })
      .then((data: Release[]) => setReleases(Array.isArray(data) ? data : null))
      .catch(() => setReleases(null));
  }, []);

  // Listen for identity mutations from any other component (e.g. EnterCodeSheet
  // completing the recovery-code flow, RecoverySheet finishing PIN sign-in).
  // Without this, ProfileTab's local `identity` state stays stale after a
  // recovery and the downstream `hasPin` fetch never refires — leaving users
  // stuck in 3-field "Update PIN" mode after a code redemption that should
  // have cleared their PIN.
  useEffect(() => {
    function refresh() { setLocalIdentity(getIdentity()); }
    window.addEventListener(IDENTITY_EVENT, refresh);
    return () => window.removeEventListener(IDENTITY_EVENT, refresh);
  }, []);

  // A Stats card's "turn this off" link (lib/profileView.ts) lands here on the
  // Stats & privacy screen. Waits for an identity: that screen is for a
  // signed-in member, and the marker is consumed only once one exists.
  // On each ARRIVAL: the tab is kept, and usually mounted before the link
  // is tapped (lib/tabActivity.ts).
  const onScreen = useTabActive();
  useEffect(() => {
    if (!identity || !onScreen) return;
    if (takeProfileView() === 'stats-privacy') setView('stats-privacy');
  }, [identity, onScreen]);

  // Deep link from the public delete-account page. Waits for an identity so a
  // signed-out person sees the ordinary sign-in card first, then the sheet.
  useEffect(() => {
    if (!deleteIntent || !identity) return;
    // Deleting lives on Edit profile now, so the deep link lands there with
    // the confirmation open.
    setView('profile');
    setDeleteAccountOpen(true);
    onDeleteIntentConsumed?.();
  }, [deleteIntent, identity, onDeleteIntentConsumed]);

  // The gift-card switch (docs/plans/gift-card-ledger.md): the route answers
  // `{ canGift: false }` for everyone else, so a 'no' and a failed read both
  // leave the row hidden — there is nothing to act on either way.
  useEffect(() => {
    if (!identity || !isFlagOn('NEXT_PUBLIC_FLAG_STORE_CREDIT')) {
      setCanGift(false);
      return;
    }
    let live = true;
    fetch(`${BASE}/api/giftcards`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { canGift?: boolean } | null) => { if (live) setCanGift(d?.canGift === true); })
      .catch(() => { if (live) setCanGift(false); });
    return () => { live = false; };
  }, [identity]);

  // Reflect server-side pin status whenever identity changes (mount, sign-in,
  // logout). Source of truth is `members.pinHash` mirrored from the player
  // record — `/api/members/me` returns `hasPin` as a derived boolean. Avoids
  // the previous localStorage-flag approach which de-synced after sign-in
  // and was the bug behind "Recovery PIN: Not set" until refresh.
  useEffect(() => {
    if (!identity) {
      setPinIsSet(null);
      return;
    }
    let cancelled = false;
    setPinIsSet(null); // mark unknown while fetching
    setAuthKnown(false);
    // PIN status — its OWN chain so a players-fetch failure can never reset it.
    // Previously these were chained (members/me -> players) under one catch, so
    // a transient players rejection wiped a perfectly good pinIsSet=true,
    // mislabeling the PIN row (audit silent-failure cluster).
    // `sharedFetch`: the Stats-privacy hook asks for this same path as Profile
    // mounts, and one request in flight serves both (performance audit,
    // 2026-10-19). It shares only while the request is open, so a refetch
    // after a PIN change still goes to the server.
    sharedFetch(`/api/members/me?name=${encodeURIComponent(identity.name)}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`hasPin fetch ${r.status}`);
        return r.json();
      })
      .then((data: { hasPin?: boolean; createdAt?: string | null; authed?: boolean; avatar?: unknown; rank?: unknown }) => {
        if (cancelled) return;
        setPinIsSet(data.hasPin === true);
        setAvatar(normalizeAvatar(data.avatar));
        setMemberCreatedAt(typeof data.createdAt === 'string' ? data.createdAt : null);
        setRank(readRank(data.rank));
        // `authed` gates first-PIN set in RecoveryPinSheet; unknown stays null.
        setPinAuthed(typeof data.authed === 'boolean' ? data.authed : null);
        setAuthKnown(true);
      })
      .catch((err) => {
        if (cancelled) return;
        // Keep status unknown rather than asserting "Not set". The audit
        // (H4) found this default-to-false flip was pushing users into
        // recreate-account loops on transient backend failures.
        console.warn('hasPin fetch failed:', err);
        setPinIsSet(null);
        setPinAuthed(null);
        // Answered with "unknown": fall back to the signed-in view rather than
        // locking someone out of their own Profile over a network blip.
        setAuthKnown(true);
      });

    return () => {
      cancelled = true;
    };
  }, [identity]);

  // Money used to live here too — "This week / Estimated $17.46" and "Last
  // session / Final cost" rows inside the identity card. It moved to Home's
  // balance card (design "Profile hierarchy", 2026-08-27): identity and
  // what-you-owe were sharing one surface, and the amount was set at the same
  // size as the member's own name. One number, one place, on the tab you open
  // first. Profile is identity, permissions and settings only.

  // After a recovery-code redemption, the user's old PIN was cleared server-
  // side and a member_session cookie was minted. Walk them straight into
  // setting a new PIN so they leave recovery with a working credential.
  function handleRecovered() {
    setEnterCodeOpen(false);
    setLocalIdentity(getIdentity());
    setPinIsSet(false); // the code path cleared the PIN → first-set mode
    setPinAuthed(true); // recover minted the member_session cookie
    setRecoveryPinOpen(true);
  }

  async function handleLogout() {
    // The icon's badge, long-press menu and widget carry this person's balance;
    // cleared first, but never waited on for long (lib/clearDeviceTraces.ts).
    await clearDeviceTraces();
    // Single-identity model: logging out as a player also revokes admin
    // status. Otherwise the admin cookie outlived the player session and
    // leaked admin powers to whoever signed in next on the same browser.
    clearIdentity();
    setLocalIdentity(null);
    setPinIsSet(null);
    try {
      const res = await fetch(`${BASE}/api/admin`, { method: 'DELETE' });
      if (!res.ok) {
        // Cookie clear is the difference between "fully logged out" and
        // "next person on this browser inherits admin powers" — log so a
        // future bug investigation can find it. Local identity is already
        // cleared so the user-facing state is consistent.
        console.warn('Admin cookie clear failed:', res.status);
      }
    } catch (err) {
      console.warn('Admin cookie clear failed (network):', err);
    }
  }

  // Anonymous state — Profile is identity-only. Inline sign-in form (name +
  // PIN) sits in the glass card; "Create an account" lives below an "or"
  // divider and opens an action sheet. Session signup belongs on Home, not
  // here. The form itself is shared with HomeTab via <SignInForm>.
  async function handleSignInSuccess({ name, token }: { name: string; token?: string }) {
    const { setIdentity } = await import('@/lib/identity');
    setIdentity({ name, token, sessionId });
    setLocalIdentity(getIdentity());
  }

  // A device that remembers a name but holds no session for it (a name-only
  // sign-up, or a 30-day cookie that lapsed). Grant, 2026-09-14: "why show
  // user and bunch of buttons and items when they are not even signed in?"
  // Every row in the signed-in tree would be refused, so it gets the sign-in
  // screen, told whose name this is. KNOWN false only — `null` is unknown —
  // and never for an admin, whose sign-in mints only the admin cookie.
  const deviceSignedOut = !!identity && authKnown && pinAuthed === false && !isAdmin;

  if (identity === undefined || (identity && !authKnown && !isAdmin)) {
    // The same frame the chunk fallback showed (TabFallbacks), shaped like the
    // member page it becomes — so nothing changes until the content does.
    return (
      <div key="profile-loading">
        <ProfileSkeleton title={tNav('profile')} />
      </div>
    );
  }

  if (!identity || deviceSignedOut) {
    // Availability is server-resolved, so this is settled on the first paint
    // rather than arriving later and reflowing the card.
    const providersLead = authProviders.length > 0;
    const emailMode = credMode === 'email';
    const orDivider = (
      <div
        aria-hidden="true"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-3)',
          color: 'var(--text-muted)',
          fontSize: 'var(--fs-xs)',
          textTransform: 'uppercase',
          letterSpacing: '0.1em',
        }}
      >
        <span style={{ flex: 1, height: 1, background: 'var(--glass-border)' }} />
        <span>{t('anonymousOrDivider')}</span>
        <span style={{ flex: 1, height: 1, background: 'var(--glass-border)' }} />
      </div>
    );
    const createAccountLabel = emailMode ? t('auth.createEmailCta') : t('anonymousCreateCta');
    const openCreateAccount = () =>
      emailMode ? setEmailSignUpOpen(true) : setCreateAccountOpen(true);
    /**
     * The three secondary routes, on one row.
     *
     * They used to sit on two: "Forgot your PIN?" is rendered BY the form, and
     * the other two lived in a row beneath it. Both forms expose their forgot
     * callback as optional, so when providers lead we withhold it and render
     * all three here instead — one plane of equal-weight links under the form,
     * rather than a stray link followed by a pair.
     *
     * Labels are deliberately shorter than the full-sentence versions the forms
     * use elsewhere: three of those do not fit across a 366px card, and the
     * shared keys still read in full inside RecoverySheet where there is room.
     */
    const secondaryRow = (
      <div
        style={{
          display: 'flex',
          // Centred as one cluster, not justified to the card edges: spread
          // across the full width they read as three unrelated corners rather
          // than one row of peers. `.link-quiet` already carries 12px of side
          // padding, so adjacent labels sit 24px apart with no gap of our own —
          // enough to separate, close enough to group.
          justifyContent: 'center',
          alignItems: 'center',
          flexWrap: 'wrap',
          // Inherited by the three buttons: a label must never break mid-phrase
          // ("Forgot / PIN?"). If the row runs out of width the ROW wraps, which
          // still reads, whereas a broken label reads as a rendering fault.
          whiteSpace: 'nowrap',
        }}
      >
        <button
          type="button"
          /* Was: open EnterCodeSheet, whose help text read "Ask the admin for
             a 6-digit code" — the app instructing people to leave the app and
             message someone. Now it asks for them. The code path still exists
             for anyone Grant hands a code to in person; it is just no longer
             the only door. */
          onClick={() => (emailMode ? setForgotPasswordOpen(true) : setAskAccessOpen(true))}
          className="link-quiet"
        >
          {emailMode ? t('auth.rowForgotPassword') : t('auth.rowForgotPin')}
        </button>
        <button type="button" onClick={openCreateAccount} className="link-quiet">
          {t('auth.rowCreateAccount')}
        </button>
        <button
          type="button"
          onClick={() => setCredMode((m) => (m === 'pin' ? 'email' : 'pin'))}
          className="link-quiet"
        >
          {credMode === 'pin' ? t('auth.rowUseEmail') : t('auth.rowUsePin')}
        </button>
        {migrateOn && isNative() && (
          <button type="button" onClick={() => setMigrateCodeOpen(true)} className="link-quiet">
            {t('migrate.rowEnterCode')}
          </button>
        )}
      </div>
    );
    const switchCredentialLink = (
      <button
        type="button"
        onClick={() => setCredMode((m) => (m === 'pin' ? 'email' : 'pin'))}
        className="link-quiet"
      >
        {credMode === 'pin' ? t('auth.useEmailInstead') : t('auth.usePinInstead')}
      </button>
    );
    return (
      <div key="profile-anon" className="motion-fade flex flex-col gap-4">
        <PageHeader>{t('anonymousTitle')}</PageHeader>
        {identity ? (
          <StatusBanner
            tone="warn"
            icon="lock"
            title={t('deviceSignedOut.title', { name: identity.name })}
            body={
              <span style={{ display: 'grid', gap: 'var(--space-1)', justifyItems: 'start' }}>
                <span>{pinIsSet === false ? t('deviceSignedOut.noCredentialBody') : t('deviceSignedOut.body')}</span>
                {pinIsSet === false && (
                  <button
                    type="button"
                    className="link-quiet"
                    style={{ paddingInline: 0, fontWeight: 600 }}
                    onClick={() => setAskAccessOpen(true)}
                  >
                    {t('deviceSignedOut.ask')}
                  </button>
                )}
                <button
                  type="button"
                  className="link-quiet"
                  style={{ paddingInline: 0 }}
                  onClick={() => { clearIdentity(); setLocalIdentity(null); }}
                >
                  {t('deviceSignedOut.forget', { name: identity.name })}
                </button>
              </span>
            }
          />
        ) : (
          <p style={{ color: 'var(--text-secondary)' }}>{t('anonymousBody')}</p>
        )}
        <div className="glass-card p-4" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          {/* Providers LEAD. One tap, nothing to remember, and the only route
              that works on a phone which has never seen this app — it is also
              the only one that ends up holding a verified email, so recovery
              works afterwards.

              An existing PIN member who taps here is not stranded: the callback
              lands on ChooseNameSheet, their name comes back `name_taken`, and
              "Is that you?" merges the account against their PIN. That claim
              path is the migration this whole feature exists for, so leading
              with it is the point rather than a risk. */}
          {providersLead && (
            <>
              <ProviderButtons mode="signin" available={authProviders} />
              {/* The meaningful cut is one-tap vs typing — NOT sign-in vs
                  create, which was the old reading and was never true: both
                  halves of this card do both. Rendered here only when the
                  buttons above it exist, or a deployment with no provider
                  credentials gets a divider with nothing above it. */}
              {orDivider}
            </>
          )}
          {/* Keyed: PIN ↔ email crossfades. */}
          <div key={emailMode ? 'email' : 'pin'} className="motion-fade">
            {emailMode ? (
              <EmailSignInForm
                onSuccess={handleSignInSuccess}
                // Withheld when the row below owns it, or the card renders the
                // same escape hatch twice.
                onForgotPassword={providersLead ? undefined : () => setForgotPasswordOpen(true)}
              />
            ) : (
              <SignInForm
                sessionId={sessionId}
                initialName={identity?.name}
                onSuccess={handleSignInSuccess}
                onForgotPin={providersLead ? undefined : () => setEnterCodeOpen(true)}
              />
            )}
          </div>
          {/* A control's weight is relative to what it competes with, so
              "Create an account" is a link ONLY when providers lead.

              With them, a full-width button over-weights the rarer path:
              "Continue with Google" already creates accounts, so this is the
              second creation route, not the first. Without them — the flag off,
              or a deployment holding no provider credentials — it is the only
              way to make an account from this screen and nothing above it is
              competing, so it keeps the button it has always had. Three
              competing full-width pills was the clutter; one is not. */}
          {providersLead ? (
            secondaryRow
          ) : (
            <>
              {orDivider}
              <button
                type="button"
                onClick={openCreateAccount}
                className="btn-ghost"
                style={{ width: '100%' }}
              >
                {createAccountLabel}
              </button>
              {/* Choosing a credential TYPE is navigation, so it sits last and
                  reads as a link. As a full-width pill it competed with Sign in. */}
              {switchCredentialLink}
            </>
          )}
          {/* Standalone "Have a recovery code" link removed — the SignInForm's
              "Forgot your PIN?" link is the single entry to EnterCodeSheet now. #93 */}
        </div>
        <CreateAccountSheet
          open={createAccountOpen}
          onClose={() => {
            setCreateAccountOpen(false);
            // Refresh identity if the sheet set it.
            setLocalIdentity(getIdentity());
          }}
          sessionId={sessionId}
        />
        <AskAccessSheet
        open={askAccessOpen}
        onClose={() => setAskAccessOpen(false)}
        sessionId={sessionId ?? ''}
        onSignedIn={({ hasPin }) => {
          setAskAccessOpen(false);
          /* Only offered to someone who never had one. A person who forgot
             theirs already knows what a PIN is, and the recovery path they
             just used did not remove it. */
          if (!hasPin) setRecoveryPinOpen(true);
        }}
      />
      <EnterCodeSheet
          open={enterCodeOpen}
          onClose={() => setEnterCodeOpen(false)}
          sessionId={sessionId}
          onRecovered={handleRecovered}
        />
        {migrateOn && isNative() && (
          <MigrateCodeSheet open={migrateCodeOpen} onClose={() => setMigrateCodeOpen(false)} />
        )}
        <EmailSignUpSheet
          inviteToken={inviteToken}
          open={emailSignUpOpen}
          onClose={() => {
            setEmailSignUpOpen(false);
            setLocalIdentity(getIdentity());
          }}
          onSuccess={({ name }) => {
            handleSignInSuccess({ name });
            setEmailSignUpOpen(false);
          }}
        />
        <ForgotPasswordSheet
          open={forgotPasswordOpen}
          onClose={() => setForgotPasswordOpen(false)}
        />
        {isAdmin && (
          <div className="glass-card p-5">
            <button type="button" onClick={onAdminTools} className="cc-btn cc-btn-primary cc-btn-lg">
              {t('adminToolsButton')}
            </button>
          </div>
        )}
        {/* Reachable even when signed out — anonymous users hitting a sign-up
            problem are exactly the reports worth catching. */}
        <button
          type="button"
          onClick={() => setReportOpen(true)}
          className="btn-ghost"
          style={{ width: '100%', fontSize: 'var(--fs-base)' }}
        >
          {tSettings('reportProblem')}
        </button>
        <ReportProblemSheet open={reportOpen} onClose={() => setReportOpen(false)} />
      </div>
    );
  }

  // Sub-screen. Early return so the root Profile tree unmounts entirely and
  // TopBar's `position: sticky` resolves against the tall scroll root rather
  // than a short wrapper (see AdminBackHeader's note).
  if (view === 'groups' && group) {
    return (
      <GroupsPage
        onBack={() => setView('root')}
        groups={groups}
        loading={groupsLoading}
        loadError={groupsError}
        onRetry={() => void refreshGroups()}
        // A switch re-mints both cookies, so every tab has to refetch; this
        // page cannot do that itself, HomeShell owns the nonce. It also bumps
        // `refreshNonce`, which remounts ProfileTab and returns `view` to
        // 'root' for free — no explicit reset on the success path.
        onSwitched={() => onGroupSwitched?.()}
        // NOT resetting the view first: backing out of the onboarding page
        // returns HERE, which is where they came from. `setOnboarding(null)`
        // does not bump the nonce, so this component keeps its view.
        onJoinAnother={() => onJoinGroup?.()}
        onCreateAnother={() => onCreateGroup?.()}
      />
    );
  }

  if (view === 'stats-privacy') {
    return <StatsPrivacyScreen onBack={() => setView('root')} state={privacyState} />;
  }

  // The PIN and recovery-code sheets open from "How you sign in" and, for a
  // member who just got in without a PIN, from the root; each view that can
  // open them renders them (a sub-view's early return unmounts the root).
  const pinSheets = (
    <>
      <RecoveryPinSheet
        open={recoveryPinOpen}
        onClose={() => setRecoveryPinOpen(false)}
        identity={identity}
        hasPin={pinIsSet === true}
        authed={pinAuthed}
        onSaved={(newHasPin) => setPinIsSet(newHasPin)}
      />
      <EnterCodeSheet
        open={enterCodeOpen}
        onClose={() => setEnterCodeOpen(false)}
        sessionId={sessionId}
        onRecovered={handleRecovered}
      />
    </>
  );

  if (view === 'signin') {
    return (
      <>
        <WaysToSignInPage
          state={methodsState}
          pinIsSet={pinIsSet}
          onChangePin={() => setRecoveryPinOpen(true)}
          onRecoveryCode={() => setEnterCodeOpen(true)}
          onBack={() => setView('root')}
        />
        {pinSheets}
      </>
    );
  }

  if (view === 'gift-cards') {
    return <GiftCardsPage state={credit} onBack={() => setView('root')} />;
  }

  if (view === 'give-gift') {
    return <GiveGiftPage clubName={group?.name ?? null} onBack={() => setView('root')} />;
  }

  if (view === 'name') {
    return <NicknamePage currentName={identity.name} clubName={group?.name ?? null} onBack={() => setView('profile')} />;
  }

  if (view === 'profile') {
    return (
      <>
        <EditProfilePage
          name={identity.name}
          clubName={group?.name ?? null}
          rank={rank}
          isAdmin={isAdmin}
          avatar={avatar}
          memberCreatedAt={memberCreatedAt}
          onAvatarSaved={setAvatar}
          onEditName={() => setView('name')}
          onDeleteAccount={() => setDeleteAccountOpen(true)}
          onBack={() => setView('root')}
        />
        <DeleteAccountSheet
          open={deleteAccountOpen}
          onClose={() => setDeleteAccountOpen(false)}
          onDeleted={() => {
            // The sheet already cleared identity and the server cleared the
            // cookies; this is the local mirror, same as handleLogout's.
            setLocalIdentity(null);
            setPinIsSet(null);
            setView('root');
          }}
        />
      </>
    );
  }

  // This device: every row here can be absent (push still probing, already
  // installed, no migration), so the group hides rather than titling nothing.
  const appRows: SettingsRow[] = [
    /* Present from the first frame, with NO status until the probe answers:
       rendering "Off" before we know would be a confirmed negative from an
       unknown state (CLAUDE.md, "Unknown ≠ known-false"), and hiding the row
       instead inserted it later, pushing the rows below it down (loading
       cascade follow-up). The row is shown for every answer, so it never
       needed hiding — only its status did. */
    ...([{
          icon: 'notifications',
          label: tSettings('notifications'),
          meta:
            !push || push.state.status === 'loading'
              ? undefined
              : push.state.status === 'on'
              ? tPush('metaOn')
              : push.state.status === 'denied'
                ? tPush('metaBlocked')
                : push.state.status === 'unsupported'
                  ? undefined
                  : tPush('metaOff'),
          onClick: () => onOpenNotifications?.(),
        }]),
    ...(!installed
      ? [{ icon: 'install_mobile', label: tSettings('install'), onClick: () => setInstallOpen(true) }]
      : []),
    // Web only: the native shell IS the destination.
    ...(migrateOn && !isNative()
      ? [{ icon: 'install_mobile', label: t('migrate.row'), onClick: () => setMigrateOpen(true) }]
      : []),
  ];

  // Player (and possibly admin) state
  return (
    // Keyed per branch: the loading, signed-out and signed-in roots sit in the
    // same position, so without a key React reuses the node and the fade
    // never replays — the skeleton was simply swapped for the page in a frame.
    <div key="profile-member" className="motion-fade flex flex-col gap-4">
      <PageHeader>{tNav('profile')}</PageHeader>

      <ProfileIdentityCard
        name={identity.name}
        clubName={group?.name ?? null}
        isAdmin={isAdmin}
        rank={rank}
        avatar={avatar}
        onOpen={() => setView('profile')}
      />


      {/* Always present for a SIGNED-IN member: the upgrade nudge is a variant
          of this card, not a separate surface, so dismissing the prompt does not
          take the credential management with it.

          It lived in the anonymous branch until now, which meant the people it
          exists for never saw it while signed-out visitors got it duplicated
          beneath the provider buttons. Nothing caught that: the card's own tests
          render it directly, and ProfileTab's tests render both states without
          asserting on it. They do now. */}
      {/* Credential management, so it belongs to ACCOUNT rather than floating
          between the identity card and admin. */}
      {showAdminRow && (
        <>
          <ProfileEyebrow>{t('admin.group')}</ProfileEyebrow>
          {/* One row, not a hero. The console had the only glowing border, the
              largest type in any card and a full-width CTA — on the screen a
              player opens to change their PIN. The count survives here; the
              three stat tiles live on admin home, where they can be acted on.

              No count when it is unknown: "0 need you" off a dead fetch is the
              lying-empty-state pattern, and the row's real job — opening
              admin — works regardless. A FAILED check says so, muted, rather
              than leaving the row looking like one that never had a count;
              still loading shows nothing. */}
          <SettingsList
            rows={[
              {
                icon: 'admin_panel_settings',
                label: t('admin.console'),
                meta: adminSignals.loadError
                  ? t('admin.checkFailed')
                  : adminSignals.needsYou === null
                    ? undefined
                    : adminSignals.needsYou > 0
                    ? t('admin.needYou', { count: adminSignals.needsYou })
                    : t('admin.allClear'),
                // Accent marks the one live count, never the all-clear.
                accent: (adminSignals.needsYou ?? 0) > 0,
                onClick: onAdminTools,
              },
            ]}
          />
        </>
      )}

      <ProfileEyebrow>{tSettings('title')}</ProfileEyebrow>
      <SettingsList
        rows={[
          // "Your groups" leads the list when there is more than one club to be
          // in: it changes what every other screen is about, so it outranks the
          // per-account rows below it. Absent entirely with the flag off, and
          // absent when signed out — `group` is null in both cases.
          ...(group
            ? [{
                icon: 'groups',
                label: tGroups('yourGroups'),
                meta: group.name,
                onClick: () => setView('groups'),
              }]
            : []),
          // One row for getting back in (spec §9, build step 3). It used to be
          // three — How you sign in, Update PIN, Have a recovery code? — and
          // the page it opens holds all of it. The nudge survives as `accent`,
          // the same signal the admin row uses for a live count.
          {
            icon: 'lock',
            label: tAuth('methodsTitle'),
            meta: methodsSummary(methodsState.methods, {
              pin: tAuth('methodPin'),
              email: tAuth('methodEmailShort'),
            }),
            accent: methodsState.methods?.nudge === true,
            onClick: () => setView('signin'),
          },
        ]}
      />

      {/* MONEY (spec §1.5, build step 4): pages, not the two sheets they
          replace. The credit figure is absent until it is KNOWN — never a $0
          off a failed read. Account balance joins this group in step 5. */}
      {creditOn && (
        <>
          <ProfileEyebrow>{tSettings('moneyGroup')}</ProfileEyebrow>
          <SettingsList
            rows={[
              {
                icon: 'payments',
                label: tSettings('giftCards'),
                meta: credit.loadError || credit.balanceCents === null ? undefined : fmtCents(credit.balanceCents),
                onClick: () => setView('gift-cards'),
              },
              // Only for a member an organiser marked `canGift`; the page is the
              // gifter's half of the organiser's gift-card console.
              ...(canGift ? [{ icon: 'volunteer_activism', label: tSettings('giveGift'), onClick: () => setView('give-gift') }] : []),
            ]}
          />
        </>
      )}

      {/* Four groups, each one question: who am I here (ACCOUNT, above), what
          do others see (PRIVACY), how does this device behave (APP), and where
          do I get help (HELP). "App" used to hold all six — a privacy screen
          beside a changelog beside the privacy policy (Grant, 2026-09-14:
          "reorg the items into logical group"). */}
      <ProfileEyebrow>{tSettings('privacyGroup')}</ProfileEyebrow>
      <SettingsList
        rows={[
          // `meta` shows the state so nobody has to open the row to check it.
          {
            icon: 'visibility',
            label: tSettings('statsPrivacy'),
            meta: privacyState.privacy
              ? privacyState.privacy.clubComparison
                ? tSettings('statsPrivacyOn')
                : tSettings('statsPrivacyOff')
              : undefined,
            onClick: () => setView('stats-privacy'),
          },
          // A full navigation, not a sheet: the policy is a public server-
          // rendered page (also the URL in both store listings), and Apple
          // 5.1.1(i) wants it reachable from inside the app.
          { icon: 'shield', label: tSettings('privacyPolicy'), onClick: () => window.location.assign(`${BASE}/legal/privacy`) },
        ]}
      />

      {appRows.length > 0 && (
        <>
          <ProfileEyebrow>{tSettings('appGroup')}</ProfileEyebrow>
          <SettingsList rows={appRows} />
        </>
      )}

      <ProfileEyebrow>{tSettings('helpGroup')}</ProfileEyebrow>
      <SettingsList
        rows={[
          { icon: 'campaign', label: tSettings('releaseNotes'), onClick: () => setReleaseSheetOpen(true) },
          { icon: 'flag', label: tSettings('reportProblem'), onClick: () => setReportOpen(true) },
        ]}
      />

      {/* Log out stops pretending to navigate. It had a chevron like the rows
          above it and it was amber, which in this system means full or warning.
          Separated below the list, centred, no chevron, no card. */}
      <button
        type="button"
        onClick={handleLogout}
        style={{
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          padding: 'var(--space-4)',
          fontSize: 'var(--fs-lg)',
          color: 'var(--color-red)',
          fontFamily: 'inherit',
        }}
      >
        {tSettings('logout')}
      </button>


      {/* Which build this phone is running: the deploy's commit, the same id
          the page carries in its `bpm-build` meta tag. A member can read it
          off when something looks old, and "what does yours say?" answers
          whether a fix has reached them. Quiet, last, and not a control. */}
      <p className="fs-xs text-center" style={{ margin: 0, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
        {tSettings('version', { sha: buildSha })}
      </p>

      {migrateOn && !isNative() && <MigrateSheet open={migrateOpen} onClose={() => setMigrateOpen(false)} />}



      {pinSheets}

      <ReleaseNotesSheet
        open={releaseSheetOpen}
        releases={releases}
        onClose={() => setReleaseSheetOpen(false)}
      />

      <ReportProblemSheet
        open={reportOpen}
        onClose={() => setReportOpen(false)}
        name={identity?.name}
      />

      <InstallSheet open={installOpen} onClose={() => setInstallOpen(false)} />
    </div>
  );
}

/* ── Identity card (avatar + name + member-since + this club's rank) ── */

/** This club's rank (docs/plans/roles-v2.md): organiser, admin or player. */
export type ProfileRank = 'owner' | 'admin' | 'member';

/** Read `GET /api/members/me`'s `rank`; anything else is unknown. */
export function readRank(value: unknown): ProfileRank | null {
  return value === 'owner' || value === 'admin' || value === 'member' ? value : null;
}

/**
 * The one chip the card shows: Organiser or Admin; a Player has none. The
 * shell's admin verdict holds the place while the rank is unknown, so an
 * admin is never shown as nobody. Job badges (Stringer, Gifter) are not
 * shown here, by decision (Grant, 2026-11-04).
 */
export function profileChip(rank: ProfileRank | null, isAdmin: boolean): 'rankOwner' | 'rankAdmin' | null {
  if (rank === 'owner') return 'rankOwner';
  if (rank === 'admin' || (rank === null && isAdmin)) return 'rankAdmin';
  return null;
}

interface ProfileIdentityCardProps {
  name: string;
  clubName: string | null;
  isAdmin: boolean;
  rank: ProfileRank | null;
  avatar: MemberAvatarValue | null;
  onOpen: () => void;
}

/**
 * The person, at the top of Profile: one button into Edit profile
 * (docs/superpowers/specs/2026-11-09-profile-reorg-design.md §1). The whole
 * card is the target and a chevron says so, as Cal AI and theScore do; the
 * picture is changed on that page now, beside the name, not from a sheet off
 * the avatar. "Member since" moved there too.
 */
function ProfileIdentityCard({ name, clubName, isAdmin, rank, avatar, onOpen }: ProfileIdentityCardProps) {
  const tIdentity = useTranslations('profile.identity');
  const tEdit = useTranslations('profile.editProfile');
  const chip = profileChip(rank, isAdmin);
  const subtitle = clubName ? `${clubName} · ${tEdit('open')}` : tEdit('open');
  const label = chip ? `${name}, ${tIdentity(chip)}, ${tEdit('open')}` : tEdit('openLabel', { name });

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={label}
      className="glass-card profile-card-button"
      style={{
        padding: 'var(--space-5)',
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-4)',
      }}
    >
      {/* Neutral rather than per-name colour: here there is only ever one
          person, so the colour that tells players apart has no job. */}
      <MemberAvatar name={name} avatar={avatar} size={52} tone="neutral" />
      <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-05)' }}>
        {/* The name and this club's rank share ONE line, the chip small and
            centred on it (Grant, 2026-11-04). The name gives way first. */}
        <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', minWidth: 0 }}>
          <span
            style={{
              fontFamily: 'var(--font-display, "Space Grotesk")',
              fontSize: 'var(--fs-stat)',
              fontWeight: 600,
              letterSpacing: '-0.015em',
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {name}
          </span>
          {chip && (
            // A --fs-2xs pill pads 4/8 (StatusBadge's spec). A label, not a control.
            <span
              style={{
                flex: '0 0 auto',
                whiteSpace: 'nowrap',
                background: 'rgba(var(--glass-tint), 0.09)',
                color: 'var(--text-secondary)',
                padding: 'var(--space-1) var(--space-3)',
                borderRadius: 'var(--radius-pill)',
                fontSize: 'var(--fs-2xs)',
                lineHeight: 'var(--lh-tight)',
              }}
            >
              {tIdentity(chip)}
            </span>
          )}
        </span>
        <span
          style={{
            fontSize: 'var(--fs-base)',
            color: 'var(--text-secondary)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {subtitle}
        </span>
      </span>
      <span className="material-icons" aria-hidden="true" style={{ fontSize: 'var(--icon-md)', color: 'var(--text-secondary)' }}>
        chevron_right
      </span>
    </button>
  );
}

/* Section eyebrow — uppercase label that sits OUTSIDE a card,
   above the content it labels. Matches the design's 'ADMIN' /
   'ACCOUNT' pattern. */
// ProfileEyebrow now lives in components/primitives/ProfileEyebrow.tsx — the
// Stats & privacy sub-screen needs it, and importing it back from here would
// be a circular import since this file renders that screen.
