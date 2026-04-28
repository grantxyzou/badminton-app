'use client';

import { useTranslations } from 'next-intl';
import { Tab } from '@/app/page';
import { isFlagOn } from '@/lib/flags';

interface Props {
  activeTab: Tab;
  onTabChange: (tab: Tab) => void;
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
 * All styling lives in `globals.css` (`.nav-tab`, `.nav-tab-icon`,
 * `.nav-tab-icon-active`, `.nav-tab-label`, `.nav-tab-active`). No inline
 * styles — the previous `style={{ background: 'transparent' }}` was silently
 * overriding the active-state class background.
 */
export default function BottomNav({ activeTab, onTabChange, showAdmin }: Props) {
  const t = useTranslations('nav');
  const recoveryFlag = isFlagOn('NEXT_PUBLIC_FLAG_RECOVERY');
  // When the recovery flag is on, Profile takes the 4th slot in the bar and
  // Admin becomes reachable via Profile → "Admin tools →" or `?tab=admin`
  // deep links. When off, original behavior (Admin in bar gated on showAdmin).
  const tabs: NavItem[] = recoveryFlag
    ? [
        { id: 'home',    label: t('home'),    icon: 'home' },
        { id: 'players', label: t('signups'), icon: 'group' },
        { id: 'skills',  label: t('skills'),  icon: 'bar_chart' },
        { id: 'profile', label: t('profile'), icon: 'person' },
      ]
    : [
        { id: 'home',    label: t('home'),    icon: 'home' },
        { id: 'players', label: t('signups'), icon: 'group' },
        { id: 'skills',  label: t('skills'),  icon: 'bar_chart' },
        { id: 'admin',   label: t('admin'),   icon: 'admin_panel_settings' },
      ];
  const visibleTabs = recoveryFlag
    ? tabs
    : tabs.filter((tab) => tab.id !== 'admin' || showAdmin);

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
