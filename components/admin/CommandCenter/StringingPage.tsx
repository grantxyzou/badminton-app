'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import AdminBackHeader from '../AdminBackHeader';
import { AdminPageSkeleton } from '@/components/primitives/CardSkeleton';
import ErrorState from '@/components/primitives/ErrorState';
import EmptyState from '@/components/primitives/EmptyState';
import { useOnline } from '@/lib/useOnline';
import { STRINGING_FLOW, formatPriceExact } from '@/lib/stringing';
import type { StringingStatus } from '@/lib/stringing';
import type { StringingJob } from '@/lib/types';
import StringingJobDetail from './StringingJobDetail';
import StringingIntake from './StringingIntake';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/**
 * The bench — screen 2a of the Stringing design, plus the two screens it
 * opens.
 *
 * Kept as one page with an internal view rather than three `AdminView`
 * entries, because the three share one job list: coming back from a detail
 * must not refetch and must not lose the Mine/All choice. That is the same
 * reason `SetupPage` owns its sub-views.
 *
 * ADMIN-ONLY BY CONSTRUCTION. Every price on this screen is exact, which is
 * precisely what the player API strips. Nothing here is reachable without the
 * admin cookie, and the routes re-check the role on every request rather than
 * trusting that.
 */

/** Chip tone per status. Mirrors the design's TONE table. */
const TONE: Record<StringingStatus, { bg: string; fg: string }> = {
  requested: { bg: 'var(--pill-unpaid-bg)', fg: 'var(--pill-unpaid-text)' },
  received: { bg: 'var(--pill-waitlist-bg)', fg: 'var(--pill-waitlist-text)' },
  strung: { bg: 'var(--pill-waitlist-bg)', fg: 'var(--pill-waitlist-text)' },
  ready: { bg: 'var(--pill-paid-bg)', fg: 'var(--pill-paid-text)' },
  picked_up: { bg: 'var(--pill-unpaid-bg)', fg: 'var(--pill-unpaid-text)' },
};

interface Props {
  onBack: () => void;
}

export default function StringingPage({ onBack }: Props) {
  const t = useTranslations('admin.stringing');
  const online = useOnline();
  const [jobs, setJobs] = useState<StringingJob[] | null>(null);
  // Tri-state, not `jobs ?? []`. A failed load must never render as an empty
  // bench — that is the lying-empty-state rule, and on this screen it would
  // mean a stringer believing they have no rackets to string.
  const [loadError, setLoadError] = useState(false);
  const [mine, setMine] = useState(false);
  const [view, setView] = useState<'bench' | 'detail' | 'new'>('bench');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(false);
    try {
      const res = await fetch(`${BASE}/api/stringing/jobs${mine ? '?mine=true' : ''}`, {
        cache: 'no-store',
      });
      if (!res.ok) throw new Error(`stringing jobs ${res.status}`);
      const data = await res.json();
      setJobs(Array.isArray(data.jobs) ? data.jobs : []);
    } catch {
      setJobs(null);
      setLoadError(true);
    }
  }, [mine]);

  useEffect(() => {
    void load();
  }, [load]);

  const selected = jobs?.find((j) => j.id === selectedId) ?? null;

  if (view === 'detail' && selected) {
    return (
      <div className="animate-slideInRight">
        <StringingJobDetail
          job={selected}
          onBack={() => setView('bench')}
          onChanged={() => void load()}
        />
      </div>
    );
  }

  if (view === 'new') {
    return (
      <div className="animate-slideInRight">
        <StringingIntake
          onBack={() => setView('bench')}
          onCreated={() => {
            setView('bench');
            void load();
          }}
        />
      </div>
    );
  }

  return (
    <div>
      <AdminBackHeader onBack={onBack} title={t('benchTitle')} />
      <div className="flex flex-col gap-4 px-4 pb-6">
        {/* Mine / All. The wrapper needs `flex` and each tab `flex-1` —
            .segment-control sets no display, so without it the active pill
            overlaps its neighbour. */}
        <div className="segment-control flex">
          <button
            type="button"
            onClick={() => setMine(true)}
            className={`flex-1 flex items-center justify-center ${mine ? 'segment-tab-active' : 'segment-tab-inactive'}`}
          >
            {t('mine')}
          </button>
          <button
            type="button"
            onClick={() => setMine(false)}
            className={`flex-1 flex items-center justify-center ${mine ? 'segment-tab-inactive' : 'segment-tab-active'}`}
          >
            {t('all')}
          </button>
        </div>

        {loadError && <ErrorState message={t('loadError')} />}
        {!loadError && jobs === null && <AdminPageSkeleton />}
        {!loadError && jobs !== null && jobs.length === 0 && (
          <EmptyState>{mine ? t('emptyMine') : t('empty')}</EmptyState>
        )}

        {jobs?.map((job) => {
          const tone = TONE[job.status] ?? TONE.requested;
          return (
            <button
              key={job.id}
              type="button"
              onClick={() => {
                setSelectedId(job.id);
                setView('detail');
              }}
              className="glass-card p-4 text-left"
              style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-3)' }}>
                <span style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--space-3)', minWidth: 0 }}>
                  <span className="fs-lg" style={{ fontWeight: 600 }}>{job.memberName}</span>
                  <span className="fs-sm" style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
                    {job.jobNo}
                  </span>
                </span>
                <span
                  className="fs-2xs"
                  style={{
                    flex: '0 0 auto',
                    fontWeight: 600,
                    padding: '5px 11px',
                    borderRadius: 'var(--radius-pill)',
                    background: tone.bg,
                    color: tone.fg,
                  }}
                >
                  {t(`status.${job.status}`)}
                </span>
              </div>
              <div className="fs-md" style={{ color: 'var(--text-secondary)' }}>{job.racketLabel}</div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-3)' }}>
                <span className="fs-sm" style={{ fontFamily: 'var(--font-mono)', color: 'var(--ink-faint)' }}>
                  {job.stringLabel} · {job.tensionMains}/{job.tensionCrosses}
                </span>
                {/* The exact figure, because this screen is the stringer's. */}
                <span className="fs-sm" style={{ fontWeight: 600, color: tone.fg }}>
                  {formatPriceExact(job.priceCents) ?? t('unpriced')}
                </span>
              </div>
            </button>
          );
        })}

        <button
          type="button"
          onClick={() => setView('new')}
          disabled={!online}
          className="cc-btn cc-btn-primary cc-btn-lg"
          style={{ width: '100%' }}
        >
          {t('addJob')}
        </button>
      </div>
    </div>
  );
}

/** Exported for the detail screen's stepper, so both read one ordering. */
export { STRINGING_FLOW };
