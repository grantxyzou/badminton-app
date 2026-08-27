'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import ChooseNameSheet from './auth/ChooseNameSheet';
import ResetPasswordSheet from './auth/ResetPasswordSheet';
import BottomNav from '@/components/BottomNav';
import HomeTab from '@/components/HomeTab';
import PlayersTab from '@/components/PlayersTab';
import SkillsTab from '@/components/SkillsTab';
import ProfileTab from '@/components/ProfileTab';
import GlassPhysics from '@/components/GlassPhysics';
import ThemeToggle from '@/components/ThemeToggle';
import LanguageToggle from '@/components/LanguageToggle';
import StatusBanner from '@/components/primitives/StatusBanner';
import AdminErrorBoundary from '@/components/AdminErrorBoundary';
import PullToRefresh from '@/components/PullToRefresh';
import type { DevOverrides } from '@/components/DevPanel';
import type { Announcement } from '@/lib/types';
import { getIdentity, setIdentity, IDENTITY_EVENT } from '@/lib/identity';
import { noticeBanner, noticeTimeoutMs, type AuthNotice } from '@/lib/authNotice';
import { useOnline, useReportFetchFailure } from '@/lib/useOnline';
import { consumeRecentExcursion } from '@/lib/excursion';

// AdminTab + DemoMode + DevPanel are lazy-loaded — most users never trigger
// these surfaces (admin requires sign-in, DemoMode is URL-gated, DevPanel
// is `?dev`-gated), so eager-importing them was bloating the initial JS
// bundle for everyone. Lighthouse flagged ~100 KB of unused JS in the home
// payload; this is the cheap chunk of that.
const AdminTab = dynamic(() => import('@/components/AdminTab'), { ssr: false });
const DevPanel = dynamic(() => import('@/components/DevPanel'), { ssr: false });
const DemoMode = dynamic(() => import('@/components/DemoMode'), { ssr: false });

const BASE = process.env.NEXT_PUBLIC_BASE_PATH || '';

export type Tab = 'home' | 'players' | 'skills' | 'admin' | 'profile';

interface Props {
  /**
   * Pre-fetched on the server in `app/page.tsx` so the announcement (the
   * Lighthouse-measured LCP element on Home) is in the initial HTML
   * payload rather than waiting on a client-side fetch after hydration.
   * HomeTab will refresh in the background via its existing useEffect.
   */
  initialAnnouncement: Announcement | null;
}

export default function HomeShell({ initialAnnouncement }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>('home');
  // Bumped by pull-to-refresh — folded into each tab's React key so the active
  // tab remounts and re-runs its data fetches (no service worker; refresh ==
  // refetch the current view).
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [showAdmin, setShowAdmin] = useState(false);
  // Tri-state: `showAdmin` alone can't tell "confirmed not-admin" from
  // "not determined yet". On a reload landing on ?tab=admin, the bounce
  // effect would fire on the initial `false` BEFORE the async probe
  // resolves — kicking you off the tab you were on. Only bounce once the
  // verdict is actually KNOWN (a successful probe), never on the unknown.
  const [adminKnown, setAdminKnown] = useState(false);
  const [devMode, setDevMode] = useState(false);
  const [devOverrides, setDevOverrides] = useState<DevOverrides>({});
  const [profileSession, setProfileSession] = useState<{ id: string; label: string }>({ id: '', label: '' });
  // Set when a provider callback bounced back with ?authFlow=name -- i.e. an
  // authenticated provider identity with no member yet. The verified provider
  // facts live in a signed, HttpOnly cookie the client cannot read; all this
  // flag does is decide whether to show the name prompt.
  const [chooseNameOpen, setChooseNameOpen] = useState(false);
  /**
   * What to say after an auth redirect. One notice at a time: our own redirects
   * only ever carry one result, so last-write-wins is fine and simpler than a
   * queue nobody would see the back of.
   */
  const [authNotice, setAuthNotice] = useState<AuthNotice | null>(null);
  /** Set by `?signedIn=1`; consumed once by the whoami effect below. */
  const [signedInPending, setSignedInPending] = useState<{
    provider: 'google' | 'apple' | null;
  } | null>(null);
  /** Set by `?reset=<token>`; opens the set-a-new-password sheet. */
  const [resetRequest, setResetRequest] = useState<{ token: string; email: string } | null>(null);
  /**
   * The active session id, readable from an async callback without adding it to
   * a dependency array. Mirrors `profileSession.id`.
   */
  const sessionIdRef = useRef('');
  /** Guards the once-only whoami fetch. See the effect below. */
  const signedInHandledRef = useRef(false);
  const [demoMode, setDemoMode] = useState(false);
  // KNOWN-refused, never merely unknown: set only by an actual 403 from an
  // owner-gated read (see the insight prewarm below), cleared by any other
  // outcome. A network failure must not raise it — that is the offline
  // banner's job, and telling someone to sign in again over a dropped wifi
  // packet is the same class of lie as a lying empty state.
  const [signInExpired, setSignInExpired] = useState(false);
  // Connectivity is one app-wide signal now (lib/useOnline). `online` is
  // "server believed reachable" — NEVER conflated with "user is not an
  // admin": a failed probe must not masquerade as a confirmed negative
  // (the auth twin of the forbidden `catch { setX([]) }` lying-empty).
  const online = useOnline();
  const reportFetchFailure = useReportFetchFailure();
  // Only the sign-in-expired banner is translated here; the adjacent offline
  // banner predates this and stays as it is (not this task's file to churn).
  const t = useTranslations('stats');
  const tAuth = useTranslations('profile.auth');

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.has('dev')) setDevMode(true);

    // ── Auth redirect results ────────────────────────────────────────────
    // ALL of these must be read BEFORE the tab-precedence branches below,
    // which `return` early — a `?tab=profile&authError=…` landing would
    // otherwise drop the notice on the floor.
    //
    // One `cleaned` URL and one replaceState for the whole group, so the
    // deletions cannot clobber each other.
    const cleaned = new URL(window.location.href);
    let dirty = false;

    // A provider identity with no member yet: collect a display name.
    if (params.get('authFlow') === 'name') {
      setChooseNameOpen(true);
      cleaned.searchParams.delete('authFlow');
      dirty = true;
    }

    // A provider sign-in that already resolved to a member. The name is NOT in
    // the URL — the whoami effect below asks the server for it.
    if (params.get('signedIn') === '1') {
      const p = params.get('provider');
      setSignedInPending({ provider: p === 'google' || p === 'apple' ? p : null });
      cleaned.searchParams.delete('signedIn');
      cleaned.searchParams.delete('provider');
      dirty = true;
    }

    const failure = params.get('authError');
    if (failure) {
      setAuthNotice({ kind: 'authError', reason: failure });
      cleaned.searchParams.delete('authError');
      dirty = true;
    }

    const verified = params.get('verified');
    if (verified === '1' || verified === '0') {
      setAuthNotice({ kind: verified === '1' ? 'verified' : 'notVerified' });
      cleaned.searchParams.delete('verified');
      dirty = true;
    }

    // A LIVE CREDENTIAL in the URL. Stripping it is not cosmetic: the iOS PWA
    // restores the last URL on cold launch, the share sheet would copy it, and
    // it would sit in history. `email` is only removed alongside `reset` —
    // on its own it is a generic param name that could belong to a deep link.
    const resetToken = params.get('reset');
    if (resetToken) {
      setResetRequest({ token: resetToken, email: params.get('email') ?? '' });
      cleaned.searchParams.delete('reset');
      cleaned.searchParams.delete('email');
      dirty = true;
    }

    if (dirty) window.history.replaceState(window.history.state, '', cleaned);

    const isTab = (v: string | null): v is Tab =>
      v === 'home' || v === 'players' || v === 'skills' || v === 'admin' || v === 'profile';

    // Precedence: explicit ?tab= deep-link → restored last tab → Home default.
    const tabParam = params.get('tab');
    if (isTab(tabParam)) {
      setActiveTab(tabParam);
      // Strip the param after applying so it doesn't linger in the URL the iOS
      // PWA restores on cold start (which would then override the Home default).
      const url = new URL(window.location.href);
      url.searchParams.delete('tab');
      window.history.replaceState(window.history.state, '', url);
      return;
    }
    // Restore the last tab on an in-app reload, but NOT on a quit/cold start.
    // sessionStorage is the exact discriminator: it survives a soft reload
    // (same page session) but is cleared when the PWA is fully quit and
    // relaunched — so a cold start finds nothing here and stays on Home.
    try {
      const saved = window.sessionStorage.getItem('badminton_active_tab');
      if (isTab(saved)) { setActiveTab(saved); return; }
    } catch { /* sessionStorage unavailable — fall back to Home */ }
    // Cold start (sessionStorage empty). If we got here because iOS evicted the
    // PWA while the user stepped out to a share sheet / receipt image (marked
    // via markExternalExcursion), restore where they were instead of Home. A
    // real quit-and-reopen leaves no marker → stays on Home.
    try {
      if (consumeRecentExcursion()) {
        const lastTab = window.localStorage.getItem('badminton_last_tab');
        if (isTab(lastTab)) setActiveTab(lastTab);
      }
    } catch { /* localStorage unavailable — fall back to Home */ }
  }, []);

  // Fetch enough session info for ProfileTab's session label + recovery sheet.
  // ProfileTab is allowed to render with empty values (anonymous state).
  /**
   * `?signedIn=1` landed: ask the server who we are and mirror it into
   * localStorage, which is what ProfileTab/HomeTab actually read.
   *
   * WHY `sessionIdRef.current` MAY BE '' AND THAT IS CORRECT
   * -------------------------------------------------------
   * `resolveStaleIdentity` short-circuits on an empty `sessionId`
   * (`if (!stored || !stored.sessionId) return {action:'keep'}`), so a blank one
   * is never treated as stale — and it is the honest value for a returning
   * member who has not signed up for this week yet. `ChooseNameSheet.finish()`
   * already writes exactly this shape.
   *
   * The instinct on review is to "fix" this by awaiting /api/session first.
   * Do not: a hung or failing session fetch would mean identity never lands,
   * which is the very bug this effect exists to close. A WRONG sessionId is the
   * dangerous value, not an absent one.
   *
   * Free consequence: `setIdentity` dispatches IDENTITY_EVENT, so the admin
   * probe and insight prewarm below both re-run — an admin signing in with
   * Google gets the Admin tab with no reload.
   */
  useEffect(() => {
    if (!signedInPending || signedInHandledRef.current) return;
    // A REF, not `setSignedInPending(null)`. Clearing the state here would
    // change this effect's own dependency, so React would run the cleanup
    // below — setting `cancelled` — before the fetch resolved, and the answer
    // would be discarded every time. The ref makes it once-only without
    // invalidating the effect, so the cleanup fires on unmount alone.
    signedInHandledRef.current = true;
    const provider = signedInPending.provider;
    let cancelled = false;
    fetch(`${BASE}/api/auth/me`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled) return;
        if (d?.signedIn === true && typeof d.name === 'string' && d.name) {
          setIdentity({ name: d.name, sessionId: sessionIdRef.current });
          setAuthNotice({ kind: 'signedIn', provider });
          return;
        }
        if (d?.signedIn === false) {
          // KNOWN signed-out despite the redirect — usually the session cookie
          // not surviving the cross-site hop. Worth saying; it is not the
          // expected path.
          setAuthNotice({ kind: 'signInUnconfirmed' });
        }
        // `signedIn === null` (throttled) or a non-OK response is UNKNOWN:
        // write nothing, say nothing, and leave any existing identity alone.
      })
      .catch(() => {
        // Network failure is unknown too — the offline banner owns that story.
      });
    return () => {
      cancelled = true;
    };
  }, [signedInPending]);

  /** Notices are transient: good news clears sooner than bad. */
  useEffect(() => {
    if (!authNotice) return;
    const id = setTimeout(() => setAuthNotice(null), noticeTimeoutMs(authNotice));
    return () => clearTimeout(id);
  }, [authNotice]);

  useEffect(() => {
    fetch(`${BASE}/api/session`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((s: { id?: string; datetime?: string }) => {
        if (!s?.id) return;
        const label = s.datetime
          ? new Date(s.datetime).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
          : '';
        sessionIdRef.current = s.id;
        setProfileSession({ id: s.id, label });
      })
      .catch(() => undefined);
  }, []);

  // Show admin tab if user has admin role OR already has a valid admin cookie.
  // Re-runs on mount, after any identity change (sign-in / sign-out from any
  // component), and on window focus (covers cross-tab sign-out and admin-cookie
  // expiry while the tab was backgrounded).
  const refreshAdminAccess = useCallback(() => {
    let netFailed = false;
    const NET_FAIL = Symbol('net-fail');
    Promise.all([
      fetch(`${BASE}/api/admin`).then(r => r.json()).catch(() => NET_FAIL),
      (() => {
        const name = getIdentity()?.name ?? null;
        if (!name) return Promise.resolve({ role: 'member' });
        return fetch(`${BASE}/api/members/me?name=${encodeURIComponent(name)}`)
          .then(r => r.json()).catch(() => NET_FAIL);
      })(),
    ]).then(([auth, member]) => {
      // A network failure on EITHER probe means we can't make an
      // authoritative admin decision. Preserve last-known showAdmin and
      // flag offline — never downgrade to not-admin on an unverifiable
      // signal (that's what bounced users out of /admin on a wifi blip).
      if (auth === NET_FAIL || member === NET_FAIL) {
        netFailed = true;
        reportFetchFailure();
        return; // preserve last-known showAdmin — do NOT downgrade
      }
      setShowAdmin(
        (auth as { authed?: boolean }).authed === true ||
        (member as { role?: string }).role === 'admin',
      );
      setAdminKnown(true); // verdict is now authoritative
    }).catch(() => {
      if (!netFailed) reportFetchFailure();
    });
  }, [reportFetchFailure]);

  useEffect(() => {
    refreshAdminAccess();
    // The offline *signal* is owned by OnlineProvider now. HomeShell only
    // still needs to RE-CONFIRM the admin verdict when connectivity or
    // identity changes (a cookie may have expired while offline).
    window.addEventListener(IDENTITY_EVENT, refreshAdminAccess);
    window.addEventListener('focus', refreshAdminAccess);
    window.addEventListener('online', refreshAdminAccess);
    return () => {
      window.removeEventListener(IDENTITY_EVENT, refreshAdminAccess);
      window.removeEventListener('focus', refreshAdminAccess);
      window.removeEventListener('online', refreshAdminAccess);
    };
  }, [refreshAdminAccess]);

  // Passive insight pre-warm: on first app entry for a logged-in account,
  // fire-and-forget the insight endpoint so the account-gated recap+focus are
  // generated/cached server-side BEFORE the user reaches the Stats tab. The
  // endpoint dedupes by (member, active session), so this is at most one Claude
  // call per member per session-cycle no matter how often it's pinged. No CTA.
  //
  // Fire-and-forget for network failures ONLY. A 403 is not a failed prewarm,
  // it is the server saying this device does not own the identity in
  // localStorage — the `member_session` cookie (30-day TTL) expired or was
  // never minted, while `badminton_identity` persists indefinitely. Every
  // owner-gated Stats read will refuse for the same reason, and swallowing it
  // here left the member with no signal anywhere: cards that used to have
  // content simply stopped having any. Unknown ≠ known-false, so only the
  // KNOWN refusal raises the banner; a network error leaves it alone.
  useEffect(() => {
    function prewarmInsight() {
      const name = getIdentity()?.name;
      if (!name) {
        setSignInExpired(false);
        return;
      }
      fetch(`${BASE}/api/stats/insight?name=${encodeURIComponent(name)}`, { cache: 'no-store' })
        .then((r) => setSignInExpired(r.status === 403))
        .catch(() => {
          /* network failure — unknown, not a refusal. The offline banner owns
             this case and the Stats cards retry on view. */
        });
    }
    prewarmInsight();
    window.addEventListener(IDENTITY_EVENT, prewarmInsight);
    return () => window.removeEventListener(IDENTITY_EVENT, prewarmInsight);
  }, []);

  // 7-tap easter egg on title — opens the demo mode overlay. (Previously
  // unlocked admin, but admin now flows through Profile sign-in for actual
  // admins; the easter egg's role is curiosity/preview, not privilege.)
  const tapCount = useRef(0);
  // React 19's types dropped the argless `useRef<T>()` overload — an initial
  // value is now required, so the type has to admit `undefined` explicitly.
  const tapTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const handleTitleTap = useCallback(() => {
    tapCount.current += 1;
    clearTimeout(tapTimer.current);
    if (tapCount.current >= 7) {
      tapCount.current = 0;
      setDemoMode(true);
    } else {
      tapTimer.current = setTimeout(() => { tapCount.current = 0; }, 2000);
    }
  }, []);

  // Reset tab only on a KNOWN loss of admin access — never on the
  // not-yet-determined initial state (that race ate the admin tab on
  // reload before the probe could resolve).
  useEffect(() => {
    if (activeTab === 'admin' && adminKnown && !showAdmin) setActiveTab('home');
  }, [showAdmin, adminKnown, activeTab]);

  // Expose the active tab to CSS so per-tab background variants can react
  // (e.g. Sign-Ups tab swaps the global aurora for 03 Court markings).
  useEffect(() => {
    document.documentElement.setAttribute('data-tab', activeTab);
    // Persist to sessionStorage (NOT the URL): an in-app reload restores the
    // last tab, but a quit/cold start clears sessionStorage and lands on Home.
    // Writing it to the URL instead would defeat that — the iOS PWA restores
    // the last URL on cold start, so it would reopen on the last tab.
    try {
      window.sessionStorage.setItem('badminton_active_tab', activeTab);
      // Also mirror to localStorage — sessionStorage is wiped if iOS evicts the
      // PWA during an external excursion (share sheet / receipt image); the
      // localStorage copy is what consumeRecentExcursion() restores from.
      window.localStorage.setItem('badminton_last_tab', activeTab);
    } catch { /* storage unavailable — restore just won't persist */ }
    return () => {
      // Fallback — if the page unmounts, leave the attribute cleared so any
      // future /design preview routes don't inherit a stale tab value.
      document.documentElement.removeAttribute('data-tab');
    };
  }, [activeTab]);

  // Pull-to-refresh: remount the active tab (refetches everything) and hold the
  // spinner briefly so the gesture gets visible feedback even on a fast network.
  const handlePullRefresh = useCallback(async () => {
    setRefreshNonce((n) => n + 1);
    await new Promise((r) => setTimeout(r, 600));
  }, []);

  return (
    <>
      <PullToRefresh onRefresh={handlePullRefresh} />
      <div className="min-h-screen pb-32">
        <GlassPhysics />
        <ThemeToggle />
        <LanguageToggle />
        <main data-page-shell className="max-w-lg mx-auto px-4 pt-6">
          {!online && (
            <div className="mb-3">
              <StatusBanner
                tone="warn"
                icon="warning"
                title="You're offline"
                body="Showing your last-known view. Some data may be stale until you reconnect."
              />
            </div>
          )}
          {signInExpired && online && (
            <div className="mb-3">
              <StatusBanner
                tone="warn"
                icon="lock_clock"
                title={t('signInAgainTitle')}
                body={t('signInAgainBody')}
              />
            </div>
          )}
          {authNotice && (
            <div className="mb-3">
              <StatusBanner
                tone={noticeBanner(authNotice).tone}
                icon={noticeBanner(authNotice).icon}
                title={tAuth(noticeBanner(authNotice).titleKey)}
                body={tAuth(noticeBanner(authNotice).bodyKey)}
                celebrate={noticeBanner(authNotice).celebrate}
              />
            </div>
          )}
          {activeTab === 'home' && <div key={`home-${refreshNonce}`} className="animate-fadeIn"><HomeTab onTabChange={setActiveTab} onTitleTap={handleTitleTap} devOverrides={devMode ? devOverrides : undefined} initialAnnouncement={initialAnnouncement} /></div>}
          {activeTab === 'players' && <div key={`players-${refreshNonce}`} className="animate-fadeIn"><PlayersTab onTabChange={setActiveTab} /></div>}
          {activeTab === 'skills' && <div key={`skills-${refreshNonce}`} className="animate-fadeIn"><SkillsTab onTabChange={setActiveTab} /></div>}
          {activeTab === 'admin' && showAdmin && <div key={`admin-${refreshNonce}`} className="animate-fadeIn"><AdminErrorBoundary><AdminTab onExit={() => setActiveTab('profile')} /></AdminErrorBoundary></div>}
          {activeTab === 'profile' && (
            <div key={`profile-${refreshNonce}`} className="animate-fadeIn">
              <ProfileTab
                sessionId={profileSession.id}
                sessionLabel={profileSession.label}
                isAdmin={showAdmin}
                onAdminTools={() => setActiveTab('admin')}
              />
            </div>
          )}
        </main>
        {devMode && <DevPanel overrides={devOverrides} onChange={setDevOverrides} />}
        <BottomNav activeTab={activeTab} onTabChange={setActiveTab} />
      </div>
      {demoMode && <DemoMode onClose={() => setDemoMode(false)} />}
      {/* Mounted at shell level, not inside a tab: the provider callback lands
          on whatever tab the app restores, and the name prompt has to appear
          regardless of which one that is. */}
      {/* Keyed on open so the sheet REMOUNTS each time: mode, PIN field and
          error all reset without setState-in-effect. */}
      <ChooseNameSheet
        key={chooseNameOpen ? 'choose-name-open' : 'choose-name-closed'}
        open={chooseNameOpen}
        onClose={() => setChooseNameOpen(false)}
        sessionId={profileSession.id}
      />
      {/* Shell level for the same reason as ChooseNameSheet: a reset link lands
          on /bpm at whatever tab the app restores. Keyed so the fields reset on
          each open rather than via setState-in-effect. */}
      <ResetPasswordSheet
        key={resetRequest ? 'reset-open' : 'reset-closed'}
        open={!!resetRequest}
        request={resetRequest}
        sessionId={profileSession.id}
        onClose={() => setResetRequest(null)}
        onDone={() => {
          setResetRequest(null);
          setAuthNotice({ kind: 'passwordReset' });
        }}
        onNeedNewLink={() => {
          setResetRequest(null);
          setActiveTab('profile');
        }}
      />
    </>
  );
}
