'use client';

import type { CSSProperties } from 'react';
import { useTranslations } from 'next-intl';
import type { Tab } from '@/components/HomeShell';

interface Props {
  activeTab: Tab;
  onTabChange: (tab: Tab) => void;
}

type NavItem = { id: Tab; label: string; icon: string };

/**
 * Bottom navigation — the "Labeled Rail" (spec May 2026).
 *
 * Full-width edge-attached bar capped to the max-w-lg content column,
 * theme-aware, with a triple-signal active state (colour + tonal pill + bold
 * weight) because colour alone is not a signal. Styling lives in `.rail-*` /
 * `--rail-*` in globals.css.
 *
 * The four `Tab` ids are `home · players · skills · profile` — `skills`
 * renders "Stats" via the `nav.skills` key, kept for backcompat. Slot count is
 * always 4: admin is reached via Profile → "Admin tools →" or `?tab=admin`,
 * never from here.
 *
 * Until 2026-08-29 this had a second branch behind NEXT_PUBLIC_FLAG_NAV_RAIL —
 * a legacy floating glass pill kept as a rollback target for a `bpm-stable`
 * deployment that was deleted on 2026-08-25. It was three months past its
 * removal date, untested against every change since, and unreachable.
 */
export default function BottomNav({ activeTab, onTabChange }: Props) {
  const t = useTranslations('nav');
  const visibleTabs: NavItem[] = [
    { id: 'home',    label: t('home'),    icon: 'home' },
    { id: 'players', label: t('signups'), icon: 'group' },
    { id: 'skills',  label: t('skills'),  icon: 'bar_chart' },
    { id: 'profile', label: t('profile'), icon: 'person' },
  ];

  // Admin is a sub-screen of Profile (opened from "Admin tools →", exits back
  // to it), not its own nav slot — so the nav highlights Profile while inside
  // Admin instead of falling back to Home (findIndex -1 → Math.max → index 0).
  const navTab: Tab = activeTab === 'admin' ? 'profile' : activeTab;

  // Active index drives the shared sliding indicator (--ri). findIndex
  // is always 0–3 for a valid navTab; Math.max guards the -1 edge.
  const activeIndex = Math.max(
    0,
    visibleTabs.findIndex((tb) => tb.id === navTab),
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
        const active = navTab === tab.id;
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
