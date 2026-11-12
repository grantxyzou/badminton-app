'use client';

import { useState, type ReactNode, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import PageHeader from '@/components/primitives/PageHeader';
import RegisterSwitch from '@/components/primitives/RegisterSwitch';
import OverviewStrip from './OverviewStrip';
import { StatsRegisterContext, StatsTakeoverContext } from './statsTakeover';
import type { UseCheckIn } from './useCheckIn';

/**
 * Stats v2 shell — the You / Equipment / Play / Learn arrangement.
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

/** Equipment second (Grant, Stats canvas, 2026-10-19): after You, the register
 *  members come back to most. Play and Learn follow. */
const VIEWS: StatsView[] = ['you', 'gear', 'play', 'learn'];

export interface StatsV2ShellProps {
  activeName: string | null;
  /** The check-in owner, forwarded to `OverviewStrip` so the level tile can be
   *  a door from EVERY register. The shell holds no state of its own beyond the
   *  register switch and does not gain any here — it only passes this through. */
  checkIn?: UseCheckIn;
  youSlot?: ReactNode;
  /** The card that leads You (the greeting), placed by the shell rather than
   *  inside the register: on one screen it sits exactly where the register's
   *  first card would, and on an unfolded phone it moves to the left page,
   *  under the tiles (Grant, 2026-11-12, "move the greeting to the left"). It
   *  must be a single element carrying `stats-shell-lead`. */
  youLead?: ReactNode;
  playSlot?: ReactNode;
  learnSlot?: ReactNode;
  gearSlot?: ReactNode;
  /** A register to switch to when this changes — the tab arriving with
   *  something for one register (a score for Play, lib/gameIntent.ts). Null
   *  asks nothing; the member's own taps are untouched. */
  openView?: StatsView | null;
}

export default function StatsV2Shell({
  activeName,
  checkIn,
  youSlot,
  youLead,
  playSlot,
  learnSlot,
  gearSlot,
  openView = null,
}: StatsV2ShellProps) {
  const t = useTranslations('stats');
  const [view, setView] = useState<StatsView>('you');
  useEffect(() => {
    if (openView) setView(openView);
  }, [openView]);
  // A page inside a register (statsTakeover.ts) hides the chrome, not the
  // register: the register owns the page's data and must stay mounted.
  const [takeover, setTakeover] = useState(false);

  const slots: Record<StatsView, ReactNode> = {
    you: youSlot,
    play: playSlot,
    learn: learnSlot,
    gear: gearSlot,
  };

  return (
    <StatsTakeoverContext.Provider value={setTakeover}>
    <StatsRegisterContext.Provider value={setView}>
    {/* `stats-shell*` classes do nothing on one screen; on an unfolded phone they
        put the overview on the left page and the switch and register on the
        right (globals.css, the pane block; Grant, 2026-11-12, candidate 1). */}
    <div className="space-y-5 w-full stats-shell">
      {/* PageHeader must stay a direct child of the tall scroll root or its
          `position: sticky` un-sticks. Subhead is pinned tight to the title
          with an inline marginTop that beats the space-y-5 gap. */}
      {!takeover && <PageHeader>{t('heading')}</PageHeader>}
      <p className="fs-md text-gray-400" style={{ marginTop: 'var(--space-1)' }} hidden={takeover}>
        {t('subheadV2')}
      </p>

      {/* Hidden, not unmounted: coming back from a page must not re-read the strip. */}
      <div hidden={takeover}>
        <OverviewStrip activeName={activeName} checkIn={checkIn} />
      </div>

      {/* The switch Stringing shares (RegisterSwitch), so the two can't drift. */}
      {!takeover && (
        <div className="stats-shell-switch">
          <RegisterSwitch views={VIEWS} value={view} onChange={setView} label={(id) => t(`registers.${id}`)} ariaLabel={t('heading')} />
        </div>
      )}

      {/* You's lead card, between the switch and the register: the same place
          on one screen, the left page on a foldable. Gone with a page open. */}
      {view === 'you' && !takeover && youLead}

      {/* Keyed by view so a register switch remounts its content, and the
          remount crossfades (opacity only — the register moves nowhere, it is
          replaced). HomeShell's tab fade only runs when the TAB mounts, so
          without this a switch was a hard cut. No per-card stagger. */}
      <div key={view} className="space-y-5 motion-fade stats-shell-register">
        {slots[view]}
      </div>
    </div>
    </StatsRegisterContext.Provider>
    </StatsTakeoverContext.Provider>
  );
}
