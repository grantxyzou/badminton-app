'use client';

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
            <h3
              className="text-base font-semibold m-0"
              style={{ color: 'var(--text-primary)', lineHeight: 1.2 }}
            >
              {title}
            </h3>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0, marginTop: 2 }}>{subtitle}</p>
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
}

export default function StatsPlaceholder({
  skillProgressionContent,
  attendanceContent,
  heroSlot,
}: Props = {}) {
  const t = useTranslations('stats');
  const comingSoon = t('comingSoon');
  const attendanceLive = !!attendanceContent;
  const skillLive = !!skillProgressionContent;

  return (
    <div className="space-y-5 w-full animate-fadeIn">
      <div>
        <h1 className="bpm-h1 leading-tight px-2">{t('heading')}</h1>
        <p className="text-sm text-gray-400 mt-1 px-2">{t('subhead')}</p>
      </div>

      {heroSlot}

      {/* ── Primary: live content ──────────────────────────────────── */}
      {attendanceLive && (
        <LiveCard
          icon="calendar_today"
          title={t('attendance.title')}
          subtitle={t('attendance.subtitle')}
        >
          {attendanceContent}
        </LiveCard>
      )}

      {/* ── Skill progression (moved from below the grid in v1.3 hotfix) ── */}
      {skillLive && (
        <LiveCard
          icon="trending_up"
          title={t('progression.title')}
          subtitle={t('progression.subtitle')}
          badge="Beta"
        >
          {skillProgressionContent}
        </LiveCard>
      )}

      {/* ── Secondary: everything not yet live, compact 2-col grid ─── */}
      <div className="px-2" style={{ paddingTop: 4 }}>
        <p
          className="section-label"
          style={{
            fontSize: 10,
            letterSpacing: '0.08em',
            color: 'var(--text-muted)',
            textTransform: 'uppercase',
            margin: 0,
          }}
        >
          More coming
        </p>
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
          gap: 12,
        }}
      >
        {!attendanceLive && (
          <CompactComingSoonCard
            icon="calendar_today"
            title={t('attendance.title')}
            subtitle={t('attendance.subtitle')}
            comingSoon={comingSoon}
          />
        )}
        <CompactComingSoonCard
          icon="payments"
          title={t('cost.title')}
          subtitle={t('cost.subtitle')}
          comingSoon={comingSoon}
        />
        <CompactComingSoonCard
          icon="groups"
          title={t('partners.title')}
          subtitle={t('partners.subtitle')}
          comingSoon={comingSoon}
        />
        {!skillLive && (
          <CompactComingSoonCard
            icon="trending_up"
            title={t('progression.title')}
            subtitle={t('progression.subtitle')}
            comingSoon={comingSoon}
          />
        )}
      </div>
    </div>
  );
}
