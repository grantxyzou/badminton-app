'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';

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
        padding: 14,
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
          style={{ fontSize: 20, color: 'var(--accent, #22c55e)' }}
        >
          {icon}
        </span>
        <span
          style={{
            fontSize: 9,
            padding: '2px 7px',
            borderRadius: 100,
            whiteSpace: 'nowrap',
            fontWeight: 600,
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
            border: '1px solid var(--inner-card-border)',
            color: 'var(--text-muted)',
          }}
        >
          {comingSoon}
        </span>
      </div>
      <h3
        className="text-xs font-semibold m-0"
        style={{ color: 'var(--text-primary)', lineHeight: 1.25 }}
      >
        {title}
      </h3>
      <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: 0, lineHeight: 1.35 }}>{subtitle}</p>
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
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span
            className="material-icons"
            aria-hidden="true"
            style={{ fontSize: 22, color: 'var(--accent, #22c55e)' }}
          >
            {icon}
          </span>
          <div>
            <h3 className="bpm-h3 m-0">{title}</h3>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0, marginTop: 2 }}>{subtitle}</p>
          </div>
        </div>
        <span
          style={{
            fontSize: 10,
            padding: '3px 8px',
            borderRadius: 100,
            whiteSpace: 'nowrap',
            fontWeight: 600,
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
            border: '1px solid var(--accent, #22c55e)',
            color: 'var(--accent, #22c55e)',
          }}
        >
          {badge}
        </span>
      </div>
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
}

const sectionLabelStyle: React.CSSProperties = {
  fontSize: 10,
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

  const TABS = [
    { id: 'summary', label: tVH('viewSummary') },
    { id: 'game', label: tVH('viewGameStats') },
    { id: 'equipment', label: tVH('viewEquipment') },
  ] as const;

  const moreComingLabel = (
    <div className="px-2" style={{ paddingTop: 4 }}>
      <p className="section-label" style={sectionLabelStyle}>{t('moreComing')}</p>
    </div>
  );

  // The active view's cards. Rendered inside one keyed wrapper below so a tab
  // switch remounts it and replays the staggered entrance (see .stagger-children).
  const activeView = !hasGear ? (
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
  ) : view === 'summary' ? (
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

  return (
    <div className="space-y-5 w-full">
      <div>
        <h1 className="bpm-h1 leading-tight px-2">{t('heading')}</h1>
        <p className="text-sm text-gray-400 mt-1 px-2">{t('subhead')}</p>
      </div>

      {hasGear && (
        <div className="flex justify-center">
          <div className="segment-control flex w-full" style={{ maxWidth: 360 }}>
            {TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setView(tab.id)}
                className={`flex-1 flex items-center justify-center text-xs transition-all ${
                  view === tab.id ? 'segment-tab-active' : 'segment-tab-inactive'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Keyed by view → remounts on tab switch so the cards stagger in. */}
      <div key={hasGear ? view : 'legacy'} className="space-y-5 stagger-children">
        {activeView}
      </div>
    </div>
  );
}
