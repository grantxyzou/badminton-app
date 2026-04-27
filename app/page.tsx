'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import BottomNav from '@/components/BottomNav';
import HomeTab from '@/components/HomeTab';
import PlayersTab from '@/components/PlayersTab';
import AdminTab from '@/components/AdminTab';
import SkillsTab from '@/components/SkillsTab';
import GlassPhysics from '@/components/GlassPhysics';
import ThemeToggle from '@/components/ThemeToggle';
import LanguageToggle from '@/components/LanguageToggle';
import DevPanel, { type DevOverrides } from '@/components/DevPanel';
import { getIdentity } from '@/lib/identity';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH || '';

export type Tab = 'home' | 'players' | 'skills' | 'admin' | 'profile';

export default function Page() {
  const [activeTab, setActiveTab] = useState<Tab>('home');
  const [showAdmin, setShowAdmin] = useState(false);
  const [devMode, setDevMode] = useState(false);
  const [devOverrides, setDevOverrides] = useState<DevOverrides>({});

  useEffect(() => {
    if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('dev')) {
      setDevMode(true);
    }
  }, []);

  useEffect(() => {
    // Show admin tab if user has admin role OR already has a valid admin cookie
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

  // 5-tap easter egg on title to reveal admin tab
  const tapCount = useRef(0);
  const tapTimer = useRef<ReturnType<typeof setTimeout>>();

  const handleTitleTap = useCallback(() => {
    tapCount.current += 1;
    clearTimeout(tapTimer.current);
    if (tapCount.current >= 5) {
      tapCount.current = 0;
      setShowAdmin(true);
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
        <div className="max-w-lg mx-auto px-4 pt-6">
          {activeTab === 'home' && <div key="home" className="animate-fadeIn"><HomeTab onTabChange={setActiveTab} onTitleTap={handleTitleTap} devOverrides={devMode ? devOverrides : undefined} /></div>}
          {activeTab === 'players' && <div key="players" className="animate-fadeIn"><PlayersTab /></div>}
          {activeTab === 'skills' && <div key="skills" className="animate-fadeIn"><SkillsTab isAdmin={showAdmin} /></div>}
          {activeTab === 'admin' && showAdmin && <div key="admin" className="animate-fadeIn"><AdminTab /></div>}
        </div>
        {devMode && <DevPanel overrides={devOverrides} onChange={setDevOverrides} />}
        <BottomNav activeTab={activeTab} onTabChange={setActiveTab} showAdmin={showAdmin} />
      </div>
    </>
  );
}
