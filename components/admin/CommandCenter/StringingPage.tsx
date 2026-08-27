'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import AdminBackHeader from '../AdminBackHeader';
import { AdminPageSkeleton } from '@/components/primitives/CardSkeleton';
import ErrorState from '@/components/primitives/ErrorState';
import EmptyState from '@/components/primitives/EmptyState';
import { useOnline } from '@/lib/useOnline';
import { dueFor, todayIso, formatReadyBy, type DueTone } from '@/lib/stringingDue';
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
/** Urgency colour for the due column. Separate from the status chip: a job can
 *  be `received` (neutral) and overdue (red) at the same time, which is exactly
 *  the pair a stringer scans for. */
const DUE_FG: Record<DueTone, string> = {
  overdue: 'var(--sev-crit-text, var(--color-red))',
  soon: 'var(--pill-waitlist-text)',
  ok: 'var(--text-secondary)',
  done: 'var(--text-muted)',
};

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
  // null = UNKNOWN (throttled or failed), not closed. Rendering a CLOSED sign
  // on a shop that is open is the confident-wrong answer, so unknown says so.
  const [shopOpen, setShopOpen] = useState<boolean | null>(null);
  const [shopBusy, setShopBusy] = useState(false);

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

  useEffect(() => {
    let cancelled = false;
    fetch(`${BASE}/api/stringing/shop`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled && d) setShopOpen(typeof d.open === 'boolean' ? d.open : null);
      })
      .catch(() => {
        /* stays null — unknown, not closed */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function toggleShop() {
    if (shopBusy || !online || shopOpen === null) return;
    setShopBusy(true);
    try {
      const res = await fetch(`${BASE}/api/stringing/shop`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ open: !shopOpen }),
      });
      if (res.ok) setShopOpen((await res.json()).open === true);
    } catch {
      /* leave the sign as it was rather than claiming a change that failed */
    } finally {
      setShopBusy(false);
    }
  }

  const selected = jobs?.find((j) => j.id === selectedId) ?? null;
  // Resolved once per render rather than per row, so every row on the screen
  // agrees about what day it is even if the render straddles midnight.
  const today = todayIso();

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
        {/* The shop sign. Separate from NEXT_PUBLIC_FLAG_STRINGING on purpose:
            that says whether this code exists, this says whether Grant is
            taking rackets this week. Closing does NOT stop the bench — jobs in
            flight still need finishing and a walk-up can still be logged. */}
        <div
          className="glass-card p-5"
          style={
            shopOpen
              ? { background: 'var(--banner-green-bg)', borderColor: 'var(--banner-green-border)' }
              : undefined
          }
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)' }}>
            <span
              className="material-icons icon-md"
              style={{ color: shopOpen ? 'var(--accent)' : 'var(--text-muted)' }}
            >
              {shopOpen ? 'check_circle' : 'lock'}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="bpm-h3 m-0">
                {shopOpen === null ? t('shop.unknown') : shopOpen ? t('shop.open') : t('shop.closed')}
              </div>
              <p className="fs-sm" style={{ color: 'var(--text-secondary)', margin: '2px 0 0' }}>
                {shopOpen === null
                  ? t('shop.unknownHint')
                  : shopOpen
                    ? t('shop.openHint')
                    : t('shop.closedHint')}
              </p>
            </div>
            <button
              type="button"
              onClick={toggleShop}
              disabled={shopBusy || !online || shopOpen === null}
              className={`cc-btn ${shopOpen ? 'cc-btn-secondary' : 'cc-btn-primary'}`}
            >
              {shopOpen ? t('shop.closeCta') : t('shop.openCta')}
            </button>
          </div>
        </div>

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
          const due = dueFor(job, today);
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
                  {job.stringLabel} · {job.tensionMains}/{job.tensionCrosses}{t('lb')}
                </span>
                {/* URGENCY, not price. A bench is scanned for what is late, and
                    the exact figure lives one tap away on the detail screen —
                    where it is also the only place it belongs. */}
                <span className="fs-sm" style={{ fontWeight: 600, color: DUE_FG[due.tone] }}>
                  {/* Suppressed for a picked-up job: the status chip on the row
                      above already says "Picked up", and printing it twice in
                      one row is noise on a screen whose whole job is scanning. */}
                  {due.key === 'pickedUp'
                    ? ''
                    : due.key === 'overdue'
                      ? t('due.overdue', { days: due.days ?? 0 })
                      : due.key === 'onDate'
                        ? (formatReadyBy(due.date) ?? t('due.noDate'))
                        : t(`due.${due.key}`)}
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
