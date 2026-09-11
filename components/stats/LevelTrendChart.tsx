'use client';

import { useTranslations, useFormatter } from 'next-intl';
import ErrorState from '@/components/primitives/ErrorState';
import type { UseCheckIn, CheckInSnapshot } from './useCheckIn';

/**
 * Your level over time.
 *
 * A caption saying "▲ 0.4 since April" asks the member to take progress on
 * trust. A line is the thing itself — and it is the only honest argument for a
 * second check-in, because you cannot draw a line through one point. Requested
 * in those terms: "We should introduce a trend chart of the level change
 * overtime."
 *
 * WHAT IT PLOTS, AND WHAT IT COSTS. `(takenAt, overall)` per snapshot. Both are
 * frozen onto the doc at write time by `app/api/assessments/route.ts`, so this
 * is a read of data we already hold and already fetch — no new container, no
 * new field, no new endpoint. It deliberately does NOT call `getCanonicalLevel`:
 * that does two unbounded container scans and answers with a CURRENT value, not
 * a series.
 *
 * THE X AXIS IS TIME, NOT SESSIONS. Indexing on sessions attended would make
 * the line say something about turning up rather than about improving — the
 * same mistake as denominating the funnel on attendance. Uneven gaps between
 * check-ins are real information, so the axis is proportional to elapsed time
 * and the gaps show.
 *
 * NO CHART LIBRARY. `recharts` left with the radar in Stage 8 and this is
 * inline SVG, which is also why `var()` tokens are safe here: recharts wrote
 * stroke and fill as SVG *attributes*, where `var()` does not resolve. These
 * are CSS properties on real elements.
 */

/** The level scale, fixed. NEVER auto-scale this to the data: a 0.1 wobble
 *  rendered as a mountain is the lying-empty-state rule wearing a chart. */
const Y_MIN = 1;
const Y_MAX = 5;

const VIEW_W = 300;
const VIEW_H = 96;
const PAD_X = 6;
const PAD_Y = 8;

interface Point {
  x: number;
  y: number;
  at: number;
  overall: number;
}

/** Snapshots that can actually be plotted, oldest first. */
export function plottable(snapshots: CheckInSnapshot[]): Array<{ at: number; overall: number }> {
  return snapshots
    .map((s) => ({
      at: s.takenAt ? new Date(s.takenAt).getTime() : NaN,
      overall: typeof s.overall === 'number' ? s.overall : NaN,
    }))
    .filter((s) => Number.isFinite(s.at) && Number.isFinite(s.overall))
    .sort((a, b) => a.at - b.at);
}

function layout(rows: Array<{ at: number; overall: number }>): Point[] {
  const first = rows[0].at;
  const last = rows[rows.length - 1].at;
  // All points on one day (or a single point) would divide by zero; centre them.
  const span = last - first;
  const usableW = VIEW_W - PAD_X * 2;
  const usableH = VIEW_H - PAD_Y * 2;
  return rows.map((r, i) => {
    const tx = span > 0 ? (r.at - first) / span : rows.length > 1 ? i / (rows.length - 1) : 0.5;
    const clamped = Math.min(Y_MAX, Math.max(Y_MIN, r.overall));
    const ty = (clamped - Y_MIN) / (Y_MAX - Y_MIN);
    return {
      x: PAD_X + tx * usableW,
      y: PAD_Y + (1 - ty) * usableH,
      at: r.at,
      overall: r.overall,
    };
  });
}

export default function LevelTrendChart({ checkIn }: { checkIn: UseCheckIn }) {
  const t = useTranslations('stats.assess');
  const format = useFormatter();

  // A failed read is NOT an empty history. Saying "one check-in so far" to a
  // member with years of them, because their network blipped, is exactly the
  // failure the tri-state exists to prevent.
  if (checkIn.status === 'error') return <ErrorState message={t('trendError')} />;
  if (checkIn.status === 'loading') return null;

  const rows = plottable(checkIn.snapshots);
  // Nothing yet: the card's own empty branch already owns this state and says
  // something more useful than an empty chart frame would.
  if (rows.length === 0) return null;

  const pts = layout(rows);
  const dateOf = (ms: number) => format.dateTime(new Date(ms), { month: 'short', day: 'numeric' });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
      <p className="section-label-muted" style={{ margin: 0 }}>{t('trendTitle')}</p>

      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        preserveAspectRatio="none"
        style={{ width: '100%', height: 96, display: 'block', overflow: 'visible' }}
        role="img"
        aria-label={t('trendAria', {
          count: pts.length,
          first: dateOf(pts[0].at),
          last: dateOf(pts[pts.length - 1].at),
        })}
      >
        {/* Midline at level 3, so the line is read against something. Not a
            full grid: four more rules would out-weigh the one mark that moves. */}
        <line
          x1={PAD_X}
          x2={VIEW_W - PAD_X}
          y1={PAD_Y + (VIEW_H - PAD_Y * 2) / 2}
          y2={PAD_Y + (VIEW_H - PAD_Y * 2) / 2}
          stroke="var(--border-subtle)"
          strokeWidth={1}
          strokeDasharray="3 4"
        />

        {pts.length > 1 && (
          <polyline
            points={pts.map((p) => `${p.x},${p.y}`).join(' ')}
            fill="none"
            stroke="var(--accent)"
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        )}

        {/* One marker per check-in — the reader can count what the line is
            made of, rather than trusting a smooth curve through two points. */}
        {pts.map((p) => (
          <circle
            key={p.at}
            cx={p.x}
            cy={p.y}
            r={3}
            fill="var(--accent)"
            stroke="var(--page-bg)"
            strokeWidth={1.5}
          />
        ))}
      </svg>

      {/* One point is not a trend, and saying so is the whole invitation. It
          states a fact about the data rather than making a demand of the
          person — no week count, no "overdue", nothing that scolds. */}
      {pts.length === 1 ? (
        <p className="fs-sm" style={{ margin: 0, color: 'var(--text-muted)' }}>{t('trendOnePoint')}</p>
      ) : (
        <div
          className="fs-sm"
          style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-muted)' }}
        >
          <span>{dateOf(pts[0].at)}</span>
          <span>{dateOf(pts[pts.length - 1].at)}</span>
        </div>
      )}
    </div>
  );
}
