'use client';

import { Tab } from '@/app/page';

interface Props {
  activeTab: Tab;
  onTabChange: (tab: Tab) => void;
  showAdmin?: boolean;
}

const TABS: { id: Tab; label: string; icon?: string; textLines?: string[] }[] = [
  { id: 'home', label: 'Home', icon: 'home' },
  { id: 'players', label: 'Sign-Ups', icon: 'group' },
  { id: 'skills', label: 'Coming Soon', textLines: ['Coming', 'Soon'] },
  { id: 'admin', label: 'Admin', icon: 'admin_panel_settings' },
];

export default function BottomNav({ activeTab, onTabChange, showAdmin }: Props) {
  const visibleTabs = TABS.filter(tab => tab.id !== 'admin' || showAdmin);
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 pb-5">
      <div className="max-w-lg mx-auto px-4">
      <div className="nav-glass flex px-2 py-1.5">
        {visibleTabs.map((tab) => {
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              aria-label={tab.label}
              aria-current={active ? 'page' : undefined}
              className={`flex-1 flex flex-col items-center justify-center py-2.5 gap-0.5 transition-all rounded-xl ${active ? 'nav-tab-active' : ''}`}
              style={{ color: active ? 'var(--nav-active-color)' : 'var(--nav-inactive-color)' }}
            >
              {tab.icon ? (
                <>
                  <span className="material-icons" aria-hidden="true" style={{ fontSize: 24 }}>
                    {tab.icon}
                  </span>
                  <span className="text-xs font-medium" aria-hidden="true">{tab.label}</span>
                </>
              ) : (
                <span className="text-[9px] font-medium leading-snug text-center tracking-wide uppercase opacity-70" aria-hidden="true">
                  {tab.textLines?.map((line, i) => (
                    <span key={i} className="block">{line}</span>
                  ))}
                </span>
              )}
            </button>
          );
        })}
      </div>
      </div>
    </nav>
  );
}
