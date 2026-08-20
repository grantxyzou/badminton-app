'use client';

import { useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import PageHeader from '@/components/primitives/PageHeader';
import OverviewStrip from './OverviewStrip';

/**
 * Stats v2 shell — the You / Play / Learn / Gear arrangement.
 *
 * Deliberately a SEPARATE component from `StatsPlaceholder` rather than
 * another branch inside it. v1 already carries four mutually-exclusive
 * arrangements selected by five flags, and `bpm-stable` still runs one of
 * them; folding a fifth into that file would put the friend-facing path one
 * bad conditional away from the new work. The flag picks between the two
 * components in `SkillsTab`, and v1 is deleted wholesale in Stage 8.
 *
 * Differences from v1 that matter:
 *   - Always four registers. v1's `hasGear` / `hasPlay` / `assessMode`
 *     branching produced two- and three-tab variants, one of which was
 *     unreachable in production for about nine weeks without anyone noticing.
 *   - The overview strip sits above the switch and stays put across registers,
 *     so the headline numbers don't disappear when you go looking for detail.
 */

export type StatsView = 'you' | 'play' | 'learn' | 'gear';

const VIEWS: StatsView[] = ['you', 'play', 'learn', 'gear'];

export interface StatsV2ShellProps {
  activeName: string | null;
  youSlot?: ReactNode;
  playSlot?: ReactNode;
  learnSlot?: ReactNode;
  gearSlot?: ReactNode;
}

export default function StatsV2Shell({
  activeName,
  youSlot,
  playSlot,
  learnSlot,
  gearSlot,
}: StatsV2ShellProps) {
  const t = useTranslations('stats');
  const [view, setView] = useState<StatsView>('you');

  const slots: Record<StatsView, ReactNode> = {
    you: youSlot,
    play: playSlot,
    learn: learnSlot,
    gear: gearSlot,
  };

  return (
    <div className="space-y-5 w-full">
      {/* PageHeader must stay a direct child of the tall scroll root or its
          `position: sticky` un-sticks. Subhead is pinned tight to the title
          with an inline marginTop that beats the space-y-5 gap. */}
      <PageHeader>{t('heading')}</PageHeader>
      <p className="fs-md text-gray-400 px-2" style={{ marginTop: 4 }}>
        {t('subheadV2')}
      </p>

      <OverviewStrip activeName={activeName} />

      {/* Full width, unlike v1's `maxWidth: 360`. NOTE: `.segment-control` is
          shared with AdminTab (globals.css still calls it "Admin segment
          control"), so the width change is a per-use override here and must
          never become an edit to the shared class. */}
      <div className="segment-control flex w-full">
        {VIEWS.map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => setView(id)}
            aria-current={view === id ? 'page' : undefined}
            className={`flex-1 flex items-center justify-center fs-sm transition-all ${
              view === id ? 'segment-tab-active' : 'segment-tab-inactive'
            }`}
          >
            {t(`registers.${id}`)}
          </button>
        ))}
      </div>

      {/* Keyed by view so a register switch swaps content cleanly. Entrance
          motion is HomeShell's whole-tab fade — no per-card stagger, so Stats
          matches Home / Profile / Sign-Ups. */}
      <div key={view} className="space-y-5">
        {slots[view]}
      </div>
    </div>
  );
}
