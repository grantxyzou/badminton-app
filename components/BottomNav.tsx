'use client';

import { Tab } from '@/app/page';

interface Props {
  activeTab: Tab;
  onTabChange: (tab: Tab) => void;
}

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'home', label: 'Home', icon: 'home' },
  { id: 'players', label: 'Sign-Ups', icon: 'group' },
  { id: 'admin', label: 'Admin', icon: 'admin_panel_settings' },
];

export default function BottomNav({ activeTab, onTabChange }: Props) {
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 pb-5">
      <div className="max-w-lg mx-auto px-4">
      <div className="nav-glass flex px-2 py-1.5">
        {TABS.map((tab) => {
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              aria-label={tab.label}
              aria-current={active ? 'page' : undefined}
              className={`flex-1 flex flex-col items-center py-2.5 gap-0.5 transition-all rounded-xl ${active ? 'nav-tab-active' : ''}`}
              style={{ color: active ? '#4ade80' : 'rgba(255,255,255,0.5)' }}
            >
              <span className="material-icons" aria-hidden="true" style={{ fontSize: 24 }}>
                {tab.icon}
              </span>
              <span className="text-xs font-medium" aria-hidden="true">{tab.label}</span>
            </button>
          );
        })}
      </div>
      </div>
    </nav>
  );
}
