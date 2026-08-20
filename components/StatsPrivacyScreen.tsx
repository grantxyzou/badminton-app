'use client';

import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import TopBar from '@/components/primitives/TopBar';
import Switch from '@/components/primitives/Switch';
import ErrorState from '@/components/primitives/ErrorState';
import CardSkeleton from '@/components/primitives/CardSkeleton';
import ProfileEyebrow from '@/components/primitives/ProfileEyebrow';
import { useOnline } from '@/lib/useOnline';
import type { UseStatsPrivacy } from '@/lib/useStatsPrivacy';

/**
 * Profile → Stats & privacy.
 *
 * A full-screen sub-view, which is NEW structure for ProfileTab — every other
 * settings row opens a BottomSheet, and Admin access is a tab swap rather than
 * a sub-screen. The pattern is borrowed from AdminDashboard: local view state
 * in the parent, early return, `animate-slideInRight`, TopBar with a back
 * affordance.
 *
 * The screen exists to make one promise legible: nothing here is a
 * confirmation dialog for other people's benefit. Turning the comparison off
 * changes what YOU see and nothing else, and the closing note says so in as
 * many words, because a privacy switch that quietly does nothing for you is
 * worse than no switch.
 */
export interface StatsPrivacyScreenProps {
  onBack: () => void;
  state: UseStatsPrivacy;
}

export default function StatsPrivacyScreen({ onBack, state }: StatsPrivacyScreenProps) {
  const t = useTranslations('stats.privacy');
  const online = useOnline();
  const { privacy, loaded, error, saving, saveError, save } = state;

  const on = privacy?.clubComparison ?? true;

  return (
    // NOT wrapped in an element containing only the header — TopBar is
    // `position: sticky`, and a header-only wrapper shrinks the sticky
    // containing block so the bar scrolls away instead of condensing.
    <div className="animate-slideInRight space-y-5">
      <TopBar title={t('title')} crumb={t('crumb')} onBack={onBack} backLabel={t('crumb')} />

      {!loaded ? (
        <CardSkeleton height={180} />
      ) : error ? (
        <div className="glass-card p-5">
          <ErrorState message={t('saveError')} />
        </div>
      ) : (
        <div className="glass-card p-5 space-y-3">
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-5)' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <h3 className="bpm-h3" style={{ margin: 0 }}>
                {t('comparisonTitle')}
              </h3>
              <p
                style={{
                  margin: '4px 0 0',
                  fontSize: 'var(--fs-base)',
                  lineHeight: 1.45,
                  color: 'var(--text-secondary)',
                }}
              >
                {t('comparisonSubtitle')}
              </p>
            </div>
            <Switch
              checked={on}
              onChange={(next) => save(next)}
              ariaLabel={t('comparisonTitle')}
              ariaDescribedBy="stats-privacy-state"
              // Legible-fail: never execute-then-break. The banner explains the
              // offline state app-wide; this just stops the write.
              disabled={saving || !online}
            />
          </div>

          <div
            style={{
              display: 'flex',
              gap: 'var(--space-3)',
              alignItems: 'flex-start',
              padding: 'var(--space-4)',
              borderRadius: 'var(--radius-lg)',
              background: 'var(--inner-card-bg)',
              border: '1px solid var(--inner-card-border)',
            }}
          >
            <span
              className="material-icons"
              aria-hidden="true"
              style={{ fontSize: 'var(--icon-sm)', color: 'var(--accent)', flexShrink: 0 }}
            >
              visibility
            </span>
            <p
              id="stats-privacy-state"
              style={{ margin: 0, fontSize: 'var(--fs-base)', lineHeight: 1.45, color: 'var(--text-secondary)' }}
            >
              {on ? t('stateOn') : t('stateOff')}
            </p>
          </div>

          {saveError && <ErrorState message={t('saveError')} />}
          {!online && (
            <p style={{ margin: 0, fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>{t('offline')}</p>
          )}
        </div>
      )}

      <ProfileEyebrow>{t('othersEyebrow')}</ProfileEyebrow>

      <div className="glass-card-soft" style={{ padding: 0, overflow: 'hidden' }}>
        {/* Kudos are ANONYMOUS in this app. The design handoff asserted the
            opposite ("Always — kudos are signed"), which would have reversed a
            documented strip-canary invariant in lib/kudos.ts. That reversal was
            declined, so this row reads Never and the copy matches the code. */}
        <VisibilityRow icon="volunteer_activism" label={t('kudosLabel')} body={t('kudosBody')} verdict={t('verdictNever')} first />
        <VisibilityRow icon="lock" label={t('ratingsLabel')} body={t('ratingsBody')} verdict={t('verdictNever')} />
        <VisibilityRow icon="lock" label={t('levelLabel')} body={t('levelBody')} verdict={t('verdictNever')} />
        <VisibilityRow icon="inventory_2" label={t('kitLabel')} body={t('kitBody')} verdict={t('verdictCounted')} />
      </div>

      <div
        style={{
          padding: 'var(--space-5)',
          borderRadius: 'var(--radius-lg)',
          background: 'var(--inner-card-bg)',
          border: '1px solid var(--inner-card-border)',
        }}
      >
        <p style={{ margin: 0, fontSize: 'var(--fs-base)', lineHeight: 1.55, color: 'var(--text-secondary)' }}>
          {t.rich('closing', {
            you: (chunks: ReactNode) => (
              <b style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{chunks}</b>
            ),
          })}
        </p>
      </div>
    </div>
  );
}

function VisibilityRow({
  icon,
  label,
  body,
  verdict,
  first = false,
}: {
  icon: string;
  label: string;
  body: string;
  verdict: string;
  first?: boolean;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 'var(--space-4)',
        padding: '14px 16px',
        borderTop: first ? 'none' : '1px solid var(--divider)',
      }}
    >
      <span
        className="material-icons"
        aria-hidden="true"
        style={{ fontSize: 'var(--icon-sm)', color: 'var(--text-secondary)', marginTop: 2 }}
      >
        {icon}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ margin: 0, fontSize: 'var(--fs-md)', color: 'var(--text-primary)' }}>{label}</p>
        <p
          style={{
            margin: '3px 0 0',
            fontSize: 'var(--fs-sm)',
            lineHeight: 1.45,
            color: 'var(--text-muted)',
          }}
        >
          {body}
        </p>
      </div>
      <span
        style={{
          fontSize: 'var(--fs-sm)',
          color: 'var(--text-secondary)',
          fontWeight: 600,
          whiteSpace: 'nowrap',
          marginTop: 2,
        }}
      >
        {verdict}
      </span>
    </div>
  );
}
