'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import AdminBackHeader from './AdminBackHeader';
import BarRow from './metrics/BarRow';
import CohortGrid from './metrics/CohortGrid';
import CardHeader from '@/components/primitives/CardHeader';
import ErrorState from '@/components/primitives/ErrorState';
import { AdminPageSkeleton } from '@/components/primitives/CardSkeleton';
import type { ClubMetrics, SessionMetrics } from '@/lib/metricsMath';
import { NONE, dayCount, duration, pct, shortDate } from '@/lib/metricsFormat';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

type Shown = 8 | 12 | 26;
const RANGES: Shown[] = [8, 12, 26];

/**
 * Admin → Metrics (docs/plans/usage-metrics.md): how the club is doing, read
 * from data the app already holds. Totals and rates only — the endpoint
 * returns no names, so this page cannot show one.
 *
 * A metric with nothing to measure is a dash and a reason, never a zero. The
 * numbers that need usage tracking (daily and weekly active, the sign-up
 * funnel, tab use) are named on their own card as not measured yet, rather
 * than drawn as empty charts that would read as "nobody".
 */
export default function MetricsPage({ onBack }: { onBack: () => void }) {
  const [shown, setShown] = useState<Shown>(8);
  const [data, setData] = useState<ClubMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const res = await fetch(`${BASE}/api/admin/metrics?sessions=${shown}`, { cache: 'no-store' });
      if (!res.ok) {
        setLoadError(true);
        return;
      }
      setData((await res.json()) as ClubMetrics);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [shown]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loadError) {
    return (
      <div className="motion-fade space-y-3">
        <AdminBackHeader onBack={onBack} title="Metrics" />
        <div style={{ padding: 'var(--space-9) var(--space-7)' }}>
          <ErrorState
            message="Couldn't load the metrics."
            action={
              <button type="button" className="cc-btn cc-btn-ghost" onClick={() => void load()}>
                Try again
              </button>
            }
          />
        </div>
      </div>
    );
  }

  // First load only: a range tap keeps the last numbers on screen (dimmed via
  // aria-busy) rather than blinking back to a skeleton.
  if (!data) {
    return (
      <div className="space-y-3">
        <AdminBackHeader onBack={onBack} title="Metrics" />
        <AdminPageSkeleton />
      </div>
    );
  }

  const { activeMembers, sessions, newMembers, retention, features, payments } = data;

  return (
    <div className="space-y-3 motion-busy" aria-busy={loading || undefined}>
      <AdminBackHeader onBack={onBack} title="Metrics" />

      <p style={{ fontSize: 'var(--fs-base)', color: 'var(--text-secondary)', margin: '0 var(--space-1)' }}>
        How the club is doing. Totals only — nobody&apos;s activity is listed.
      </p>

      <div className="segment-control flex" role="tablist" aria-label="How many sessions">
        {RANGES.map((n) => (
          <button
            key={n}
            type="button"
            role="tab"
            aria-selected={shown === n}
            onClick={() => setShown(n)}
            className={`flex-1 fs-sm rounded-full ${shown === n ? 'segment-tab-active' : 'segment-tab-inactive'}`}
          >
            Last {n} sessions
          </button>
        ))}
      </div>

      <section className="glass-card p-5 flex flex-col gap-4" aria-label="Active members">
        <CardHeader icon="group" title="Active members" subtitle="People with a spot in the last 4 sessions" />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 'var(--space-3)' }}>
          <Tile value={String(activeMembers.last4)} label="Last 4" />
          <Tile value={String(activeMembers.previous4)} label="The 4 before" />
          <Tile value={String(data.rosterSize)} label="Roster" />
        </div>
      </section>

      <section className="glass-card p-5 flex flex-col gap-4" aria-label="Sessions">
        <CardHeader icon="event" title="Sessions" subtitle="How full each one got, and how fast" />
        {sessions.length === 0 ? (
          <p style={{ margin: '0', fontSize: 'var(--fs-base)', color: 'var(--text-muted)' }}>No sessions have been played yet.</p>
        ) : (
          <ul className="flex flex-col gap-4" style={{ listStyle: 'none', margin: '0', padding: '0' }}>
            {[...sessions].reverse().map((s) => (
              <li key={s.date}>
                <SessionRow s={s} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="glass-card p-5 flex flex-col gap-4" aria-label="New members">
        <CardHeader icon="person_add" title="New members" subtitle="Joined in the last 90 days" />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 'var(--space-3)' }}>
          <Tile value={String(newMembers.joined90d)} label="Joined" />
          <Tile value={pct(newMembers.activationRate)} label="Played within 2 weeks" />
        </div>
        <Caption>
          {newMembers.activationRate === null
            ? 'Nobody joined long enough ago to tell yet.'
            : `${newMembers.activated14d} of ${newMembers.activationEligible} who joined at least 2 weeks ago signed up for a session within 2 weeks.`}
        </Caption>
        <div className="flex flex-col gap-2">
          <span className="section-label-muted">Coming back</span>
          {retention.length === 0 ? (
            <Caption>Needs a full month of play before there is anything to show.</Caption>
          ) : (
            <>
              <CohortGrid rows={retention} />
              <Caption>Share of each month&apos;s first-timers who played again 1, 2 and 3 months later. A month that isn&apos;t over is left blank.</Caption>
            </>
          )}
        </div>
      </section>

      <section className="glass-card p-5 flex flex-col gap-4" aria-label="Features">
        <CardHeader icon="thumb_up" title="Features" subtitle="Share of the roster, last 28 days" />
        <BarRow label="Gave kudos" value={features.kudosShare} detail={share(features.kudosGivers28d, features.kudosShare)} />
        <BarRow label="Asked for stringing" value={features.stringingShare} detail={share(features.stringingRequesters28d, features.stringingShare)} />
        <BarRow label="Notifications on" value={features.pushShare} detail={share(features.pushEnabled, features.pushShare)} />
      </section>

      <section className="glass-card p-5 flex flex-col gap-4" aria-label="Payments">
        <CardHeader icon="paid" title="Payments" subtitle={`Settled sessions in the last ${shown}`} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 'var(--space-3)' }}>
          <Tile value={pct(payments.paidRate)} label="Paid" />
          <Tile value={dayCount(payments.medianDaysToPay)} label="Days to pay" />
          <Tile value={pct(payments.paidWithin7dRate)} label="In a week" />
        </div>
        <Caption>
          {payments.settledLines === 0
            ? 'No settled sessions in this range.'
            : `${payments.paidLines} of ${payments.settledLines} shares paid. Days to pay is the typical wait after a session is settled, from the ${payments.timedLines} payments recorded with a time — older ones have none.`}
        </Caption>
      </section>

      <section className="glass-card p-5 flex flex-col gap-3" aria-label="Usage">
        <CardHeader icon="hourglass_empty" title="App usage" subtitle="Starts when usage tracking is on" />
        <Caption>
          Daily and weekly active members, how many people go from opening the app to signing up, and which tabs get
          used. These need the app to record visits, which is off until the privacy labels are updated.
        </Caption>
      </section>
    </div>
  );
}

function Tile({ value, label }: { value: string; label: string }) {
  return (
    <div className="cc-tile cc-tile-static">
      <span className="num">{value}</span>
      <span className="lbl">{label}</span>
    </div>
  );
}

function Caption({ children }: { children: ReactNode }) {
  return <p style={{ margin: '0', fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>{children}</p>;
}

function share(count: number, rate: number | null): string {
  return rate === null ? NONE : `${count} · ${pct(rate)}`;
}

function SessionRow({ s }: { s: SessionMetrics }) {
  const speed =
    s.minutesToFill !== null
      ? `full in ${duration(s.minutesToFill)}`
      : s.medianSignupMinutes !== null
        ? `half signed up in ${duration(s.medianSignupMinutes)}`
        : 'open time not recorded';
  const extras = [
    s.waitlisted > 0 ? `${s.waitlisted} waitlisted` : null,
    s.cancelledBySelf > 0 ? `${s.cancelledBySelf} cancelled` : null,
    speed,
  ].filter(Boolean).join(' · ');
  return (
    <div className="flex flex-col gap-1">
      <BarRow label={shortDate(s.date)} value={s.fillRate} detail={`${s.confirmed} / ${s.capacity}`} />
      <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>{extras}</span>
    </div>
  );
}
