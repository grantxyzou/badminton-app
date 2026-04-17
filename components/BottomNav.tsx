'use client';

import { useTranslations } from 'next-intl';
import { Tab } from '@/app/page';

interface Props {
  activeTab: Tab;
  onTabChange: (tab: Tab) => void;
  showAdmin?: boolean;
}

type NavItem = { id: Tab; label: string; icon?: string; stack?: boolean };

export default function BottomNav({ activeTab, onTabChange, showAdmin }: Props) {
  const t = useTranslations('nav');
  const tabs: NavItem[] = [
    { id: 'home', label: t('home'), icon: 'home' },
    { id: 'players', label: t('signups'), icon: 'group' },
    { id: 'skills', label: t('skills'), stack: true },
    { id: 'admin', label: t('admin'), icon: 'admin_panel_settings' },
  ];
  const visibleTabs = tabs.filter((tab) => tab.id !== 'admin' || showAdmin);
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 nav-safe-area">
      <div className="max-w-lg mx-auto px-4">
      <div className="nav-glass flex px-2 py-1.5">
        {visibleTabs.map((tab) => {
          const active = activeTab === tab.id;
          const lines = tab.stack && tab.label.includes(' ') ? tab.label.split(' ') : null;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onTabChange(tab.id)}
              aria-label={tab.label}
              aria-current={active ? 'page' : undefined}
              className={`flex-1 flex flex-col items-center justify-center py-2.5 gap-0.5 transition-all active:scale-95 rounded-xl ${active ? 'nav-tab-active' : ''}`}
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
                  {lines ? (
                    lines.map((line, i) => (
                      <span key={i} className="block">{line}</span>
                    ))
                  ) : (
                    <span className="block">{tab.label}</span>
                  )}
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
