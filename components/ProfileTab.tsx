'use client';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { getIdentity, clearIdentity, IDENTITY_EVENT, type Identity } from '@/lib/identity';
import type { Release } from '@/lib/types';
import EnterCodeSheet from './EnterCodeSheet';
import CreateAccountSheet from './CreateAccountSheet';
import DeleteAccountSheet from '@/components/auth/DeleteAccountSheet';
import RecoveryPinSheet from './RecoveryPinSheet';
import ReleaseNotesSheet from './ReleaseNotesSheet';
import ReportProblemSheet from './ReportProblemSheet';
import InstallSheet from './InstallSheet';
import SignInForm from './SignInForm';
import ProviderButtons, { type Provider as AuthProvider } from './auth/ProviderButtons';
import SignInMethodsSheet from './auth/SignInMethodsSheet';
import { useSignInMethods, methodsSummary } from './auth/useSignInMethods';
import EmailSignInForm from './auth/EmailSignInForm';
import EmailSignUpSheet from './auth/EmailSignUpSheet';
import ForgotPasswordSheet from './auth/ForgotPasswordSheet';
import PushSheet from './PushSheet';
import { usePush } from '@/lib/usePush';
import { isStandalone } from '@/lib/standalone';
import PageHeader from './primitives/PageHeader';
import ProfileEyebrow from './primitives/ProfileEyebrow';
import StatsPrivacyScreen from './StatsPrivacyScreen';
import { useStatsPrivacy } from '@/lib/useStatsPrivacy';
import { isFlagOn } from '@/lib/flags';
import { useAdminNeedsYou } from '@/lib/useAdminNeedsYou';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

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
}

export default function ProfileTab({
  sessionId,
  isAdmin,
  onAdminTools,
  authProviders = [],
}: Props) {
  const t = useTranslations('profile');
  const [identity, setLocalIdentity] = useState<Identity | null>(null);
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
  const [memberCreatedAt, setMemberCreatedAt] = useState<string | null>(null);
  const [isSignedUp, setIsSignedUp] = useState<boolean>(false);
  const [enterCodeOpen, setEnterCodeOpen] = useState(false);
  const [createAccountOpen, setCreateAccountOpen] = useState(false);
  const [deleteAccountOpen, setDeleteAccountOpen] = useState(false);
  // Signed-in state PIN management: tap the Settings "Recovery PIN" row to
  // open RecoveryPinSheet (set / change / remove + forgot-it handoff).
  const [recoveryPinOpen, setRecoveryPinOpen] = useState(false);
  const [releaseSheetOpen, setReleaseSheetOpen] = useState(false);
  // Stats & privacy is a full-screen SUB-VIEW, not a sheet — every other row
  // here opens a BottomSheet, so this is new structure for ProfileTab. The
  // pattern (view state + early return + slideInRight + TopBar) is borrowed
  // from AdminDashboard, which is the only place in the app that already does
  // sub-screens.
  const [view, setView] = useState<'root' | 'stats-privacy'>('root');
  const [methodsOpen, setMethodsOpen] = useState(false);
  // Read once here so the row's summary and the sheet's body agree.
  //
  // Gated on `identity` as well as the flag: the row only exists for a
  // signed-in member, and the anonymous card must not probe at all -- the
  // server has already resolved availability by the time that card renders,
  // and a probe would reflow it. Same shape as `useStatsPrivacy` above, which
  // takes null when there is nobody to read for.
  const methodsState = useSignInMethods(!!identity && isFlagOn('NEXT_PUBLIC_FLAG_AUTH_PROVIDERS'));
  const privacyState = useStatsPrivacy(identity?.name ?? null);
  // Called unconditionally, and gated by its own argument, because the two
  // early returns below (anonymous, and the Stats & privacy sub-screen) sit
  // between here and the row that renders the count.
  const showAdminRow = isAdmin && isFlagOn('NEXT_PUBLIC_FLAG_COMMAND_CENTER');
  const adminSignals = useAdminNeedsYou(showAdminRow);
  const [reportOpen, setReportOpen] = useState(false);
  const [installOpen, setInstallOpen] = useState(false);
  const [pushOpen, setPushOpen] = useState(false);
  // Only offer "Add to Home Screen" when NOT already installed. Resolved
  // post-mount (display-mode/navigator.standalone are client-only); defaults
  // to false so the row shows in the browser, which is exactly when it helps.
  const [installed, setInstalled] = useState(false);
  const [releases, setReleases] = useState<Release[] | null>([]);
  const tSettings = useTranslations('profile.settings');
  const tAuth = useTranslations('profile.auth');
  const tNav = useTranslations('nav');
  const tPush = useTranslations('profile.push');
  const tDelete = useTranslations('profile.deleteAccount');
  // Owned here (not in PushSheet) so the row's On/Off label and the sheet's
  // button share one state and can't disagree after a toggle.
  const push = usePush();
  const pushEnabled = isFlagOn('NEXT_PUBLIC_FLAG_PUSH_NOTIFY');

  useEffect(() => {
    setInstalled(isStandalone());
  }, []);

  useEffect(() => {
    const id = getIdentity();
    setLocalIdentity(id);
    fetch(`${BASE}/api/releases`, { cache: 'no-store' })
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
    // PIN status — its OWN chain so a players-fetch failure can never reset it.
    // Previously these were chained (members/me -> players) under one catch, so
    // a transient players rejection wiped a perfectly good pinIsSet=true,
    // mislabeling the PIN row (audit silent-failure cluster).
    fetch(`${BASE}/api/members/me?name=${encodeURIComponent(identity.name)}`, { cache: 'no-store' })
      .then(async (r) => {
        if (!r.ok) throw new Error(`hasPin fetch ${r.status}`);
        return r.json();
      })
      .then((data: { hasPin?: boolean; createdAt?: string | null; authed?: boolean }) => {
        if (cancelled) return;
        setPinIsSet(data.hasPin === true);
        setMemberCreatedAt(typeof data.createdAt === 'string' ? data.createdAt : null);
        // `authed` gates first-PIN set in RecoveryPinSheet; unknown stays null.
        setPinAuthed(typeof data.authed === 'boolean' ? data.authed : null);
      })
      .catch((err) => {
        if (cancelled) return;
        // Keep status unknown rather than asserting "Not set". The audit
        // (H4) found this default-to-false flip was pushing users into
        // recreate-account loops on transient backend failures.
        console.warn('hasPin fetch failed:', err);
        setPinIsSet(null);
        setPinAuthed(null);
      });

    // Signed-up status — independent chain; its failure must NOT touch pinIsSet.
    fetch(`${BASE}/api/players`, { cache: 'no-store' })
      .then(async (r) => {
        if (!r.ok) return null;
        return r.json() as Promise<Array<{ name?: string; removed?: boolean; waitlisted?: boolean }>>;
      })
      .then((players) => {
        if (cancelled || !Array.isArray(players)) return;
        const here = players.find(
          (p) => !p.removed && !p.waitlisted && typeof p.name === 'string' && p.name.toLowerCase() === identity.name.toLowerCase(),
        );
        setIsSignedUp(!!here);
      })
      .catch((err) => {
        if (cancelled) return;
        // Signed-up status stays unknown; never touch pinIsSet from here.
        console.warn('signed-up fetch failed:', err);
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
  const authProvidersOn = isFlagOn('NEXT_PUBLIC_FLAG_AUTH_PROVIDERS');

  if (!identity) {
    // Availability is server-resolved, so this is settled on the first paint
    // rather than arriving later and reflowing the card.
    const providersLead = authProvidersOn && authProviders.length > 0;
    const emailMode = authProvidersOn && credMode === 'email';
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
          onClick={() => (emailMode ? setForgotPasswordOpen(true) : setEnterCodeOpen(true))}
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
      </div>
    );
    const switchCredentialLink = authProvidersOn ? (
      <button
        type="button"
        onClick={() => setCredMode((m) => (m === 'pin' ? 'email' : 'pin'))}
        className="link-quiet"
      >
        {credMode === 'pin' ? t('auth.useEmailInstead') : t('auth.usePinInstead')}
      </button>
    ) : null;
    return (
      <div className="animate-fadeIn flex flex-col gap-4">
        <PageHeader>{t('anonymousTitle')}</PageHeader>
        <p style={{ color: 'var(--text-secondary)' }}>{t('anonymousBody')}</p>
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
              onSuccess={handleSignInSuccess}
              onForgotPin={providersLead ? undefined : () => setEnterCodeOpen(true)}
            />
          )}
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
        <EnterCodeSheet
          open={enterCodeOpen}
          onClose={() => setEnterCodeOpen(false)}
          sessionId={sessionId}
          onRecovered={handleRecovered}
        />
        <EmailSignUpSheet
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
  if (view === 'stats-privacy') {
    return <StatsPrivacyScreen onBack={() => setView('root')} state={privacyState} />;
  }

  // Player (and possibly admin) state
  return (
    <div className="animate-fadeIn flex flex-col gap-4">
      <PageHeader>{tNav('profile')}</PageHeader>

      <ProfileIdentityCard
        name={identity.name}
        memberCreatedAt={memberCreatedAt}
        isSignedUp={isSignedUp}
        isAdmin={isAdmin}
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

              No meta at all when the count is unknown: "0 need you" off a dead
              fetch is the lying-empty-state pattern, and the row's real job —
              opening admin — works regardless. */}
          <SettingsList
            rows={[
              {
                icon: 'admin_panel_settings',
                label: t('admin.console'),
                meta:
                  adminSignals.needsYou === null
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
          // Was a permanently-expanded card above this list — its own heading,
          // a checklist, a bordered provider button and a "Not now", wedged
          // between two one-line rows. It is a row now. The nudge survives as
          // `accent`, the same signal the admin row uses for a live count.
          ...(isFlagOn('NEXT_PUBLIC_FLAG_AUTH_PROVIDERS')
            ? [{
                icon: 'lock',
                label: tAuth('methodsTitle'),
                meta: methodsSummary(methodsState.methods, {
                  pin: tAuth('methodPin'),
                  email: tAuth('methodEmailShort'),
                }),
                accent: methodsState.methods?.nudge === true,
                onClick: () => setMethodsOpen(true),
              }]
            : []),
          // Batch B (expanded): PIN management is now member-scoped via
          // PATCH /api/members/me — works regardless of whether the user
          // has a session player. The previous "Sign up for a session
          // first" gate is no longer needed.
          {
            icon: 'key',
            // pinIsSet === null means we couldn't load status. Show the
            // generic section title rather than asserting "New PIN" (which
            // would suggest "you don't have one yet" — false on transient
            // backend failures).
            label: pinIsSet === null
              ? t('pinSectionTitle')
              : pinIsSet
              ? tSettings('updatePin')
              : tSettings('newPin'),
            onClick: () => setRecoveryPinOpen(true),
          },
          {
            icon: 'help_outline',
            label: tSettings('recoveryCode'),
            onClick: () => setEnterCodeOpen(true),
          },
        ]}
      />

      {/* Security, app and help were interleaved — a recovery code sat next to
          What's new next to Add to Home Screen. Splitting them is what lets
          ACCOUNT stay two rows. */}
      <ProfileEyebrow>{tSettings('appGroup')}</ProfileEyebrow>
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
          /* Hidden while the probe is unresolved: rendering "Off" before we
             know would be a confirmed negative from an unknown state
             (CLAUDE.md, "Unknown ≠ known-false"). */
          ...(pushEnabled && push.state.status !== 'loading'
            ? [{
                icon: 'notifications',
                label: tSettings('notifications'),
                meta:
                  push.state.status === 'on'
                    ? tPush('metaOn')
                    : push.state.status === 'denied'
                      ? tPush('metaBlocked')
                      : push.state.status === 'unsupported'
                        ? undefined
                        : tPush('metaOff'),
                onClick: () => setPushOpen(true),
              }]
            : []),
          ...(!installed
            ? [{ icon: 'install_mobile', label: tSettings('install'), onClick: () => setInstallOpen(true) }]
            : []),
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

      {/* Below log out, quiet, and NOT red. Two red controls stacked would make
          the rarer, heavier one compete with the everyday one, and accent is
          currency — a permanently loud row you scroll past every visit spends
          it on something you do at most once. The danger belongs inside the
          sheet, on the button that actually does it. Still a real, findable
          control: App Store 5.1.1(v) requires account deletion to be reachable
          from inside the app, and a reviewer has to be able to find it. */}
      <button
        type="button"
        onClick={() => setDeleteAccountOpen(true)}
        style={{
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          padding: 'var(--space-3)',
          fontSize: 'var(--fs-sm)',
          color: 'var(--text-muted)',
          fontFamily: 'inherit',
        }}
      >
        {tDelete('link')}
      </button>

      <DeleteAccountSheet
        open={deleteAccountOpen}
        onClose={() => setDeleteAccountOpen(false)}
        onDeleted={() => {
          // The sheet already cleared identity and the server cleared the
          // cookies; this is the local mirror, same as handleLogout's.
          setLocalIdentity(null);
          setPinIsSet(null);
        }}
      />

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

      <SignInMethodsSheet
        open={methodsOpen}
        onClose={() => setMethodsOpen(false)}
        state={methodsState}
      />
      <InstallSheet open={installOpen} onClose={() => setInstallOpen(false)} />
      <PushSheet
        open={pushOpen}
        onClose={() => setPushOpen(false)}
        onOpenInstall={() => {
          setPushOpen(false);
          setInstallOpen(true);
        }}
        push={push}
      />
      <PushSheet
        open={pushOpen}
        onClose={() => setPushOpen(false)}
        onOpenInstall={() => {
          setPushOpen(false);
          setInstallOpen(true);
        }}
        push={push}
      />
    </div>
  );
}

interface SettingsRow {
  icon: string;
  label: string;
  onClick: () => void;
  /** Right-aligned status text shown before the chevron (e.g. "Set" / "Not set"). */
  meta?: string;
  /**
   * Tint the icon and meta green. Reserved for a live count that is asking to
   * be acted on — accent is currency here, the same rule Home follows. The
   * `destructive` variant this replaces went with Log out when it left the
   * list to become a standalone centred button.
   */
  accent?: boolean;
}

function SettingsList({ rows }: { rows: SettingsRow[] }) {
  return (
    <div className="glass-card-soft" style={{ padding: '0', overflow: 'hidden' }}>
      <ul style={{ listStyle: 'none', margin: '0', padding: '0' }}>
        {rows.map((row, idx) => (
          <li key={row.label} style={{ borderTop: idx === 0 ? 'none' : '1px solid var(--divider)' }}>
            <button
              type="button"
              onClick={row.onClick}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-4)',
                padding: 'var(--space-4) var(--space-5)',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                color: 'var(--text-primary)',
                fontSize: 'var(--fs-lg)',
                textAlign: 'left',
              }}
            >
              <span
                className="material-icons"
                aria-hidden="true"
                style={{
                  fontSize: 'var(--fs-stat)',
                  color: row.accent ? 'var(--accent)' : 'var(--text-secondary)',
                }}
              >
                {row.icon}
              </span>
              <span style={{ flex: 1 }}>{row.label}</span>
              {row.meta && (
                <span
                  style={{
                    fontSize: 'var(--fs-base)',
                    color: row.accent ? 'var(--accent)' : 'var(--text-secondary)',
                  }}
                >
                  {row.meta}
                </span>
              )}
              <span
                className="material-icons"
                aria-hidden="true"
                style={{ fontSize: 18, color: 'var(--text-secondary)' }}
              >
                chevron_right
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ── Identity card (avatar + name + member-since + In/Admin pills) ── */

function fmtMemberSince(iso: string | null): string | null {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
  } catch {
    return null;
  }
}

interface ProfileIdentityCardProps {
  name: string;
  memberCreatedAt: string | null;
  isSignedUp: boolean;
  isAdmin: boolean;
}

function ProfileIdentityCard({ name, memberCreatedAt, isSignedUp, isAdmin }: ProfileIdentityCardProps) {
  const memberSince = fmtMemberSince(memberCreatedAt);

  return (
    <div
      className="glass-card-soft"
      style={{
        padding: 'var(--space-5)',
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-4)',
      }}
    >
      {/* The "NAME" eyebrow that sat above this is gone: a 46px avatar and the
          name in display type already say it, and it created a false parallel
          with ADMIN and ACCOUNT, which are real groupings.

          Neutral rather than per-name colour. `avatarColors` gives Profile a
          violet circle, which — with the old violet ADMIN pill — was a fourth
          brand colour on a page whose palette is meant to be green for status
          and red for log out. Other surfaces keep the coloured avatar: there
          it distinguishes one player from another, which is the job it was
          built for. Here there is only ever one person. */}
      <span
        aria-hidden="true"
        style={{
          width: 46,
          height: 46,
          borderRadius: '50%',
          background: 'rgba(var(--glass-tint), 0.10)',
          color: 'var(--text-primary)',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'var(--font-display, "Space Grotesk")',
          fontWeight: 600,
          fontSize: 'var(--fs-stat)',
          flexShrink: 0,
          border: '1px solid rgba(var(--glass-tint), 0.10)',
        }}
      >
        {name.slice(0, 1).toUpperCase()}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* Semibold at --fs-stat, down from bold at --fs-stat-lg. The name is a
            fact about you, not the page's headline — and it no longer has to
            out-shout a dollar amount set at the same size beside it. */}
        <p
          style={{
            fontFamily: 'var(--font-display, "Space Grotesk")',
            fontSize: 'var(--fs-stat)',
            fontWeight: 600,
            letterSpacing: '-0.015em',
            margin: '0',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {name}
        </p>
        {memberSince && (
          <p style={{ fontSize: 'var(--fs-base)', color: 'var(--text-secondary)', marginTop: 'var(--space-05)' }}>
            Member since {memberSince}
          </p>
        )}
      </div>
      {/* Side by side, not stacked: two badges in a column read as a status
          column with a hierarchy between them. They are peers. */}
      <div style={{ display: 'inline-flex', gap: 'var(--space-2)', alignItems: 'center', flexShrink: 0 }}>
        {isSignedUp && (
          <span className="pill-paid" style={{ whiteSpace: 'nowrap' }}>
            In
          </span>
        )}
        {isAdmin && (
          <span
            style={{
              whiteSpace: 'nowrap',
              background: 'rgba(var(--glass-tint), 0.09)',
              color: 'var(--text-secondary)',
              padding: 'var(--space-2) var(--space-4)',
              borderRadius: 'var(--radius-pill)',
              fontSize: 'var(--fs-sm)',
            }}
          >
            Admin
          </span>
        )}
      </div>
    </div>
  );
}

/* Section eyebrow — uppercase label that sits OUTSIDE a card,
   above the content it labels. Matches the design's 'ADMIN' /
   'ACCOUNT' pattern. */
// ProfileEyebrow now lives in components/primitives/ProfileEyebrow.tsx — the
// Stats & privacy sub-screen needs it, and importing it back from here would
// be a circular import since this file renders that screen.
