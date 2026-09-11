'use client';

import { useTranslations, useFormatter } from 'next-intl';
import ErrorState from '@/components/primitives/ErrorState';
import EmptyState from '@/components/primitives/EmptyState';
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
/**
 * The height every state reserves: the plot, its gap, and the one-line date
 * axis under it. NOT just the plot — measured in the browser, reserving only
 * `VIEW_H` left the empty and failed states 16px shorter than a drawn one,
 * because the axis row exists in one and not the others. The point of the
 * reservation is that the card is the same size whatever came back, so the
 * bars and legends below it do not jump on each read; getting it 16px wrong
 * just moves the jump somewhere less obvious.
 */
const AXIS_ROW_H = 16;
const BODY_GAP = 6; // --space-2
const BODY_H = VIEW_H + BODY_GAP + AXIS_ROW_H;
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

/**
 * Every state wears the same frame: the title, then a body of exactly one plot
 * height. The chart must not change the card's size depending on what came
 * back, or the bars and legends below it jump on every read.
 *
 * What the frame does NOT do is make the states look alike. Loaded-empty and
 * load-failed stay visually distinct — `EmptyState`'s muted body copy against
 * `ErrorState`'s `role="alert"` — because a card that confidently reports
 * nothing when the backend is broken is the exact failure the house rule names.
 * Same box, different message.
 */
function Frame({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
      <p className="section-label-muted" style={{ margin: 0 }}>{title}</p>
      <div
        style={{
          minHeight: BODY_H,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
        }}
      >
        {children}
      </div>
    </div>
  );
}

export default function LevelTrendChart({ checkIn }: { checkIn: UseCheckIn }) {
  const t = useTranslations('stats.assess');
  const format = useFormatter();

  // A failed read is NOT an empty history. Saying "one check-in so far" to a
  // member with years of them, because their network blipped, is exactly the
  // failure the tri-state exists to prevent.
  if (checkIn.status === 'error') {
    return <Frame title={t('trendTitle')}><ErrorState message={t('trendError')} /></Frame>;
  }
  // Loading reserves the space silently — a spinner for a 96px strip is noise,
  // and the height is already held.
  if (checkIn.status === 'loading') return <Frame title={t('trendTitle')}>{null}</Frame>;

  const rows = plottable(checkIn.snapshots);
  if (rows.length === 0) {
    return (
      <Frame title={t('trendTitle')}>
        <EmptyState>{t('trendEmpty')}</EmptyState>
      </Frame>
    );
  }

  const pts = layout(rows);

  /**
   * The YEAR appears as soon as the history crosses one.
   *
   * Month-and-day alone renders a year of check-ins as "Sep 13 … Aug 31", which
   * reads as running BACKWARDS — a reader has no way to tell those are twelve
   * months apart rather than two weeks the wrong way round. Found by looking at
   * it: every structural assertion passed, because the polyline had the right
   * points and the label was still a string. Only a person reading it can see
   * that it says the wrong thing.
   *
   * Kept off the short ranges deliberately — "Apr 9, 2026" on both ends of a
   * four-month span is noise that tells the reader nothing they did not have.
   */
  const first = new Date(pts[0].at);
  const last = new Date(pts[pts.length - 1].at);
  const spansYears = first.getFullYear() !== last.getFullYear();
  const dateOf = (ms: number) =>
    format.dateTime(new Date(ms), spansYears
      ? { year: 'numeric', month: 'short', day: 'numeric' }
      : { month: 'short', day: 'numeric' });

  return (
    <Frame title={t('trendTitle')}>
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        preserveAspectRatio="none"
        style={{ width: '100%', height: 96, display: 'block', overflow: 'visible' }}
        role="img"
        /* One point has no "from … to …" to describe, and the plural form of
           the count matters to anyone reading by ear. */
        aria-label={pts.length === 1
          ? t('trendAriaOne', { date: dateOf(pts[0].at) })
          : t('trendAria', {
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
    </Frame>
  );
}
