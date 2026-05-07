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
import type { DevOverrides } from '@/components/DevPanel';
import type { Announcement } from '@/lib/types';
import { getIdentity, IDENTITY_EVENT } from '@/lib/identity';

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
  const [devMode, setDevMode] = useState(false);
  const [devOverrides, setDevOverrides] = useState<DevOverrides>({});
  const [profileSession, setProfileSession] = useState<{ id: string; label: string }>({ id: '', label: '' });
  const [demoMode, setDemoMode] = useState(false);

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
    Promise.all([
      fetch(`${BASE}/api/admin`).then(r => r.json()).catch(() => ({ authed: false })),
      (() => {
        const name = getIdentity()?.name ?? null;
        if (!name) return Promise.resolve({ role: 'member' });
        return fetch(`${BASE}/api/members/me?name=${encodeURIComponent(name)}`)
          .then(r => r.json()).catch(() => ({ role: 'member' }));
      })(),
    ]).then(([auth, member]) => {
      setShowAdmin(auth.authed === true || member.role === 'admin');
    });
  }, []);

  useEffect(() => {
    refreshAdminAccess();
    window.addEventListener(IDENTITY_EVENT, refreshAdminAccess);
    window.addEventListener('focus', refreshAdminAccess);
    return () => {
      window.removeEventListener(IDENTITY_EVENT, refreshAdminAccess);
      window.removeEventListener('focus', refreshAdminAccess);
    };
  }, [refreshAdminAccess]);

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

  // Reset tab if admin access is revoked
  useEffect(() => {
    if (activeTab === 'admin' && !showAdmin) setActiveTab('home');
  }, [showAdmin, activeTab]);

  // Expose the active tab to CSS so per-tab background variants can react
  // (e.g. Sign-Ups tab swaps the global aurora for 03 Court markings).
  useEffect(() => {
    document.documentElement.setAttribute('data-tab', activeTab);
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
          {activeTab === 'home' && <div key="home" className="animate-fadeIn"><HomeTab onTabChange={setActiveTab} onTitleTap={handleTitleTap} devOverrides={devMode ? devOverrides : undefined} initialAnnouncement={initialAnnouncement} /></div>}
          {activeTab === 'players' && <div key="players" className="animate-fadeIn"><PlayersTab /></div>}
          {activeTab === 'skills' && <div key="skills" className="animate-fadeIn"><SkillsTab isAdmin={showAdmin} onTabChange={setActiveTab} /></div>}
          {activeTab === 'admin' && showAdmin && <div key="admin" className="animate-fadeIn"><AdminTab /></div>}
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
