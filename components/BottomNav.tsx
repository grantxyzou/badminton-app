'use client';

import { Tab } from '@/app/page';

interface Props {
  activeTab: Tab;
  onTabChange: (tab: Tab) => void;
}

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'home', label: 'Home', icon: 'home' },
  { id: 'players', label: 'Players', icon: 'group' },
  { id: 'teams', label: 'Teams', icon: 'sports_tennis' },
  { id: 'admin', label: 'Admin', icon: 'admin_panel_settings' },
];

export default function BottomNav({ activeTab, onTabChange }: Props) {
  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50"
      style={{
        background: 'rgba(5, 15, 7, 0.92)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        borderTop: '1px solid rgba(74, 222, 128, 0.12)',
      }}
    >
      <div className="max-w-lg mx-auto flex">
        {TABS.map((tab) => {
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              className="flex-1 flex flex-col items-center py-3 gap-0.5 transition-colors"
              style={{ color: active ? '#4ade80' : 'rgba(255,255,255,0.35)' }}
            >
              <span className="material-icons" style={{ fontSize: 24 }}>
                {tab.icon}
              </span>
              <span className="text-xs font-medium">{tab.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
