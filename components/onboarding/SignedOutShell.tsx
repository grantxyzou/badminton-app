'use client';

import { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import LaunchArt from '@/components/launch/LaunchArt';
import { usePaneMode } from '@/lib/paneMode';
import { buttonDelayMs } from '@/lib/launchMotion';
import TopToast from '@/components/primitives/TopToast';
import ThemeToggle from '@/components/ThemeToggle';
import LanguageToggle from '@/components/LanguageToggle';
import NativeBridge from '@/components/NativeBridge';
import KeepAccountPage from '@/components/auth/KeepAccountPage';
import type { Provider } from '@/components/auth/ProviderButtons';
import ForgotPasswordSheet from '@/components/auth/ForgotPasswordSheet';
import { useEmailCode } from '@/components/auth/useEmailCode';
import { usePinSignIn } from '@/components/auth/usePinSignIn';
import { usePasswordSignIn } from '@/components/auth/usePasswordSignIn';
import DoorJoinPage from '@/components/onboarding/DoorJoinPage';
import WaitingAsks, { type Ask } from '@/components/onboarding/WaitingAsks';
import AuthStage from '@/components/onboarding/AuthStage';
import ClubLinkPage from '@/components/onboarding/ClubLinkPage';
import NameStep from '@/components/onboarding/NameStep';
import { TaglineContext, useTagline } from '@/components/onboarding/TaglineContext';
import { CheckEmailPage, EmailCodeChoices } from '@/components/onboarding/SignInPieces';
import HandoffCodeSheet from '@/components/auth/HandoffCodeSheet';
import ResetPasswordSheet from '@/components/auth/ResetPasswordSheet';
import { clearIdentity, getIdentity, setIdentity, IDENTITY_EVENT } from '@/lib/identity';
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

// The multi-group doors, split out exactly as HomeShell splits them: a
// stranger who never taps "Start your own club" never downloads them.
const CreateGroupPage = dynamic(() => import('./CreateGroupPage'), { ssr: false });
const JoinGroupPage = dynamic(() => import('./JoinGroupPage'), { ssr: false });
const GroupsPage = dynamic(() => import('@/components/profile/GroupsPage'), { ssr: false });

/** `create` and `join` are reachable only with multi-group on. `name`: back
 *  from Google or Apple with a new sign-in and no club's link (creating one). */
type View = 'welcome' | 'login' | 'signup' | 'create' | 'join' | 'cantSignIn' | 'door' | 'name';
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
  /** This visit's line under the logo, picked on the server (`lib/tagline.ts`). */
  tagline?: string;
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
export default function SignedOutShell({ authProviders = [], noClub: noClubProp, tagline: taglineProp }: Props) {
  const tAuth = useTranslations('profile.auth');
  const groupsOn = isFlagOn('NEXT_PUBLIC_FLAG_MULTI_GROUP');
  // A no-club member cannot exist with groups off (every active member is in
  // BPM), so the prop is ignored rather than rendering a mode nothing can reach.
  const noClub = groupsOn ? (noClubProp ?? null) : null;
  const [view, setView] = useState<View>('welcome');
  const pane = usePaneMode();
  const tCover = useTranslations('signedOut');
  // Outside its own provider, so the list's first line when the page passed none.
  const firstTagline = useTagline();
  const tagline = taglineProp ?? firstTagline;
  const [notice, setNotice] = useState<AuthNotice | null>(null);
  const [nativeReturn, setNativeReturn] = useState(false);
  /** The native return code from the landing's `#hc=`, or from the name step. */
  const [returnCode, setReturnCode] = useState<string | null>(null);
  const [resetRequest, setResetRequest] = useState<{ token: string; email: string } | null>(null);
  /** Back from Google or Apple with a new sign-in: the name step, on the club's link or for a new club. */
  const [namingAfterProvider, setNamingAfterProvider] = useState<{ noGroup: boolean } | null>(null);
  const [initialInvite, setInitialInvite] = useState<Invite | null>(null);
  /** "Reset my password", from Can't sign in? */
  const [forgotOpen, setForgotOpen] = useState(false);
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
      // A brand-new Google/Apple identity: the name step, a page like the
      // email path's (docs/plans/sign-in-redesign.md, merge 4). The club's
      // link rode the excursion in localStorage — the callback URL carries
      // none of ours — so it opens the club's page at its name step. A CREATE
      // resume means "join me to nothing", and is re-marked, because the read
      // above was destructive and the reload after the name step still needs
      // it to land on the create form.
      const creating = resume?.intent === 'create';
      if (creating) markOnboardingResume('create');
      if (!creating && resume?.token && !noClubMode) {
        setDoorToken(resume.token);
        setNamingAfterProvider({ noGroup: false });
        setView('door');
      } else {
        setNamingAfterProvider({ noGroup: creating });
        setView('name');
      }
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
    // THE CLUB'S LINK, either way it arrives: `/bpm/j/<token>` redirects to
    // `?join=`, and a link shared before it carries `?claim=`. Every link is a
    // club's since one-time invites were retired (docs/plans/one-way-in.md,
    // step 5). A live credential, so stripped. Signed out, it opens the club's
    // page (sign in first, then ask); a signed-in member in no club already
    // has an account, so it asks from the join page.
    const link = params.get('claim') ?? params.get('join');
    if (link && params.get('authFlow') !== 'name') {
      if (noClubMode) {
        setInitialInvite({ token: link });
        setView('join');
      } else {
        setDoorToken(link);
        setView('door');
      }
      strip('claim', 'join');
    } else if (noClubMode && resume) {
      // Back from the account step (or the name step) of a door, on the far
      // side of the reload — straight to where they were going.
      if (resume.intent === 'create') setView('create');
      else if (resume.token) {
        setInitialInvite({ token: resume.token });
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
    <TaglineContext.Provider value={tagline}>
      <ThemeToggle />
      <LanguageToggle />
      {/* An open foldable: the lockup stays on the left page as a cover while
          a form takes the right one (globals.css, the two-pane block). */}
      {pane && (
        <div className="launch-stage signed-out-cover" aria-hidden="true">
          <LaunchArt tagline={tagline} variant="settled" />
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
        ) : view === 'cantSignIn' ? (
          /* Can't sign in? Back in through the club's link: sign in a new way,
             and "Is that you?" joins it to the account (docs/plans/sign-in-redesign.md). */
          <CantSignInView
            onBack={() => setView('login')}
            onDoor={(token) => {
              setDoorToken(token);
              setView('door');
            }}
            onResetPassword={() => setForgotOpen(true)}
          />
        ) : view === 'name' && namingAfterProvider ? (
          <NameStep
            title={tAuth('chooseNameTitle')}
            noGroup={namingAfterProvider.noGroup}
            prefill
            onBack={() => {
              setNamingAfterProvider(null);
              setView('welcome');
            }}
            onMade={(name) => setIdentity({ name, sessionId: '' })}
            onReturnCode={(code) => {
              setReturnCode(code);
              window.location.assign(nativeReturnHref(code));
            }}
          />
        ) : view === 'door' && doorToken ? (
          <DoorJoinPage
            token={doorToken}
            authProviders={authProviders}
            startAtName={!!namingAfterProvider}
            onReturnCode={(code) => {
              setReturnCode(code);
              window.location.assign(nativeReturnHref(code));
            }}
            onBack={() => {
              setDoorToken(null);
              setNamingAfterProvider(null);
              setView('welcome');
            }}
          />
        ) : view === 'login' ? (
          <LogInView
            authProviders={authProviders}
            onBack={() => setView('welcome')}
            onJoin={() => setView('signup')}
            onCantSignIn={() => setView('cantSignIn')}
            onForgotPassword={() => setForgotOpen(true)}
          />
        ) : view === 'signup' ? (
          <ClubLinkPage
            title={tCover('join.title')}
            heading={tCover('join.heading')}
            copy={tCover('join.body')}
            scanAt="middle"
            onBack={() => {
              clearOnboardingResume();
              setView('welcome');
            }}
            onLink={(token) => {
              // The club's page: sign in first, then ask.
              clearOnboardingResume();
              setInitialInvite(null);
              setDoorToken(token);
              setView('door');
            }}
            links={
              <>
                {groupsOn && (
                  <button type="button" className="link-quiet" onClick={() => setView('create')}>
                    {tCover('join.startClub')}
                  </button>
                )}
                <button type="button" className="link-quiet" onClick={() => setView('login')}>
                  {tCover('join.logIn')}
                </button>
              </>
            }
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

      <HandoffCodeSheet {...handoffCollect} />
      <ForgotPasswordSheet open={forgotOpen} onClose={() => setForgotOpen(false)} />
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
    </TaglineContext.Provider>
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
  const tagline = useTagline();
  /* The launch screen's finished lockup, drawn by the SAME component as the
     cold-start splash and at the same geometry — so on a cold start the splash
     fades away over an identical picture and only the buttons arrive (their
     rise waits for `data-launch="welcome"`; see globals.css "Launch screen").
     Coming Back from Sign up or Log in there is no splash, and they simply
     rise. */
  return (
    <div className="launch-stage launch-stage--welcome">
      <LaunchArt tagline={tagline} variant="settled" />

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
  const tagline = useTagline();
  const asks = noClub.asks ?? [];

  if (noClub.groups.length === 0 && asks.length > 0) {
    // Asked to join through a club's link and waiting (docs/plans/one-way-in.md,
    // step 4): one page, "Request sent" the first time and "still pending"
    // after (docs/plans/sign-in-redesign.md). The doors a brand-new organiser
    // needs would only be noise here: the one thing this person is doing is
    // waiting for an organizer.
    return <WaitingAsks asks={asks} onIn={onSwitched} onJoin={onJoin} onSignOut={onSignOut} />;
  }

  if (noClub.groups.length > 0) {
    // A member removed from the club their cookie names, who belongs to
    // others: the same list Profile shows, with nothing behind it to go back
    // to. A tap switches (the server re-mints the cookies) and reloads.
    return (
      <div style={{ display: 'grid', gap: 'var(--space-5)', paddingBlock: '0 var(--space-9)' }}>
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
      <LaunchArt tagline={tagline} variant="settled" />
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

/**
 * Log in (docs/plans/sign-in-redesign.md; Grant, 2026-11-19: "A log in screen
 * should be clean and easy."): the lockup, then Apple, Google and an emailed
 * code at the bottom, where the thumb is. The PIN is behind "Other ways" — it
 * keeps working for everyone who has one, and nobody new is offered one.
 *
 * Someone who signs in with a PIN and has nothing else gets "Keep your
 * account" straight away, once, before the app opens: each person who adds
 * Apple, Google or an email never needs an organizer to get back in.
 */
function LogInView({
  authProviders,
  onBack,
  onJoin,
  onCantSignIn,
  onForgotPassword,
}: {
  authProviders: Provider[];
  onBack: () => void;
  onJoin: () => void;
  onCantSignIn: () => void;
  onForgotPassword: () => void;
}) {
  const t = useTranslations('signedOut');
  const tagline = useTagline();
  const tl = useTranslations('signedOut.login');
  const tRec = useTranslations('recovery');
  const tAuth = useTranslations('profile.auth');
  const tPinCopy = useTranslations('pin');
  const [mode, setMode] = useState<'email' | 'pin' | 'password'>('email');
  /** Signed in with a PIN that is their only way in: "Keep your account" first. */
  const [keepFor, setKeepFor] = useState<string | null>(null);

  const signedIn = ({ name }: { name: string }) => setIdentity({ name, sessionId: '' });
  const code = useEmailCode({ onSuccess: signedIn });
  const pw = usePasswordSignIn({ onSuccess: signedIn });
  const pin = usePinSignIn({
    sessionId: '',
    onSuccess: ({ name, token }) => {
      void (async () => {
        // The cookie is set; ask what else this account can sign in with.
        // Unknown (a failed read) goes straight in: the prompt is a nicety.
        try {
          const res = await fetch(`${BASE}/api/auth/methods`, { cache: 'no-store' });
          const m = res.ok
            ? ((await res.json()) as { linked?: string[] | null; hasPassword?: boolean; hasEmailCode?: boolean; hasPin?: boolean })
            : null;
          // `hasPin` tells "a PIN is all they have" from the anonymous answer
          // (every field false), which a cookie that did not stick would give.
          const pinOnly =
            !!m && m.hasPin === true && Array.isArray(m.linked) && m.linked.length === 0 && m.hasPassword === false && m.hasEmailCode !== true;
          if (pinOnly) {
            setKeepFor(name);
            return;
          }
        } catch {
          /* straight in */
        }
        setIdentity({ name, sessionId: '', ...(token ? { token } : {}) });
      })();
    },
  });

  if (keepFor) {
    return (
      <KeepAccountPage
        name={keepFor}
        reason="pinOnly"
        onDone={() => setIdentity({ name: keepFor, sessionId: '' })}
      />
    );
  }

  if (mode === 'email' && code.step === 'code') {
    return <CheckEmailPage code={code} title={tl('title')} definite={false} />;
  }

  if (mode === 'pin') {
    return (
      <AuthStage
        data-page="login-pin"
        title={tl('title')}
        onBack={onBack}
        backLabel={t('back')}
        logoTagline={tagline}
        links={
          <>
            <button type="button" className="link-quiet" onClick={onCantSignIn}>
              {tl('forgotPin')}
            </button>
            <button type="button" className="link-quiet" onClick={() => setMode('password')}>
              {tl('usePassword')}
            </button>
            <button type="button" className="link-quiet" onClick={() => setMode('email')}>
              {tl('useEmail')}
            </button>
          </>
        }
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void pin.submit();
          }}
          style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}
        >
          <input
            className="auth-field"
            type="text"
            value={pin.name}
            onChange={(e) => pin.setName(e.target.value)}
            placeholder={tRec('nameLabel')}
            aria-label={tRec('nameLabel')}
            autoComplete="nickname"
            maxLength={50}
          />
          <input
            className="auth-field"
            type="password"
            inputMode="numeric"
            autoComplete="current-password"
            value={pin.pin}
            onChange={(e) => pin.setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
            placeholder={tRec('pinLabel')}
            aria-label={tRec('pinLabel')}
            aria-invalid={pin.error === 'invalid' || undefined}
            maxLength={4}
            disabled={pin.paused}
          />
          {pin.error === 'invalid' && (
            <p role="alert" className="field-error">
              {tRec('errorInvalid')}
            </p>
          )}
          {pin.error === 'paused' && pin.paused && (
            <p role="alert" className="field-warn">
              {tPinCopy('paused', { time: pin.pauseLabel })}
            </p>
          )}
          {pin.error === 'rate_limited' && (
            <p role="alert" className="field-warn">
              {tRec('errorRateLimited')}
            </p>
          )}
          {pin.error === 'admin_logged_in' && (
            <p role="alert" className="field-warn">
              {tRec('errorAdminLoggedIn')}
            </p>
          )}
          {pin.error === 'network' && (
            <p role="alert" className="field-warn">
              {tRec('errorNetwork')}
            </p>
          )}
          <button type="submit" className="auth-btn auth-btn--primary" disabled={!pin.canSubmit}>
            {pin.submitting ? tRec('submitting') : tRec('submitPin')}
          </button>
        </form>
      </AuthStage>
    );
  }

  if (mode === 'password') {
    return (
      <AuthStage
        data-page="login-password"
        title={tl('title')}
        onBack={onBack}
        backLabel={t('back')}
        logoTagline={tagline}
        links={
          <>
            <button type="button" className="link-quiet" onClick={onForgotPassword}>
              {tAuth('forgotPasswordLink')}
            </button>
            <button type="button" className="link-quiet" onClick={() => setMode('pin')}>
              {tl('usePin')}
            </button>
            <button type="button" className="link-quiet" onClick={() => setMode('email')}>
              {tl('useEmail')}
            </button>
          </>
        }
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void pw.submit();
          }}
          style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}
        >
          <input
            className="auth-field"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            value={pw.email}
            onChange={(e) => pw.setEmail(e.target.value)}
            placeholder={tAuth('emailLabel')}
            aria-label={tAuth('emailLabel')}
            maxLength={254}
          />
          <input
            className="auth-field"
            type="password"
            autoComplete="current-password"
            value={pw.password}
            onChange={(e) => pw.setPassword(e.target.value)}
            placeholder={tAuth('passwordLabel')}
            aria-label={tAuth('passwordLabel')}
            aria-invalid={pw.error === 'invalid' || undefined}
            maxLength={200}
          />
          {pw.error === 'invalid' && (
            <p role="alert" className="field-error">
              {tAuth('signInInvalid')}
            </p>
          )}
          {pw.error === 'rate_limited' && (
            <p role="alert" className="field-warn">
              {tAuth('signInRateLimited')}
            </p>
          )}
          {pw.error === 'service' && (
            <p role="alert" className="field-warn">
              {tAuth('signInService')}
            </p>
          )}
          <button type="submit" className="auth-btn auth-btn--primary" disabled={!pw.canSubmit}>
            {pw.busy ? tAuth('emailSignInChecking') : tAuth('emailSignInCta')}
          </button>
        </form>
      </AuthStage>
    );
  }

  return (
    <AuthStage
      data-page="login"
      title={tl('title')}
      onBack={onBack}
      backLabel={t('back')}
      logoTagline={tagline}
      links={
        <>
          <button type="button" className="link-quiet" onClick={onCantSignIn}>
            {tl('cantSignIn')}
          </button>
          <button type="button" className="link-quiet" onClick={() => setMode('pin')}>
            {tl('otherWays')}
          </button>
          <button type="button" className="link-quiet" onClick={onJoin}>
            {tl('joinClub')}
          </button>
        </>
      }
    >
      <EmailCodeChoices code={code} authProviders={authProviders} />
    </AuthStage>
  );
}

// ── Can't sign in? ─────────────────────────────────────────────────────────

/**
 * Back in through the club's link (docs/plans/sign-in-redesign.md, merge 1):
 * scan the club's QR code, sign in a new way, and "Is that you?" joins the new
 * sign-in to the account. It replaced the signed-out, name-only "let me in"
 * ask, which needed the page kept open and lapsed within an hour.
 */
function CantSignInView({
  onBack,
  onDoor,
  onResetPassword,
}: {
  onBack: () => void;
  onDoor: (token: string) => void;
  onResetPassword: () => void;
}) {
  const tc = useTranslations('signedOut.cantSignIn');
  return (
    <ClubLinkPage
      title={tc('title')}
      heading={tc('heading')}
      copy={tc('body')}
      scanAt="bottom"
      onBack={onBack}
      onLink={onDoor}
      links={
        <button type="button" className="link-quiet" onClick={onResetPassword}>
          {tc('resetPassword')}
        </button>
      }
    />
  );
}
