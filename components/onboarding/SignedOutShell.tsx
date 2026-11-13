'use client';

import { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import LaunchArt from '@/components/launch/LaunchArt';
import { usePaneMode } from '@/lib/paneMode';
import { buttonDelayMs } from '@/lib/launchMotion';
import TopBar from '@/components/primitives/TopBar';
import TopToast from '@/components/primitives/TopToast';
import CardSkeleton from '@/components/primitives/CardSkeleton';
import ThemeToggle from '@/components/ThemeToggle';
import LanguageToggle from '@/components/LanguageToggle';
import NativeBridge from '@/components/NativeBridge';
import SignInForm from '@/components/SignInForm';
import AskAccessForm, { type AskApproved } from '@/components/auth/AskAccessForm';
import KeepAccountPage from '@/components/auth/KeepAccountPage';
import ProviderButtons, { type Provider } from '@/components/auth/ProviderButtons';
import EmailCodeSignInForm from '@/components/auth/EmailCodeSignInForm';
import EmailSignUpForm from '@/components/auth/EmailSignUpForm';
import ForgotPasswordSheet from '@/components/auth/ForgotPasswordSheet';
import ChooseNameSheet from '@/components/auth/ChooseNameSheet';
import DoorJoinPage from '@/components/onboarding/DoorJoinPage';
import WaitingAsks, { type Ask } from '@/components/onboarding/WaitingAsks';
import HandoffCodeSheet from '@/components/auth/HandoffCodeSheet';
import ResetPasswordSheet from '@/components/auth/ResetPasswordSheet';
import { clearIdentity, getIdentity, setIdentity, IDENTITY_EVENT } from '@/lib/identity';
import { parseInviteInput } from '@/lib/parseInviteInput';
import { hardReload } from '@/lib/reload';
import type { GroupListEntry } from '@/lib/useCurrentGroup';
import { noticeBanner, noticeTimeoutMs, type AuthNotice } from '@/lib/authNotice';
import { nativeReturnHref, pendingHandoffId, readReturnCodeFromHash } from '@/lib/handoffClient';
import { useHandoffCollect } from '@/lib/useHandoffCollect';
import {
  markOnboardingResume,
  consumeOnboardingResume,
  pruneStaleOnboardingResume,
  clearOnboardingResume,
} from '@/lib/onboardingResume';
import { isFlagOn } from '@/lib/flags';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/** The one key this screen writes in sessionStorage. See `reloadIntoApp`. */
const RELOAD_MARK = 'badminton_signed_out_reload_at';
/** The ask card while the link's club is looked up: the door form, measured at
 *  430 wide on 2026-11-08 (name, email, the junk-mail line and the button). */
const ASK_CARD_HEIGHT = 284;

// The multi-group doors, split out exactly as HomeShell splits them: a
// stranger who never taps "Start your own club" never downloads them.
const CreateGroupPage = dynamic(() => import('./CreateGroupPage'), { ssr: false });
const JoinGroupPage = dynamic(() => import('./JoinGroupPage'), { ssr: false });
const GroupsPage = dynamic(() => import('@/components/profile/GroupsPage'), { ssr: false });

/** `create` and `join` are reachable only with multi-group on. */
type View = 'welcome' | 'login' | 'signup' | 'create' | 'join' | 'ask' | 'door';
type Invite = { token?: string; code?: string };

/**
 * A signed-in, active account with no club in the group its cookie claims —
 * `decidePage` in `lib/pageGate.ts`. `groups` is every other club they are in.
 */
export interface NoClub {
  memberName: string;
  groups: GroupListEntry[];
  /** Clubs this account asked to join through a link and is waiting on (docs/plans/one-way-in.md, step 4). */
  asks?: Ask[];
}

interface Props {
  /** Server-resolved, so the provider buttons are settled on first paint. */
  authProviders?: Provider[];
  /** Present → the no-club mode below, instead of Welcome. Ignored with groups off. */
  noClub?: NoClub;
}

/**
 * MEMBERS ONLY: what a visitor who is not signed in sees — and all they see
 * (docs/plans/members-only.md). Grant, 2026-09-13: "If user is not logged in,
 * no information about the group should be shown. Like a normal app. It's
 * asking them to sign up, sign in."
 *
 * `app/page.tsx` renders this INSTEAD of `HomeShell` when the server finds no
 * signed-in member, so no tab, no nav and no club fetch ever mounts behind it.
 * A client-side gate over HomeShell would not do: React runs a child's effects
 * before its parent's, so the tabs would fetch the roster before any gate
 * above them decided anything.
 *
 * THE SERVER DECIDES WHO IS SIGNED IN, SO SIGNING IN RELOADS. Every way in —
 * name and PIN, email, Google/Apple, a reset link, an approved access request,
 * the iOS handoff — ends in `setIdentity`, which fires IDENTITY_EVENT. This
 * screen answers that one event by reloading, and the server renders the app.
 * One listener instead of a success callback per form, and no second opinion
 * about "signed in" kept on the client to drift from the cookie.
 *
 * Three views, in the shape of a normal consumer app (Wealthsimple's, chosen by
 * Grant): a Welcome with Sign up and Log in, and a page for each.
 *
 * WITH MULTI-GROUP ON, TWO MORE DOORS (`docs/plans/multi-group.md`, 2026-10-07).
 * The store listing is a public sign on a locked door until a stranger can
 * make a club: Sign up takes only an invite, and the create flow lived in
 * HomeShell, which never mounts for anyone the server refused. So:
 *
 *   - A stranger's Sign up page offers "No invite? Start your own club" (a
 *     link, by Grant's choice — Welcome keeps its two buttons). That opens
 *     `CreateGroupPage` on its ACCOUNT step. The account it makes is on no
 *     roster, and this screen's rule still holds: signing in reloads. The
 *     onboarding resume is what survives the reload — `onSignedIn` marks it
 *     and the page is told not to clear it.
 *   - The server then renders this shell in `noClub` mode (`decidePage`): a
 *     signed-in, active member in no club. A brand-new organiser gets three
 *     doors — Create a club, Join with a link or code, Sign out — and a `create`
 *     resume skips the doors and lands on the FORM. A member removed from the
 *     club their cookie names, who belongs to others, gets those as a LIST to
 *     pick from (Grant's choice over an automatic switch), plus the doors.
 *
 * In `noClub` mode there is no reload-on-identity listener. The account exists
 * (the server said so), and `POST /api/groups` writes an identity BEFORE the
 * invite-share step — a reload there would eat the one screen an organiser
 * needs. Every reload in that mode is explicit: Done, Joined, Switched, Sign
 * out. Club reads still refuse this person; the mode is doors and nothing else.
 */
export default function SignedOutShell({ authProviders = [], noClub: noClubProp }: Props) {
  const tAuth = useTranslations('profile.auth');
  const groupsOn = isFlagOn('NEXT_PUBLIC_FLAG_MULTI_GROUP');
  // A no-club member cannot exist with groups off (every active member is in
  // BPM), so the prop is ignored rather than rendering a mode nothing can reach.
  const noClub = groupsOn ? (noClubProp ?? null) : null;
  const [view, setView] = useState<View>('welcome');
  const pane = usePaneMode();
  const tCover = useTranslations('signedOut');
  const [notice, setNotice] = useState<AuthNotice | null>(null);
  const [nativeReturn, setNativeReturn] = useState(false);
  /** The native return code from the landing's `#hc=`, or from the name step. */
  const [returnCode, setReturnCode] = useState<string | null>(null);
  const [resetRequest, setResetRequest] = useState<{ token: string; email: string } | null>(null);
  const [chooseName, setChooseName] = useState<{ open: boolean; invite: Invite; noGroup: boolean }>({
    open: false,
    invite: {},
    noGroup: false,
  });
  const [initialInvite, setInitialInvite] = useState<Invite | null>(null);
  /** A club's claim link from `?claim=` (docs/plans/claim-your-name.md). */
  const [claimToken, setClaimToken] = useState<string | null>(null);
  /** A club's link, signed out: sign in first, then ask (docs/plans/one-way-in.md, step 4). */
  const [doorToken, setDoorToken] = useState<string | null>(null);
  const consumed = useRef(false);
  /** The view as the identity listener sees it — it must not re-subscribe per view. */
  const viewRef = useRef<View>('welcome');
  useEffect(() => {
    viewRef.current = view;
  }, [view]);

  // ── Signing in anywhere reloads into the app ─────────────────────────────
  //
  // Two exceptions, both multi-group: the create page's account step hands
  // over through `onSignedIn` (which marks the resume, then reloads), and the
  // no-club mode reloads explicitly — see the header.
  const noClubMode = noClub !== null;
  useEffect(() => {
    if (noClubMode) return;
    const onChange = () => {
      if (!getIdentity()) return;
      if (viewRef.current === 'create') return;
      reloadIntoApp();
    };
    window.addEventListener(IDENTITY_EVENT, onChange);
    return () => window.removeEventListener(IDENTITY_EVENT, onChange);
  }, [noClubMode]);

  // The installed-PWA Google return: a sign-in parked in Safari's cookie jar.
  const handoffCollect = useHandoffCollect((name) => setIdentity({ name, sessionId: '' }));

  // ── What a sign-in landing brought back in the URL ───────────────────────
  //
  // The same parameters `HomeShell` reads, minus everything that needs a club:
  // no tabs to restore, nothing to join. `tab` and `intent` are deliberately
  // LEFT in the URL, so the reload after signing in carries them to HomeShell
  // (the legal page's delete-account link lands here signed out).
  /* eslint-disable react-hooks/set-state-in-effect --
     The twin of HomeShell's landing effect, exempt for HomeShell's reasons
     (see the comment on its URL-params effect): it consumes the landing URL
     and STRIPS live credentials (`reset`, `join`) in the same pass, and
     `consumeOnboardingResume()` is a destructive localStorage read that cannot
     run during render or SSR. */
  useEffect(() => {
    if (consumed.current) return;
    consumed.current = true;
    const params = new URLSearchParams(window.location.search);
    const cleaned = new URL(window.location.href);
    let dirty = false;
    const strip = (...keys: string[]) => {
      for (const k of keys) cleaned.searchParams.delete(k);
      dirty = true;
    };

    const landedFromAuth =
      params.get('authFlow') === 'name' || params.get('signedIn') === '1' || !!params.get('authError');
    // The resume is half of an AND (lib/onboardingResume.ts): it acts only on
    // the far side of a sign-in. In no-club mode the server's own verdict —
    // "a real account, in no club" — is that other half, so it is consumed
    // unconditionally there: the account step of "Start your own club" ended
    // in a reload, and this record is what brings them back to the form.
    const resume =
      landedFromAuth || pendingHandoffId() !== null || noClubMode
        ? consumeOnboardingResume()
        : (pruneStaleOnboardingResume(), null);

    if (params.get('authFlow') === 'name') {
      // A brand-new Google/Apple identity: collect a name. The invite rode the
      // excursion in localStorage — the callback URL carries none of ours.
      // A CREATE resume means "join me to nothing" — and it is re-marked,
      // because the read above was destructive and the reload after the name
      // step still needs it to land on the create form.
      const creating = resume?.intent === 'create';
      if (creating) markOnboardingResume('create');
      setChooseName({ open: true, invite: { token: resume?.token, code: resume?.code }, noGroup: creating });
      strip('authFlow');
    }
    if (params.get('signedIn') === '1') {
      // The server rendered THIS screen, so the cookie did not reach this jar.
      // An installed PWA collects it through the handoff; anything else is worth
      // saying out loud. Not in no-club mode: there the cookie DID arrive, and
      // the server read it — this screen is the answer, not a miss.
      if (pendingHandoffId() === null && !noClubMode) setNotice({ kind: 'signInUnconfirmed' });
      strip('signedIn', 'provider');
    }
    const failure = params.get('authError');
    if (failure) {
      setNotice({ kind: 'authError', reason: failure });
      strip('authError');
    }
    const verified = params.get('verified');
    if (verified === '1' || verified === '0') {
      setNotice({ kind: verified === '1' ? 'verified' : 'notVerified' });
      strip('verified');
    }
    // Live credentials in the URL: stripped for the reasons HomeShell gives.
    const reset = params.get('reset');
    if (reset) {
      setResetRequest({ token: reset, email: params.get('email') ?? '' });
      strip('reset', 'email');
    }
    // A club's claim link: someone the organiser put on the roster, asking to
    // be let in under their own name, or a new person asking to join. A live
    // credential, so stripped like `join`; it opens the club's ask PAGE. A
    // signed-in member in no club has an account already — nothing to claim.
    const claim = params.get('claim');
    if (claim) {
      // Signed out: sign in first, then ask (docs/plans/one-way-in.md,
      // step 4). Signed in with no club: the account asks from the join page.
      if (noClubMode) {
        setInitialInvite({ token: claim });
        setView('join');
      } else {
        setDoorToken(claim);
        setView('door');
      }
      strip('claim');
    }
    const join = params.get('join');
    if (join) {
      setInitialInvite({ token: join });
      // A stranger makes an account with the invite; a no-club member already
      // has one, so the link goes straight to the join page.
      setView(noClubMode ? 'join' : 'signup');
      strip('join');
    } else if (noClubMode && resume) {
      // Back from the account step (or the name step) of a door, on the far
      // side of the reload — straight to where they were going.
      if (resume.intent === 'create') setView('create');
      else if (resume.token || resume.code) {
        setInitialInvite({ token: resume.token, code: resume.code });
        setView('join');
      }
    }
    if (params.get('native') === '1') {
      setNativeReturn(true);
      strip('native');
      // The code the app cannot claim without — see HomeShell's twin.
      const code = readReturnCodeFromHash(window.location.hash);
      if (code) {
        setReturnCode(code);
        cleaned.hash = '';
      }
      // NOT on the name step: the account does not exist yet, and returning
      // now would close the sheet before a name can be typed. The name sheet
      // hands back itself, with the return code, once it does.
      if (params.get('authFlow') !== 'name') {
        window.setTimeout(() => {
          try {
            window.location.assign(nativeReturnHref(code));
          } catch {
            /* the button remains */
          }
        }, 800);
      }
    }

    if (dirty) window.history.replaceState(window.history.state, '', cleaned);
    // `noClubMode` is a server prop and never changes under a mounted page; the
    // `consumed` guard above is what makes a landing read-once regardless.
  }, [noClubMode]);
  /* eslint-enable react-hooks/set-state-in-effect */

  /**
   * Leave the no-club mode the only way out of it: both cookies cleared on the
   * server (`DELETE /api/admin` drops the member session too and needs no
   * privilege), the local identity forgotten, and the server asked again.
   */
  async function signOut() {
    clearIdentity();
    try {
      await fetch(`${BASE}/api/admin`, { method: 'DELETE' });
    } catch {
      /* the reload asks the server either way */
    }
    hardReload();
  }

  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(null), noticeTimeoutMs(notice));
    return () => clearTimeout(id);
  }, [notice]);

  const banner = notice ? noticeBanner(notice) : null;

  return (
    <>
      <ThemeToggle />
      <LanguageToggle />
      {/* An open foldable: the lockup stays on the left page as a cover while
          a form takes the right one (globals.css, the two-pane block). */}
      {pane && (
        <div className="launch-stage signed-out-cover" aria-hidden="true">
          <LaunchArt tagline={tCover('tagline')} variant="settled" />
        </div>
      )}
      <main data-page-shell className="max-w-lg mx-auto px-4 page-shell-top min-h-screen signed-out-main">
        <TopToast
          content={
            notice && banner
              ? {
                  id: `notice:${JSON.stringify(notice)}`,
                  tone: banner.tone,
                  icon: banner.icon,
                  title: tAuth(banner.titleKey),
                  body: tAuth(banner.bodyKey),
                  durationMs: noticeTimeoutMs(notice),
                }
              : null
          }
          onClose={() => setNotice(null)}
        />

        {nativeReturn ? (
          <div className="glass-card p-5" style={{ marginTop: 'var(--space-8)' }}>
            <p className="fs-md" style={{ color: 'var(--text-primary)', lineHeight: 'var(--lh-normal)', margin: '0 0 var(--space-5)' }}>
              {tAuth('nativeReturnBody')}
            </p>
            <a href={nativeReturnHref(returnCode)} className="btn-primary" style={{ display: 'block', textAlign: 'center', textDecoration: 'none' }}>
              {tAuth('backToApp')}
            </a>
          </div>
        ) : view === 'create' ? (
          /* A stranger arrives on the ACCOUNT step and leaves this page by the
             reload `onSignedIn` triggers; a no-club member already has the
             account, so the page opens on the form (its own probe confirms the
             session) and Done reloads into the club it just made. */
          <CreateGroupPage
            startAtAuth={!noClub}
            sessionId=""
            defaultName={noClub?.memberName}
            authProviders={authProviders}
            onBack={() => setView(noClub ? 'welcome' : 'signup')}
            onDone={hardReload}
            onSignedIn={
              noClub
                ? undefined
                : () => {
                    markOnboardingResume('create');
                    reloadIntoApp();
                  }
            }
          />
        ) : view === 'join' ? (
          /* No-club mode only: the person has an account, so a link or code
             goes to the join page rather than through sign-up. `resolve` there
             parses either form, which is why a code may ride `initialToken`. */
          <JoinGroupPage
            sessionId=""
            initialToken={initialInvite?.token ?? initialInvite?.code ?? null}
            defaultName={noClub?.memberName}
            hasOtherGroup={(noClub?.groups.length ?? 0) > 0}
            authProviders={authProviders}
            onBack={() => {
              setInitialInvite(null);
              setView('welcome');
            }}
            onJoined={hardReload}
            onAsked={hardReload}
          />
        ) : view === 'ask' ? (
          /* Asking to be let in, or to join through the club's link. A page,
             not a sheet (Grant, 2026-11-08): a real person approves it. */
          <AskAccessPage
            claimToken={claimToken}
            onBack={() => {
              // Through the link the ask was reached from the club's page;
              // "I play here already" came from Log in.
              const fromLink = claimToken !== null;
              setClaimToken(null);
              setView(fromLink ? (doorToken ? 'door' : 'welcome') : 'login');
            }}
          />
        ) : view === 'door' && doorToken ? (
          <DoorJoinPage
            token={doorToken}
            authProviders={authProviders}
            onBack={() => {
              setDoorToken(null);
              setView('welcome');
            }}
            // Until step 4b links imported names at approval, someone already
            // on the list claims their name the old way.
            onClaimName={() => {
              setClaimToken(doorToken);
              setView('ask');
            }}
          />
        ) : view === 'login' ? (
          <LogInView
            authProviders={authProviders}
            onBack={() => setView('welcome')}
            onSignUp={() => setView('signup')}
            onAsk={() => setView('ask')}
          />
        ) : view === 'signup' ? (
          <SignUpView
            authProviders={authProviders}
            initialInvite={initialInvite}
            onBack={() => {
              clearOnboardingResume();
              setView('welcome');
            }}
            onLogIn={() => setView('login')}
            onCreate={groupsOn ? () => setView('create') : undefined}
            onDoor={(token) => {
              // The club's link on the one-link path: not an invite, so the
              // club's page opens: sign in first, then ask.
              clearOnboardingResume();
              setInitialInvite(null);
              setDoorToken(token);
              setView('door');
            }}
          />
        ) : noClub ? (
          <NoClubView
            noClub={noClub}
            onCreate={() => setView('create')}
            onJoin={() => setView('join')}
            onSignOut={signOut}
            onSwitched={hardReload}
          />
        ) : (
          <WelcomeView onSignUp={() => setView('signup')} onLogIn={() => setView('login')} />
        )}
      </main>

      {/* No-op on the web. In the native shell it closes the browser sheet and
          dispatches `bpm:resume`, which the handoff collection listens for. */}
      <NativeBridge activeTab="home" onGoHome={() => setView('welcome')} />

      <ChooseNameSheet
        key={chooseName.open ? 'choose-name-open' : 'choose-name-closed'}
        open={chooseName.open}
        onClose={() => setChooseName({ open: false, invite: {}, noGroup: false })}
        sessionId=""
        inviteToken={chooseName.invite.token}
        inviteCode={chooseName.invite.code}
        noGroup={chooseName.noGroup}
        onReturnCode={(code) => {
          setReturnCode(code);
          window.location.assign(nativeReturnHref(code));
        }}
      />
      <HandoffCodeSheet {...handoffCollect} />
      <ResetPasswordSheet
        key={resetRequest ? 'reset-open' : 'reset-closed'}
        open={!!resetRequest}
        request={resetRequest}
        sessionId=""
        onClose={() => setResetRequest(null)}
        onDone={() => setResetRequest(null)}
        onNeedNewLink={() => {
          setResetRequest(null);
          setView('login');
        }}
      />
    </>
  );
}

/**
 * Reload so the server re-decides, at most once per few seconds.
 *
 * The guard is for the one way this could loop: a sign-in that set an identity
 * locally while its cookie never reached this jar would land right back here,
 * and a second identity write would reload again. Five seconds is long enough
 * to break that and short enough never to eat a real second sign-in.
 */
function reloadIntoApp() {
  try {
    const last = Number(window.sessionStorage.getItem(RELOAD_MARK) ?? 0);
    if (Date.now() - last < 5_000) return;
    window.sessionStorage.setItem(RELOAD_MARK, String(Date.now()));
  } catch {
    /* storage unavailable: reload anyway, which is the normal case */
  }
  window.location.reload();
}

// ── Welcome ────────────────────────────────────────────────────────────────

function WelcomeView({ onSignUp, onLogIn }: { onSignUp: () => void; onLogIn: () => void }) {
  const t = useTranslations('signedOut');
  /* The launch screen's finished lockup, drawn by the SAME component as the
     cold-start splash and at the same geometry — so on a cold start the splash
     fades away over an identical picture and only the buttons arrive (their
     rise waits for `data-launch="welcome"`; see globals.css "Launch screen").
     Coming Back from Sign up or Log in there is no splash, and they simply
     rise. */
  return (
    <div className="launch-stage launch-stage--welcome">
      <LaunchArt tagline={t('tagline')} variant="settled" />

      {/* Pinned to the bottom, where the thumb is. Sign up is the filled one:
          this screen is a stranger's first, and a returning player knows which
          door is theirs. The data attribute is what scripts/smoke-prod.mjs
          looks for — with members-only on, this is the page a signed-out
          deploy check gets, and it has no nav to find — and it is also how the
          launch screen knows to hand over to Welcome rather than to Home. */}
      <div data-signed-out-welcome className="launch-actions">
        <button
          type="button"
          onClick={onSignUp}
          className="btn-primary launch-btn launch-btn--primary"
          style={{ animationDelay: `${buttonDelayMs(0)}ms` }}
        >
          {t('signUp')}
        </button>
        <button
          type="button"
          onClick={onLogIn}
          className="btn-ghost launch-btn launch-btn--ghost"
          style={{ animationDelay: `${buttonDelayMs(1)}ms` }}
        >
          {t('logIn')}
        </button>
      </div>
    </div>
  );
}

// ── Signed in, in no club ──────────────────────────────────────────────────

function NoClubView({
  noClub,
  onCreate,
  onJoin,
  onSignOut,
  onSwitched,
}: {
  noClub: NoClub;
  onCreate: () => void;
  onJoin: () => void;
  onSignOut: () => void;
  onSwitched: () => void;
}) {
  const t = useTranslations('signedOut');
  const asks = noClub.asks ?? [];

  if (noClub.groups.length === 0 && asks.length > 0) {
    // Asked to join through a club's link and waiting (docs/plans/one-way-in.md,
    // step 4). The doors a brand-new organiser needs would only be noise here:
    // the one thing this person is doing is waiting for an organiser.
    return (
      <div className="animate-fadeIn">
        {/* The top bar keeps the card clear of the fixed theme and language toggles. */}
        <TopBar title={t('waiting.pageTitle')} backLabel={t('back')} />
        <div style={{ display: 'grid', gap: 'var(--space-5)', paddingBlock: '0 var(--space-9)' }}>
        <WaitingAsks asks={asks} onIn={onSwitched} />
        <div style={{ display: 'flex', justifyContent: 'center', flexWrap: 'wrap' }}>
          <button type="button" className="link-quiet" onClick={onJoin}>
            {t('waiting.joinAnother')}
          </button>
          <button type="button" className="link-quiet" onClick={onSignOut}>
            {t('waiting.signOut')}
          </button>
        </div>
        </div>
      </div>
    );
  }

  if (noClub.groups.length > 0) {
    // A member removed from the club their cookie names, who belongs to
    // others: the same list Profile shows, with nothing behind it to go back
    // to. A tap switches (the server re-mints the cookies) and reloads.
    return (
      <div style={{ display: 'grid', gap: 'var(--space-5)', paddingBlock: '0 var(--space-9)' }}>
        {asks.length > 0 && <WaitingAsks asks={asks} onIn={onSwitched} />}
        <GroupsPage
          groups={noClub.groups}
          hint={t('noClub.yourClubs')}
          onSwitched={onSwitched}
          onJoinAnother={onJoin}
          onCreateAnother={onCreate}
        />
        <button type="button" className="link-quiet" style={{ justifySelf: 'center' }} onClick={onSignOut}>
          {t('noClub.signOut')}
        </button>
      </div>
    );
  }

  /* The same lockup as Welcome — the launch screen hands over to this stage
     exactly as it does to Welcome (the data attribute is what it looks for) —
     with the doors a brand-new organiser needs where Sign up and Log in were. */
  return (
    <div className="launch-stage launch-stage--welcome">
      <LaunchArt tagline={t('tagline')} variant="settled" />
      <div data-signed-out-welcome className="launch-actions">
        <button
          type="button"
          onClick={onCreate}
          className="btn-primary launch-btn launch-btn--primary"
          style={{ animationDelay: `${buttonDelayMs(0)}ms` }}
        >
          {t('noClub.create')}
        </button>
        <button
          type="button"
          onClick={onJoin}
          className="btn-ghost launch-btn launch-btn--ghost"
          style={{ animationDelay: `${buttonDelayMs(1)}ms` }}
        >
          {t('noClub.join')}
        </button>
        <button
          type="button"
          onClick={onSignOut}
          className="link-quiet launch-btn"
          style={{ animationDelay: `${buttonDelayMs(2)}ms`, justifyContent: 'center' }}
        >
          {t('noClub.signOut')}
        </button>
      </div>
    </div>
  );
}

// ── Log in ─────────────────────────────────────────────────────────────────

function LogInView({
  authProviders,
  onBack,
  onSignUp,
  onAsk,
}: {
  authProviders: Provider[];
  onBack: () => void;
  onSignUp: () => void;
  /** "I play here already": the ask page. */
  onAsk: () => void;
}) {
  const t = useTranslations('signedOut');
  const [mode, setMode] = useState<'pin' | 'email'>('pin');
  const [forgotOpen, setForgotOpen] = useState(false);

  const signedIn = (result: { name: string; token?: string }) =>
    setIdentity({ name: result.name, sessionId: '', ...(result.token ? { token: result.token } : {}) });

  return (
    <div className="animate-fadeIn">
      <TopBar title={t('login.title')} onBack={onBack} backLabel={t('back')} />
      <div style={{ display: 'grid', gap: 'var(--space-5)', paddingBlock: '0 var(--space-9)' }}>
        <p style={{ margin: 0, fontSize: 'var(--fs-md)', color: 'var(--text-secondary)' }}>{t('login.body')}</p>
        <div className="glass-card" style={{ display: 'grid', gap: 'var(--space-4)', padding: 'var(--space-5)' }}>
          {authProviders.length > 0 && (
            <>
              <ProviderButtons mode="signin" available={authProviders} />
              <p style={{ margin: 0, textAlign: 'center', fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>
                {t('login.or')}
              </p>
            </>
          )}

          {/* Keyed wrapper: PIN ↔ email crossfades rather than swapping the
              form (and the card's height) in one frame. */}
          <div key={mode} className="motion-fade">
            {mode === 'email' ? (
              // A code first, the password a tap away (docs/plans/one-way-in.md, step 3).
              <EmailCodeSignInForm onSuccess={signedIn} onForgotPassword={() => setForgotOpen(true)} />
            ) : (
              <SignInForm sessionId="" onSuccess={signedIn} probeName={false} />
            )}
          </div>

          <div style={{ display: 'flex', justifyContent: 'center', flexWrap: 'wrap', whiteSpace: 'nowrap' }}>
            {/* "Forgot password?" lives on the form's password route now, the
                only place a password is asked for. */}
            <button type="button" className="link-quiet" onClick={onAsk}>
              {t('login.playHereAlready')}
            </button>
            <button type="button" className="link-quiet" onClick={() => setMode((m) => (m === 'pin' ? 'email' : 'pin'))}>
              {mode === 'pin' ? t('login.useEmail') : t('login.usePin')}
            </button>
          </div>
        </div>

        <button type="button" className="link-quiet" style={{ justifySelf: 'center' }} onClick={onSignUp}>
          {t('login.newHere')}
        </button>
      </div>

      <ForgotPasswordSheet open={forgotOpen} onClose={() => setForgotOpen(false)} />
    </div>
  );
}

// ── Ask to be let in / ask to join ─────────────────────────────────────────

/**
 * The ask as a PAGE (Grant, 2026-11-08: "Since there's a real person approval
 * steps I think they all should be using a page not a sheet"). Two ways here:
 * the club's link (`?claim=` or `/j/`, a new person joining or an imported
 * name claiming theirs) and Log in's "I play here already".
 *
 * Three steps on one page: the form, the wait (the form shows it), and — once
 * an organiser lets them in with nothing to sign in WITH — "Keep your
 * account". The identity is written only when they leave that last step,
 * because writing it reloads this screen into the app; the session cookie is
 * already set, so the step's Apple, Google and password all act on the new
 * account. Someone approved who already has a PIN goes straight in.
 */
function AskAccessPage({ claimToken, onBack }: { claimToken: string | null; onBack: () => void }) {
  const t = useTranslations('signedOut');
  const tAsk = useTranslations('recovery');
  const [claim, setClaim] = useState<{ token: string; clubName: string } | null>(null);
  const [claimDead, setClaimDead] = useState(false);
  const [approved, setApproved] = useState<AskApproved | null>(null);
  // A stale local identity saves a returning player typing their own name.
  // Read once, at mount; not through the link, where the name is a new one.
  const [staleName] = useState(() => (typeof window === 'undefined' || claimToken ? '' : getIdentity()?.name ?? ''));
  const claimResolved = useRef(false);

  // The link names a club; the preview says which, and nothing else
  // (`GET /api/groups/preview?claim=`).
  useEffect(() => {
    if (!claimToken || claimResolved.current) return;
    claimResolved.current = true;
    void (async () => {
      try {
        const res = await fetch(`${BASE}/api/groups/preview?claim=${encodeURIComponent(claimToken)}`, { cache: 'no-store' });
        if (!res.ok) {
          setClaimDead(true);
          return;
        }
        const data = (await res.json()) as { name: string };
        setClaim({ token: claimToken, clubName: data.name });
      } catch {
        setClaimDead(true);
      }
    })();
  }, [claimToken]);

  const enter = (name: string) => setIdentity({ name, sessionId: '' });

  if (approved) {
    return (
      <KeepAccountPage
        name={approved.name}
        initialEmail={approved.email}
        onDone={() => enter(approved.name)}
      />
    );
  }

  const waitingForClub = claimToken !== null && !claim && !claimDead;
  const title = claim ? tAsk('claimTitle', { club: claim.clubName }) : claimToken ? tAsk('joinTitle') : tAsk('askTitle');

  return (
    <div className="animate-slideInRight space-y-5" data-ask-page>
      <TopBar title={title} onBack={onBack} backLabel={t('back')} />
      {claimDead ? (
        /* A link the organiser has since replaced (or never was one): say so,
           rather than leaving them on a page that ignores the link. */
        <p className="field-error" role="alert">{t('login.claimLinkDead')}</p>
      ) : waitingForClub ? (
        <CardSkeleton height={ASK_CARD_HEIGHT} />
      ) : (
        <div className="glass-card p-5">
          <AskAccessForm
            initialName={staleName}
            claim={claim}
            onApproved={(result) => {
              // Nothing to sign in with next time: the account step first.
              if (!result.hasPin) setApproved(result);
              else enter(result.name);
            }}
          />
        </div>
      )}
    </div>
  );
}

// ── Sign up ────────────────────────────────────────────────────────────────

function SignUpView({
  authProviders,
  initialInvite,
  onBack,
  onLogIn,
  onCreate,
  onDoor,
}: {
  authProviders: Provider[];
  initialInvite: Invite | null;
  onBack: () => void;
  onLogIn: () => void;
  /** Multi-group on: "No invite? Start your own club". Absent, the line only explains. */
  onCreate?: () => void;
  /** The token turned out to be the club's door link (docs/plans/door-link.md). */
  onDoor?: (token: string) => void;
}) {
  const t = useTranslations('signedOut');
  const [entry, setEntry] = useState('');
  const [found, setFound] = useState<(Invite & { name: string }) | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const resolvedInitial = useRef(false);

  // A `?join=` landing resolves the club straight away, so the page opens
  // already naming it instead of asking for what was in the link.
  useEffect(() => {
    if (!initialInvite || resolvedInitial.current) return;
    resolvedInitial.current = true;
    void resolve(initialInvite);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialInvite]);

  async function resolve(invite: Invite) {
    if (!invite.token && !invite.code) return;
    setBusy(true);
    setError(null);
    try {
      const query = invite.token
        ? `token=${encodeURIComponent(invite.token)}`
        : `code=${encodeURIComponent(invite.code!)}`;
      // The ONE club-related read a signed-out visitor may make: the preview
      // answers a valid invite with the club's name and nothing else.
      const res = await fetch(`${BASE}/api/groups/preview?${query}`, { cache: 'no-store' });
      if (!res.ok) {
        // A tapped or pasted LINK that no longer resolves (used, expired,
        // revoked, or a replaced club link) is not a mistyped code: say so.
        // The preview's one 404 still cannot tell those cases apart.
        setError(res.status === 404 ? t(invite.token ? 'signup.linkNotFound' : 'signup.notFound') : t('signup.failed'));
        return;
      }
      const data = (await res.json()) as { name: string; kind?: 'invite' | 'door' };
      if (data.kind === 'door' && invite.token && onDoor) {
        onDoor(invite.token);
        return;
      }
      setFound({ name: data.name, ...invite });
    } catch {
      setError(t('signup.failed'));
    } finally {
      setBusy(false);
    }
  }

  if (found) {
    return (
      <div className="animate-fadeIn">
        <TopBar title={t('signup.accountTitle', { name: found.name })} onBack={() => setFound(null)} backLabel={t('back')} />
        <div style={{ display: 'grid', gap: 'var(--space-5)', paddingBlock: '0 var(--space-9)' }}>
          <p style={{ margin: 0, fontSize: 'var(--fs-md)', color: 'var(--text-secondary)' }}>{t('signup.accountBody')}</p>

          <div className="glass-card" style={{ display: 'grid', gap: 'var(--space-4)', padding: 'var(--space-5)' }}>
            {authProviders.length > 0 && (
              <>
                {/* The invite must survive the trip to Google: the callback
                    builds its return URL from scratch, so localStorage is the
                    only thing that comes back. Recorded at the tap. */}
                <ProviderButtons
                  mode="signin"
                  available={authProviders}
                  onLeave={() => markOnboardingResume('join', found.token, found.code)}
                />
                <p style={{ margin: 0, textAlign: 'center', fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>
                  {t('signup.or')}
                </p>
              </>
            )}
            <EmailSignUpForm
              inviteToken={found.token}
              inviteCode={found.code}
              onSuccess={({ name }) => setIdentity({ name, sessionId: '' })}
            />
          </div>

          <button type="button" className="link-quiet" style={{ justifySelf: 'center' }} onClick={onLogIn}>
            {t('signup.haveAccount')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="animate-fadeIn">
      <TopBar title={t('signup.title')} onBack={onBack} backLabel={t('back')} />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          // A link or a code out of one box — `lib/parseInviteInput.ts`, shared with `JoinGroupPage`.
          void resolve(parseInviteInput(entry, window.location.origin));
        }}
        style={{ display: 'grid', gap: 'var(--space-5)', paddingBlock: '0 var(--space-9)' }}
      >
        <p style={{ margin: 0, fontSize: 'var(--fs-md)', color: 'var(--text-secondary)' }}>{t('signup.body')}</p>

        <label style={{ display: 'grid', gap: 'var(--space-2)' }}>
          <span className="section-label">{t('signup.codeLabel')}</span>
          <input
            type="text"
            value={entry}
            onChange={(e) => {
              setEntry(e.target.value);
              setError(null);
            }}
            placeholder={t('signup.codePlaceholder')}
            aria-label={t('signup.codeLabel')}
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
          />
        </label>

        {error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}

        <button type="submit" disabled={busy || !entry.trim()} className="btn-primary w-full">
          {busy ? t('signup.checking') : t('signup.continue')}
        </button>

        {onCreate ? (
          // The stranger's door to a club of their own (Grant, 2026-10-07: a
          // link here, not a third button on Welcome).
          <button type="button" className="link-quiet" style={{ justifySelf: 'center' }} onClick={onCreate}>
            {t('signup.createInstead')}
          </button>
        ) : (
          <p style={{ margin: 0, textAlign: 'center', fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>
            {t('signup.noInvite')}
          </p>
        )}
        <button type="button" className="link-quiet" style={{ justifySelf: 'center' }} onClick={onLogIn}>
          {t('signup.haveAccount')}
        </button>
      </form>
    </div>
  );
}
