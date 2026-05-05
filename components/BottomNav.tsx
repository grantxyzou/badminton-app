'use client';

import { useTranslations } from 'next-intl';
import { Tab } from '@/app/page';

interface Props {
  activeTab: Tab;
  onTabChange: (tab: Tab) => void;
  /**
   * When true, Admin appears as a 5th nav slot between Stats and Profile.
   * Computed in `app/page.tsx` from `/api/admin` cookie + `members.me.role`,
   * or via the 5-tap easter egg on the title.
   */
  showAdmin?: boolean;
}

type NavItem = { id: Tab; label: string; icon: string };

/**
 * Canonical per `docs/design-system/preview/19-bottom-nav.html` +
 * `ui_kits/bpm-app/components.jsx` BottomNav.
 *
 *   Container: glass pill, `inline-flex`, radius 16, 1px rim, padding 4/6/6.
 *   Tab:       `flex: 0 0 auto; min-width: 58px; padding: 5px 8px 3px`.
 *   Icon:      20px. Active tab uses FILL axis = 1 (filled); inactive = 0.
 *   Label:     11px / 500 (active 600) / tracking 0.01em / line-height 1.1.
 *   Active:    tinted pill background (`--nav-tab-active-bg`) + 1px green
 *              rim + color swap (`--nav-active-color`) + filled icon.
 *
 * All styling lives in `globals.css`.
 *
 * Slot count: 4 by default (Home, Sign-Ups, Stats, Profile); 5 when
 * `showAdmin` is true (Admin inserted between Stats and Profile). Admin sits
 * adjacent to Profile because both are management surfaces — Stats and the
 * three primary tabs stay grouped on the left.
 */
export default function BottomNav({ activeTab, onTabChange, showAdmin = false }: Props) {
  const t = useTranslations('nav');
  const visibleTabs: NavItem[] = [
    { id: 'home',    label: t('home'),    icon: 'home' },
    { id: 'players', label: t('signups'), icon: 'group' },
    { id: 'skills',  label: t('skills'),  icon: 'bar_chart' },
    ...(showAdmin ? [{ id: 'admin' as Tab, label: t('admin'), icon: 'shield' }] : []),
    { id: 'profile', label: t('profile'), icon: 'person' },
  ];

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 nav-safe-area" aria-label="Primary navigation">
      <div className="max-w-lg mx-auto px-4 flex justify-center">
        <div className="nav-glass">
          {visibleTabs.map((tab) => {
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => onTabChange(tab.id)}
                aria-label={tab.label}
                aria-current={active ? 'page' : undefined}
                className={active ? 'nav-tab nav-tab-active' : 'nav-tab'}
              >
                <span
                  className={
                    active
                      ? 'material-icons nav-tab-icon nav-tab-icon-active'
                      : 'material-icons nav-tab-icon'
                  }
                  aria-hidden="true"
                >
                  {tab.icon}
                </span>
                <span className="nav-tab-label">{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
