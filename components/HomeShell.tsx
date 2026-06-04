'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import dynamic from 'next/dynamic';
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
import type { DevOverrides } from '@/components/DevPanel';
import type { Announcement } from '@/lib/types';
import { getIdentity, IDENTITY_EVENT } from '@/lib/identity';
import { useOnline, useReportFetchFailure } from '@/lib/useOnline';

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
  const [demoMode, setDemoMode] = useState(false);
  // Connectivity is one app-wide signal now (lib/useOnline). `online` is
  // "server believed reachable" — NEVER conflated with "user is not an
  // admin": a failed probe must not masquerade as a confirmed negative
  // (the auth twin of the forbidden `catch { setX([]) }` lying-empty).
  const online = useOnline();
  const reportFetchFailure = useReportFetchFailure();

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.has('dev')) setDevMode(true);
    const tabParam = params.get('tab');
    if (tabParam === 'home' || tabParam === 'players' || tabParam === 'skills' || tabParam === 'admin' || tabParam === 'profile') {
      setActiveTab(tabParam);
    }
  }, []);

  // Fetch enough session info for ProfileTab's session label + recovery sheet.
  // ProfileTab is allowed to render with empty values (anonymous state).
  useEffect(() => {
    fetch(`${BASE}/api/session`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((s: { id?: string; datetime?: string }) => {
        if (!s?.id) return;
        const label = s.datetime
          ? new Date(s.datetime).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
          : '';
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
  useEffect(() => {
    function prewarmInsight() {
      const name = getIdentity()?.name;
      if (!name) return;
      fetch(`${BASE}/api/stats/insight?name=${encodeURIComponent(name)}`, { cache: 'no-store' }).catch(() => {
        /* fire-and-forget — the Stats card will retry on view */
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
  const tapTimer = useRef<ReturnType<typeof setTimeout>>();

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
    // Persist the tab in the URL so a reload lands you back where you
    // were (the mount effect above already READS ?tab=). replaceState,
    // not push — switching tabs shouldn't pollute the back-stack — and
    // preserve any other params (?dev, ?tab=admin deep-link, etc.).
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      if (url.searchParams.get('tab') !== activeTab) {
        url.searchParams.set('tab', activeTab);
        window.history.replaceState(window.history.state, '', url);
      }
    }
    return () => {
      // Fallback — if the page unmounts, leave the attribute cleared so any
      // future /design preview routes don't inherit a stale tab value.
      document.documentElement.removeAttribute('data-tab');
    };
  }, [activeTab]);

  return (
    <>
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
          {activeTab === 'home' && <div key="home" className="animate-fadeIn"><HomeTab onTabChange={setActiveTab} onTitleTap={handleTitleTap} devOverrides={devMode ? devOverrides : undefined} initialAnnouncement={initialAnnouncement} /></div>}
          {activeTab === 'players' && <div key="players" className="animate-fadeIn"><PlayersTab /></div>}
          {activeTab === 'skills' && <div key="skills" className="animate-fadeIn"><SkillsTab isAdmin={showAdmin} onTabChange={setActiveTab} /></div>}
          {activeTab === 'admin' && showAdmin && <div key="admin" className="animate-fadeIn"><AdminErrorBoundary><AdminTab onExit={() => setActiveTab('profile')} /></AdminErrorBoundary></div>}
          {activeTab === 'profile' && (
            <div key="profile" className="animate-fadeIn">
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
    </>
  );
}
