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
 *   Label:     9.5px / 500 / tracking 0.01em / line-height 1.1.
 *   Active:    color-only (`--nav-active-color`). No background pill.
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
      <div className="max-w-lg mx-auto px-4" style={{ display: 'flex', justifyContent: 'center' }}>
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
                className={active ? 'nav-tab-active' : undefined}
                style={{
                  flex: '0 0 auto',
                  minWidth: 58,
                  padding: '5px 8px 3px',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 2,
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  color: active ? 'var(--nav-active-color)' : 'var(--nav-inactive-color)',
                  transition: 'color 150ms var(--ease-glass)',
                }}
              >
                <span
                  className="material-icons"
                  aria-hidden="true"
                  style={{
                    fontSize: 20,
                    lineHeight: 1,
                    opacity: 1,
                    // Material Symbols variable-font: flip the FILL axis on the
                    // active tab so the glyph reads as filled vs. outlined.
                    fontVariationSettings: active
                      ? "'opsz' 24, 'wght' 500, 'FILL' 1, 'GRAD' 0"
                      : "'opsz' 24, 'wght' 400, 'FILL' 0, 'GRAD' 0",
                  }}
                >
                  {tab.icon}
                </span>
                <span
                  style={{
                    fontSize: 9.5,
                    fontWeight: 500,
                    letterSpacing: '0.01em',
                    lineHeight: 1.1,
                  }}
                >
                  {tab.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
