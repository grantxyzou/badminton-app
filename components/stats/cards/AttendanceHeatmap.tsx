'use client';

/**
 * GitHub-style attendance heatmap. 7 rows (day-of-week) × N columns (weeks).
 * Cells are colored by state:
 *   - empty   → no session that day
 *   - missed  → session existed but player didn't attend (outlined)
 *   - played  → session attended (solid accent)
 *
 * Width is 100% of container via viewBox; cell size scales with weeks.
 * Month labels render above columns where the month changes.
 */

const ACCENT = 'var(--accent, #22c55e)';
const MUTED = 'var(--text-muted)';

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY_LABELS = ['', 'Mon', '', 'Wed', '', 'Fri', ''];

interface HistoryEntry {
  sessionId: string;
  datetime: string | null;
  attended: boolean;
}

interface Props {
  history: HistoryEntry[];
  weeks: number; // 13 | 26 | 52
}

interface Cell {
  date: Date;
  state: 'empty' | 'missed' | 'played';
  title: string;
}

function startOfDay(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}

function toKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth()).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function AttendanceHeatmap({ history, weeks }: Props) {
  // Build a lookup: day-key → attendance state.
  const sessionDays = new Map<string, { attended: boolean }>();
  for (const h of history) {
    if (!h.datetime) continue;
    const d = startOfDay(new Date(h.datetime));
    sessionDays.set(toKey(d), { attended: h.attended });
  }

  // Compute the grid. Columns = weeks ending today. Each column is 7 days
  // (Sun at row 0 through Sat at row 6). The rightmost column contains today
  // and runs backward. We align to the current week end so the latest session
  // sits in the last column.
  const today = startOfDay(new Date());
  // Pull the end of this week (Saturday) as the grid's last day.
  const lastDay = new Date(today);
  lastDay.setDate(lastDay.getDate() + (6 - lastDay.getDay()));

  const totalDays = weeks * 7;
  const firstDay = new Date(lastDay);
  firstDay.setDate(firstDay.getDate() - (totalDays - 1));

  const columns: Cell[][] = [];
  const cursor = new Date(firstDay);
  for (let w = 0; w < weeks; w++) {
    const col: Cell[] = [];
    for (let d = 0; d < 7; d++) {
      const date = new Date(cursor);
      const key = toKey(date);
      const session = sessionDays.get(key);
      const isPast = date <= today;
      let state: Cell['state'] = 'empty';
      let title = date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
      if (session && isPast) {
        state = session.attended ? 'played' : 'missed';
        title += session.attended ? ' — played' : ' — missed';
      }
      col.push({ date, state, title });
      cursor.setDate(cursor.getDate() + 1);
    }
    columns.push(col);
  }

  // Sizing: cap cell size so 3M/6M zooms don't blow up cells to ~21px and
  // make the card visually huge. Cells are clamped to MAX_CELL; on narrower
  // zooms (3M = 13 weeks) the heatmap is content-sized + centered rather
  // than stretched to fill the card. MIN_CELL keeps 1Y readable.
  const MAX_CELL = 9;
  const MIN_CELL = 4;
  const gap = 2;
  const leftLabelW = 22;
  const topLabelH = 14;
  const targetW = 320;
  const cell = Math.max(
    MIN_CELL,
    Math.min(MAX_CELL, Math.floor((targetW - leftLabelW - (weeks - 1) * gap) / weeks)),
  );
  const gridW = weeks * cell + (weeks - 1) * gap;
  const gridH = 7 * cell + 6 * gap;
  const svgW = leftLabelW + gridW;
  const svgH = topLabelH + gridH;
  // Stabilize card height so 3M/6M/1Y don't reflow the parent. 7×MAX_CELL +
  // 6×gap + topLabelH = 89px is the tallest possible heatmap; we use it as
  // the wrapper min-height regardless of zoom.
  const STABLE_HEIGHT = 7 * MAX_CELL + 6 * gap + topLabelH;

  // Month labels along the top.
  const monthTicks: { x: number; label: string }[] = [];
  let lastMonth = -1;
  columns.forEach((col, i) => {
    const m = col[0].date.getMonth();
    if (m !== lastMonth) {
      monthTicks.push({ x: leftLabelW + i * (cell + gap), label: MONTHS_SHORT[m] });
      lastMonth = m;
    }
  });

  return (
    <div
      style={{
        minHeight: STABLE_HEIGHT,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
    <svg
      viewBox={`0 0 ${svgW} ${svgH}`}
      width="100%"
      role="img"
      aria-label="Attendance heatmap"
      style={{ display: 'block', maxWidth: svgW, margin: '0 auto' }}
    >
      {/* Month labels */}
      {monthTicks.map((t, i) => (
        <text
          key={i}
          x={t.x}
          y={10}
          fontSize={9}
          fill={MUTED}
          style={{ fontFamily: 'var(--font-mono)' }}
        >
          {t.label}
        </text>
      ))}

      {/* Day-of-week labels */}
      {DAY_LABELS.map((label, row) =>
        label ? (
          <text
            key={row}
            x={0}
            y={topLabelH + row * (cell + gap) + cell * 0.75}
            fontSize={9}
            fill={MUTED}
            style={{ fontFamily: 'var(--font-mono)' }}
          >
            {label}
          </text>
        ) : null,
      )}

      {/* Grid */}
      {columns.map((col, w) =>
        col.map((c, d) => {
          const x = leftLabelW + w * (cell + gap);
          const y = topLabelH + d * (cell + gap);
          let fill = 'var(--inner-card-bg)';
          let stroke = 'var(--inner-card-border)';
          let strokeWidth = 0.5;
          let opacity = 0.9;
          if (c.state === 'played') {
            fill = ACCENT;
            stroke = 'transparent';
            strokeWidth = 0;
            opacity = 1;
          } else if (c.state === 'missed') {
            fill = 'transparent';
            stroke = ACCENT;
            strokeWidth = 1;
            opacity = 0.55;
          }
          return (
            <rect
              key={`${w}-${d}`}
              x={x}
              y={y}
              width={cell}
              height={cell}
              rx={Math.max(1, Math.min(2, cell / 4))}
              fill={fill}
              stroke={stroke}
              strokeWidth={strokeWidth}
              opacity={opacity}
            >
              <title>{c.title}</title>
            </rect>
          );
        }),
      )}
    </svg>
    </div>
  );
}
