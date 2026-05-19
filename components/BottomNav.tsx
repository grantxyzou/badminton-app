'use client';

import type { CSSProperties } from 'react';
import { useTranslations } from 'next-intl';
import { isFlagOn } from '@/lib/flags';
import type { Tab } from '@/components/HomeShell';

interface Props {
  activeTab: Tab;
  onTabChange: (tab: Tab) => void;
}

type NavItem = { id: Tab; label: string; icon: string };

/**
 * Bottom navigation. Two forms, gated by `NEXT_PUBLIC_FLAG_NAV_RAIL`:
 *
 *  • flag ON  (bpm-next + dev) → "Labeled Rail" (spec May 2026):
 *    full-width edge-attached bar capped to the max-w-lg content
 *    column, theme-aware, triple-signal active state (colour + tonal
 *    pill + bold weight). Styling: `.rail-*` + `--rail-*` in globals.css.
 *  • flag OFF (bpm-stable)     → legacy floating glass pill (`.nav-glass`
 *    / `.nav-tab*`). Unchanged; the safe rollback target until promoted.
 *
 * Both branches share the SAME contract: `{activeTab, onTabChange}` API,
 * the four `Tab` ids (`home · players · skills · profile` — `skills`
 * renders "Stats" via `nav.skills` for backcompat), i18n-driven labels,
 * `.material-icons` glyphs already in the Material Symbols subset, and
 * per-tab `aria-label` + `aria-current`. Slot count is always 4 — admin
 * is reached via Profile → "Admin tools →" or `?tab=admin`, never here.
 *
 * Retire per `lib/flags.ts` `plannedRemoval`: when the rail promotes to
 * stable, delete the flag, the OFF branch below, and the `.nav-glass`
 * family in globals.css (kept now for this branch + the /design route).
 */
export default function BottomNav({ activeTab, onTabChange }: Props) {
  const t = useTranslations('nav');
  const visibleTabs: NavItem[] = [
    { id: 'home',    label: t('home'),    icon: 'home' },
    { id: 'players', label: t('signups'), icon: 'group' },
    { id: 'skills',  label: t('skills'),  icon: 'bar_chart' },
    { id: 'profile', label: t('profile'), icon: 'person' },
  ];

  if (isFlagOn('NEXT_PUBLIC_FLAG_NAV_RAIL')) {
    // Active index drives the shared sliding indicator (--ri). findIndex
    // is always 0–3 for a valid Tab; Math.max guards the -1 edge.
    const activeIndex = Math.max(
      0,
      visibleTabs.findIndex((tb) => tb.id === activeTab),
    );
    return (
      <nav
        className="rail-bar"
        aria-label="Primary navigation"
        style={{ '--ri': activeIndex } as CSSProperties}
      >
        <span className="rail-indicator" aria-hidden="true">
          <span className="rail-indicator-pill" />
        </span>
        {visibleTabs.map((tab) => {
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onTabChange(tab.id)}
              aria-label={tab.label}
              aria-current={active ? 'page' : undefined}
              className={active ? 'rail-tab rail-tab-active' : 'rail-tab'}
            >
              <span className="rail-icon-wrap">
                <span className="material-icons rail-icon" aria-hidden="true">
                  {tab.icon}
                </span>
              </span>
              <span className="rail-label">{tab.label}</span>
            </button>
          );
        })}
      </nav>
    );
  }

  // ── Legacy floating glass pill — bpm-stable until the rail promotes ──
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
