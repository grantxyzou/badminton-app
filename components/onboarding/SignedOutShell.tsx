'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import EmptyState from '@/components/primitives/EmptyState';
import BpmWordmark from '@/components/BpmWordmark';
import TopBar from '@/components/primitives/TopBar';
import StatusBanner from '@/components/primitives/StatusBanner';
import ThemeToggle from '@/components/ThemeToggle';
import LanguageToggle from '@/components/LanguageToggle';
import NativeBridge from '@/components/NativeBridge';
import SignInForm from '@/components/SignInForm';
import AskAccessSheet from '@/components/AskAccessSheet';
import ProviderButtons, { type Provider } from '@/components/auth/ProviderButtons';
import EmailSignInForm from '@/components/auth/EmailSignInForm';
import EmailSignUpForm from '@/components/auth/EmailSignUpForm';
import ForgotPasswordSheet from '@/components/auth/ForgotPasswordSheet';
import ChooseNameSheet from '@/components/auth/ChooseNameSheet';
import ResetPasswordSheet from '@/components/auth/ResetPasswordSheet';
import { getIdentity, setIdentity, IDENTITY_EVENT } from '@/lib/identity';
import { noticeBanner, noticeTimeoutMs, type AuthNotice } from '@/lib/authNotice';
import { pendingHandoffId } from '@/lib/handoffClient';
import { useHandoffCollect } from '@/lib/useHandoffCollect';
import {
  markOnboardingResume,
  consumeOnboardingResume,
  pruneStaleOnboardingResume,
  clearOnboardingResume,
} from '@/lib/onboardingResume';
import { isFlagOn } from '@/lib/flags';
import { OFFER_PIN_KEY } from '@/lib/offerPin';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/** The one key this screen writes in sessionStorage. See `reloadIntoApp`. */
const RELOAD_MARK = 'badminton_signed_out_reload_at';

type View = 'welcome' | 'login' | 'signup';
type Invite = { token?: string; code?: string };

interface Props {
  /** Server-resolved, so the provider buttons are settled on first paint. */
  authProviders?: Provider[];
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
 */
export default function SignedOutShell({ authProviders = [] }: Props) {
  const tAuth = useTranslations('profile.auth');
  const [view, setView] = useState<View>('welcome');
  const [notice, setNotice] = useState<AuthNotice | null>(null);
  const [nativeReturn, setNativeReturn] = useState(false);
  const [resetRequest, setResetRequest] = useState<{ token: string; email: string } | null>(null);
  const [chooseName, setChooseName] = useState<{ open: boolean; invite: Invite }>({ open: false, invite: {} });
  const [initialInvite, setInitialInvite] = useState<Invite | null>(null);
  const consumed = useRef(false);

  // ── Signing in anywhere reloads into the app ─────────────────────────────
  useEffect(() => {
    const onChange = () => {
      if (getIdentity()) reloadIntoApp();
    };
    window.addEventListener(IDENTITY_EVENT, onChange);
    return () => window.removeEventListener(IDENTITY_EVENT, onChange);
  }, []);

  // The installed-PWA Google return: a sign-in parked in Safari's cookie jar.
  useHandoffCollect((name) => setIdentity({ name, sessionId: '' }));

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
    const resume =
      landedFromAuth || pendingHandoffId() !== null ? consumeOnboardingResume() : (pruneStaleOnboardingResume(), null);

    if (params.get('authFlow') === 'name') {
      // A brand-new Google/Apple identity: collect a name. The invite rode the
      // excursion in localStorage — the callback URL carries none of ours.
      setChooseName({ open: true, invite: { token: resume?.token, code: resume?.code } });
      strip('authFlow');
    }
    if (params.get('signedIn') === '1') {
      // The server rendered THIS screen, so the cookie did not reach this jar.
      // An installed PWA collects it through the handoff; anything else is worth
      // saying out loud.
      if (pendingHandoffId() === null) setNotice({ kind: 'signInUnconfirmed' });
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
    const join = params.get('join');
    if (join) {
      setInitialInvite({ token: join });
      setView('signup');
      strip('join');
    }
    if (params.get('native') === '1') {
      setNativeReturn(true);
      strip('native');
      window.setTimeout(() => {
        try {
          window.location.assign('bpm://auth/return');
        } catch {
          /* the button remains */
        }
      }, 800);
    }

    if (dirty) window.history.replaceState(window.history.state, '', cleaned);
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

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
      <main data-page-shell className="max-w-lg mx-auto px-4 page-shell-top min-h-screen">
        {banner && (
          <div className="mb-3">
            <StatusBanner
              tone={banner.tone}
              icon={banner.icon}
              title={tAuth(banner.titleKey)}
              body={tAuth(banner.bodyKey)}
              celebrate={banner.celebrate}
            />
          </div>
        )}

        {nativeReturn ? (
          <div className="glass-card p-5" style={{ marginTop: 'var(--space-8)' }}>
            <p className="fs-md" style={{ color: 'var(--text-primary)', lineHeight: 'var(--lh-normal)', margin: '0 0 var(--space-5)' }}>
              {tAuth('nativeReturnBody')}
            </p>
            <a href="bpm://auth/return" className="btn-primary" style={{ display: 'block', textAlign: 'center', textDecoration: 'none' }}>
              {tAuth('backToApp')}
            </a>
          </div>
        ) : view === 'login' ? (
          <LogInView authProviders={authProviders} onBack={() => setView('welcome')} onSignUp={() => setView('signup')} />
        ) : view === 'signup' ? (
          <SignUpView
            authProviders={authProviders}
            initialInvite={initialInvite}
            onBack={() => {
              clearOnboardingResume();
              setView('welcome');
            }}
            onLogIn={() => setView('login')}
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
        onClose={() => setChooseName({ open: false, invite: {} })}
        sessionId=""
        inviteToken={chooseName.invite.token}
        inviteCode={chooseName.invite.code}
      />
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
  return (
    <div
      className="animate-fadeIn"
      style={{
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        minHeight: 'calc(100dvh - var(--space-9) - env(safe-area-inset-top))',
        // The bottom pad clears the iPhone home indicator in the installed app,
        // where the pinned buttons would otherwise sit under it.
        paddingBlock: 'var(--space-9) calc(var(--space-7) + env(safe-area-inset-bottom))',
      }}
    >
      <div style={{ display: 'grid', gap: 'var(--space-4)', justifyItems: 'center', textAlign: 'center', marginTop: 'var(--space-9)' }}>
        <BpmWordmark size="3.5rem" color="var(--text-primary)" />
        <p style={{ margin: 0, fontSize: 'var(--fs-lg)', color: 'var(--text-secondary)' }}>{t('tagline')}</p>
      </div>

      {/* Pinned to the bottom, where the thumb is. Sign up is the filled one:
          this screen is a stranger's first, and a returning player knows which
          door is theirs. */}
      <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
        <button type="button" onClick={onSignUp} className="btn-primary w-full">
          {t('signUp')}
        </button>
        <button type="button" onClick={onLogIn} className="btn-ghost w-full">
          {t('logIn')}
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
}: {
  authProviders: Provider[];
  onBack: () => void;
  onSignUp: () => void;
}) {
  const t = useTranslations('signedOut');
  const providersOn = isFlagOn('NEXT_PUBLIC_FLAG_AUTH_PROVIDERS');
  const [mode, setMode] = useState<'pin' | 'email'>('pin');
  const [askOpen, setAskOpen] = useState(false);
  const [forgotOpen, setForgotOpen] = useState(false);
  // A stale local identity is the one thing worth remembering here: it saves a
  // returning player typing their own name. Read once, at mount.
  const [staleName] = useState(() => (typeof window === 'undefined' ? '' : getIdentity()?.name ?? ''));

  const signedIn = (result: { name: string; token?: string }) =>
    setIdentity({ name: result.name, sessionId: '', ...(result.token ? { token: result.token } : {}) });

  return (
    <div className="animate-fadeIn">
      <TopBar title={t('login.title')} onBack={onBack} backLabel={t('back')} />
      <div style={{ display: 'grid', gap: 'var(--space-5)', paddingBlock: '0 var(--space-9)' }}>
        <p style={{ margin: 0, fontSize: 'var(--fs-md)', color: 'var(--text-secondary)' }}>{t('login.body')}</p>

        <div className="glass-card" style={{ display: 'grid', gap: 'var(--space-4)', padding: 'var(--space-5)' }}>
          {providersOn && authProviders.length > 0 && (
            <>
              <ProviderButtons mode="signin" available={authProviders} />
              <p style={{ margin: 0, textAlign: 'center', fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>
                {t('login.or')}
              </p>
            </>
          )}

          {providersOn && mode === 'email' ? (
            <EmailSignInForm onSuccess={signedIn} />
          ) : (
            <SignInForm sessionId="" onSuccess={signedIn} probeName={false} />
          )}

          <div style={{ display: 'flex', justifyContent: 'center', flexWrap: 'wrap', whiteSpace: 'nowrap' }}>
            <button
              type="button"
              className="link-quiet"
              onClick={() => (mode === 'email' ? setForgotOpen(true) : setAskOpen(true))}
            >
              {mode === 'email' ? t('login.forgotPassword') : t('login.playHereAlready')}
            </button>
            {providersOn && (
              <button type="button" className="link-quiet" onClick={() => setMode((m) => (m === 'pin' ? 'email' : 'pin'))}>
                {mode === 'pin' ? t('login.useEmail') : t('login.usePin')}
              </button>
            )}
          </div>
        </div>

        <button type="button" className="link-quiet" style={{ justifySelf: 'center' }} onClick={onSignUp}>
          {t('login.newHere')}
        </button>
      </div>

      {/* "I play here already": the way back for a regular with no PIN, email or
          Google — an admin approves, and the sheet signs them in itself. */}
      <AskAccessSheet
        open={askOpen}
        onClose={() => setAskOpen(false)}
        sessionId=""
        initialName={staleName}
        onSignedIn={({ hasPin }) => {
          setAskOpen(false);
          // An approval signs them in with no credential. The reload the sign-in
          // triggers is async, so this lands before the page goes — Home then
          // opens the PIN sheet instead of letting them leave with nothing.
          if (!hasPin) {
            try {
              window.sessionStorage.setItem(OFFER_PIN_KEY, '1');
            } catch {
              /* Home still shows the card */
            }
          }
        }}
      />
      <ForgotPasswordSheet open={forgotOpen} onClose={() => setForgotOpen(false)} />
    </div>
  );
}

// ── Sign up ────────────────────────────────────────────────────────────────

function SignUpView({
  authProviders,
  initialInvite,
  onBack,
  onLogIn,
}: {
  authProviders: Provider[];
  initialInvite: Invite | null;
  onBack: () => void;
  onLogIn: () => void;
}) {
  const t = useTranslations('signedOut');
  const providersOn = isFlagOn('NEXT_PUBLIC_FLAG_AUTH_PROVIDERS');
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

  /** A link or a code out of one box, parsed the way `JoinGroupPage` parses it. */
  function parse(raw: string): Invite {
    const trimmed = raw.trim();
    if (!trimmed) return {};
    if (/^https?:\/\//i.test(trimmed) || trimmed.includes('?join=')) {
      try {
        const token = new URL(trimmed, window.location.origin).searchParams.get('join');
        if (token) return { token };
      } catch {
        /* not a URL after all */
      }
    }
    if (/^[0-9a-f]{32}$/i.test(trimmed)) return { token: trimmed };
    return { code: trimmed };
  }

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
        setError(res.status === 404 ? t('signup.notFound') : t('signup.failed'));
        return;
      }
      const data = (await res.json()) as { name: string };
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

          {!providersOn ? (
            // A configuration fact, not a failure the visitor caused or can retry.
            <EmptyState>{t('signup.noProviders')}</EmptyState>
          ) : (
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
          )}

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
          void resolve(parse(entry));
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

        <p style={{ margin: 0, textAlign: 'center', fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>
          {t('signup.noInvite')}
        </p>
        <button type="button" className="link-quiet" style={{ justifySelf: 'center' }} onClick={onLogIn}>
          {t('signup.haveAccount')}
        </button>
      </form>
    </div>
  );
}
