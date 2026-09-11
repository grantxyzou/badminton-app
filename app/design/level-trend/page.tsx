'use client';

import Link from 'next/link';
import LevelTrendChart from '@/components/stats/LevelTrendChart';
import type { UseCheckIn, CheckInSnapshot } from '@/components/stats/useCheckIn';

/* ────────────────────────────────────────────────────────────────────────
   Level trend — every state on one screen.

   This renders the REAL `LevelTrendChart`, not a copy of it. A specimen that
   reimplements its subject stops being evidence the moment either one moves,
   and this repo has the receipts for that failure mode (a copy rots). Only the
   DATA is fabricated — the component, its thresholds and its copy are the ones
   that ship.

   Six cases, and no two states may look alike. That is the whole point of
   the page: a failed read must never render as "one check-in so far" to a
   member with years of history.
──────────────────────────────────────────────────────────────────────── */

function stub(snapshots: CheckInSnapshot[], status: UseCheckIn['status'] = 'ready'): UseCheckIn {
  return {
    snapshots,
    status,
    latest: snapshots[snapshots.length - 1],
    previous: undefined,
    open: false,
    openFrom: () => {},
    close: () => {},
    reload: () => {},
    onSaved: () => {},
    savedAt: 0,
  };
}

const at = (iso: string, overall: number): CheckInSnapshot => ({ takenAt: `${iso}T00:00:00.000Z`, overall });

/** Two check-ins four months apart — the minimum that is honestly a line. */
const LESS = [at('2026-04-10', 2.5), at('2026-08-10', 2.9)];

/** A year of real-ish use: uneven gaps, a dip, a plateau, a recovery. Nobody
 *  improves monotonically and a specimen that pretends otherwise is no use for
 *  judging whether the line reads. */
const MORE = [
  at('2025-09-14', 1.9),
  at('2025-10-02', 2.2),
  at('2025-10-28', 2.1),
  at('2026-01-11', 2.6),
  at('2026-02-03', 2.6),
  at('2026-02-20', 2.4),
  at('2026-05-09', 3.1),
  at('2026-06-15', 3.3),
  at('2026-09-01', 3.2),
];

/** Two nearly identical readings. The y-axis is FIXED 1–5 and must not
 *  auto-scale: a 0.02 wobble drawn as a mountain would be a lie with a
 *  chart around it. */
const FLAT = [at('2026-04-10', 2.90), at('2026-08-10', 2.92)];

function Case({
  title,
  note,
  children,
}: {
  title: string;
  note: string;
  children: React.ReactNode;
}) {
  return (
    <section style={{ display: 'grid', gap: 'var(--space-3)' }}>
      <h2 className="bpm-h3" style={{ margin: 0 }}>{title}</h2>
      <p className="fs-sm" style={{ margin: 0, color: 'var(--text-muted)', maxWidth: '60ch' }}>{note}</p>
      {/* Same container the real one sits in, so the chart is judged on the
          surface it actually lands on rather than on a bare page. */}
      <div className="glass-card p-5">{children}</div>
    </section>
  );
}

export default function LevelTrendSpecimen() {
  return (
    <div style={{ display: 'grid', gap: 'var(--space-8)', paddingBottom: 'var(--space-9)' }}>
      <header style={{ display: 'grid', gap: 'var(--space-2)' }}>
        <Link href="/design" className="fs-sm" style={{ color: 'var(--accent)' }}>← Design</Link>
        <h1 className="bpm-h1" style={{ margin: 0 }}>Level trend</h1>
        <p className="fs-md" style={{ margin: 0, color: 'var(--text-secondary)', maxWidth: '62ch' }}>
          The real <code>LevelTrendChart</code> with fabricated data. It plots{' '}
          <code>(takenAt, overall)</code> straight off the stored check-ins — no new
          container, no new endpoint, and no <code>getCanonicalLevel</code>, which
          answers with a current value rather than a series.
        </p>
      </header>

      <Case
        title="More data"
        note="A year of real-ish use: uneven gaps, a dip in October, a plateau in February, a recovery through spring. The x-axis is TIME, so the three-month gap over winter is visibly wider than the three-week one before it — a chart indexed on sessions attended would space these evenly and quietly say something about turning up rather than about improving."
      >
        <LevelTrendChart checkIn={stub(MORE)} />
      </Case>

      <Case
        title="Less data"
        note="Two check-ins, four months apart. The minimum that is honestly a line."
      >
        <LevelTrendChart checkIn={stub(LESS)} />
      </Case>

      <Case
        title="One check-in — the invitation"
        note="The point, no line, and the sentence that makes the case for a second check-in structurally rather than by asking. It states a fact about the data, not a demand on the person: no week count, no 'overdue', nothing that scolds. Drawing a line through one point would be a claim about a trend that does not exist yet."
      >
        <LevelTrendChart checkIn={stub([at('2026-08-10', 2.9)])} />
      </Case>

      <Case
        title="Empty — no check-in at all"
        note="Same reserved height as a drawn chart, in the muted EMPTY voice rather than the alert voice. It used to render nothing and collapse the box, which made everything below it jump on each read. No axis is drawn — an axis with no data on it is furniture — but the space is still held."
      >
        <LevelTrendChart checkIn={stub([])} />
      </Case>

      <Case
        title="Error — the read failed"
        note="THE CASE THIS COMPONENT EXISTS TO GET RIGHT. A failed read and an empty history both arrive as an empty array. Rendering the one-check-in copy here would tell a member with years of history that they have none — the lying-empty-state rule, produced by the collapse itself. So the status is tri-state and this branch is a loud failure, never a quiet zero."
      >
        <LevelTrendChart checkIn={stub([], 'error')} />
      </Case>

      <Case
        title="Flat — two readings 0.02 apart"
        note="The y-axis is pinned to the 1–5 level scale and never scales to the data. Auto-scaling would turn this into a dramatic climb, which is the same dishonesty as a truncated bar chart."
      >
        <LevelTrendChart checkIn={stub(FLAT)} />
      </Case>
    </div>
  );
}
