'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import PageHeader from '@/components/primitives/PageHeader';
import CardHeader from '@/components/primitives/CardHeader';
import StatusBadge from '@/components/primitives/StatusBadge';

interface CompactCardProps {
  icon: string;
  title: string;
  subtitle: string;
  comingSoon: string;
}

function CompactComingSoonCard({ icon, title, subtitle, comingSoon }: CompactCardProps) {
  return (
    <div
      className="glass-card"
      style={{
        padding: 16,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        minHeight: 112,
        opacity: 0.85,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span
          className="material-icons"
          aria-hidden="true"
          style={{ fontSize: 'var(--fs-stat)', color: 'var(--accent, #22c55e)' }}
        >
          {icon}
        </span>
        <StatusBadge variant="muted">{comingSoon}</StatusBadge>
      </div>
      <h3
        className="fs-sm font-semibold m-0"
        style={{ color: 'var(--text-primary)', lineHeight: 1.25 }}
      >
        {title}
      </h3>
      <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', margin: 0, lineHeight: 1.35 }}>{subtitle}</p>
    </div>
  );
}

interface LiveCardProps {
  icon: string;
  title: string;
  subtitle: string;
  children: React.ReactNode;
  /** Pill text in the header. Defaults to "Live"; pass "Beta" or other
   *  short label to denote work-in-progress live content. */
  badge?: string;
}

function LiveCard({ icon, title, subtitle, children, badge = 'Live' }: LiveCardProps) {
  return (
    <div className="glass-card p-5 space-y-3">
      <CardHeader icon={icon} title={title} subtitle={subtitle} badge={<StatusBadge>{badge}</StatusBadge>} />
      {children}
    </div>
  );
}

interface Props {
  /** Optional live content to render inside the Skill Progression card.
   *  When provided, the card renders full-width at the bottom of the page.
   *  Admins get this (SkillsRadar + inline Add Player). */
  skillProgressionContent?: React.ReactNode;
  /** Optional live content for the Attendance card. When provided, renders
   *  prominent up top as a full-width LiveCard. (Always-on as of v1.3
   *  hotfix; the FLAG_STATS_ATTENDANCE gate has been retired.) */
  attendanceContent?: React.ReactNode;
  /** Optional hero slot — rendered between the page heading and the
   *  primary live section. Used for the attendance streak hero. */
  heroSlot?: React.ReactNode;
  /** Game-register value-hub cards (game logger + partner frequency). Shown
   *  in the "Your game" view. */
  gamePlaySlot?: React.ReactNode;
  /** Gear-register content (racket row + future strings/shoes/shuttle). When
   *  present, a Game/Gear segmented control splits the tab into two views;
   *  the equipment coming-soon card moves under Gear and the partner
   *  coming-soon card is dropped (it's live in the Game view). */
  gearContent?: React.ReactNode;
  /** Skill-assessment spine layout: two sub-tabs (Summary = trend hero,
   *  Game stats = AI read + attendance + game logger + partner). Parks the
   *  legacy skill / equipment slots. */
  assessMode?: boolean;
  /** Passive AI "Your read" card (streak headline + insight). In assessMode it
   *  leads the Game stats view; the synthesis sits above the raw data. */
  insightSlot?: React.ReactNode;
}

const sectionLabelStyle: React.CSSProperties = {
  fontSize: 'var(--fs-2xs)',
  letterSpacing: '0.08em',
  color: 'var(--text-muted)',
  textTransform: 'none',
  margin: 0,
};
const gridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
  gap: 12,
};

export default function StatsPlaceholder({
  skillProgressionContent,
  attendanceContent,
  heroSlot,
  gamePlaySlot,
  gearContent,
  assessMode = false,
  insightSlot,
}: Props = {}) {
  const t = useTranslations('stats');
  const tVH = useTranslations('valueHub');
  const comingSoon = t('comingSoon');
  const attendanceLive = !!attendanceContent;
  const skillLive = !!skillProgressionContent;
  // Gear content only arrives when the value-hub flag is on. That's what turns
  // on the three-register split (Summary | Game stats | Equipment); without it
  // the tab renders as a single legacy scroll.
  const hasGear = !!gearContent;
  const hasPlay = !!gamePlaySlot;
  // Tabs render whenever there's a register to split into — assessment spine,
  // gear, OR play content (game logger + partners). The last term keeps the
  // game logger reachable even if it's ever passed without gear/assessMode,
  // closing the legacy path that dropped gamePlaySlot entirely.
  const useTabs = assessMode || hasGear || hasPlay;
  const [view, setView] = useState<'summary' | 'game' | 'equipment'>('summary');

  const attendanceCard = attendanceLive && (
    <LiveCard icon="calendar_today" title={t('attendance.title')} subtitle={t('attendance.subtitle')} badge="Beta">
      {attendanceContent}
    </LiveCard>
  );
  const skillCard = skillLive && (
    <LiveCard icon="trending_up" title={t('progression.title')} subtitle={t('progression.subtitle')} badge="Beta">
      {skillProgressionContent}
    </LiveCard>
  );

  // Two tabs (Summary | Game stats) unless gear adds an Equipment register.
  const TABS = (hasGear
    ? [
        { id: 'summary', label: tVH('viewSummary') },
        { id: 'game', label: tVH('viewGameStats') },
        { id: 'equipment', label: tVH('viewEquipment') },
      ]
    : [
        { id: 'summary', label: tVH('viewSummary') },
        { id: 'game', label: tVH('viewGameStats') },
      ]) as { id: 'summary' | 'game' | 'equipment'; label: string }[];

  const moreComingLabel = (
    <div className="px-2" style={{ paddingTop: 4 }}>
      <p className="section-label" style={sectionLabelStyle}>{t('moreComing')}</p>
    </div>
  );

  // The active view's cards, rendered inside one keyed wrapper below so a
  // segment switch swaps content cleanly.
  let activeView: React.ReactNode;
  if (assessMode) {
    activeView = view === 'game' ? (
      <>
        {/* Synthesis first (AI read + streak), then the raw data it draws on. */}
        {insightSlot}
        {attendanceCard}
        {gamePlaySlot}
      </>
    ) : (
      <>{heroSlot}</>
    );
  } else if (hasGear) {
    activeView = view === 'summary' ? (
      <>{heroSlot}</>
    ) : view === 'game' ? (
      <>
        {attendanceCard}
        {/* Value-Hub: game logger + partner frequency. */}
        {gamePlaySlot}
        {skillCard}
      </>
    ) : (
      <>
        {gearContent}
        {moreComingLabel}
        <div style={gridStyle}>
          <CompactComingSoonCard icon="sports_tennis" title={t('equipment.title')} subtitle={t('equipment.subtitle')} comingSoon={comingSoon} />
        </div>
      </>
    );
  } else if (hasPlay) {
    // Play content but no gear/assessMode register: two tabs, the game logger
    // and partners live under Game stats so they stay reachable.
    activeView = view === 'game' ? (
      <>
        {attendanceCard}
        {gamePlaySlot}
        {skillCard}
      </>
    ) : (
      <>
        {heroSlot}
        {skillCard}
        {moreComingLabel}
        <div style={gridStyle}>
          <CompactComingSoonCard icon="sports_tennis" title={t('equipment.title')} subtitle={t('equipment.subtitle')} comingSoon={comingSoon} />
        </div>
      </>
    );
  } else {
    // Legacy single scroll — no tabs (no assessMode, gear, or play content).
    activeView = (
      <>
        {heroSlot}
        {attendanceCard}
        {skillCard}
        {moreComingLabel}
        <div style={gridStyle}>
          <CompactComingSoonCard icon="groups" title={t('partners.title')} subtitle={t('partners.subtitle')} comingSoon={comingSoon} />
          <CompactComingSoonCard icon="sports_tennis" title={t('equipment.title')} subtitle={t('equipment.subtitle')} comingSoon={comingSoon} />
        </div>
      </>
    );
  }

  return (
    <div className="space-y-5 w-full">
      {/* PageHeader must be a direct child of the tall scroll root so its
          `position: sticky` stays stuck for the whole tab (nesting it in a
          short wrapper would un-stick it). Subhead is a sibling pinned tight
          to the title via inline marginTop (beats the space-y-5 gap). */}
      <PageHeader>{t('heading')}</PageHeader>
      <p className="fs-md text-gray-400 px-2" style={{ marginTop: 4 }}>{t('subhead')}</p>

      {useTabs && (
        <div className="flex justify-center">
          <div className="segment-control flex w-full" style={{ maxWidth: 360 }}>
            {TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setView(tab.id)}
                className={`flex-1 flex items-center justify-center fs-sm transition-all ${
                  view === tab.id ? 'segment-tab-active' : 'segment-tab-inactive'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Keyed by view so a segment switch swaps content cleanly. Entrance
          motion is the shared whole-tab fade from HomeShell — no per-card
          stagger here, so Stats matches Home/Profile/Sign-Ups. */}
      <div key={useTabs ? view : 'legacy'} className="space-y-5">
        {activeView}
      </div>
    </div>
  );
}
