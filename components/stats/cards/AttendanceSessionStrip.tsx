'use client';

/**
 * Recent-form attendance row. Shows the last N actual sessions as larger
 * played/missed dots (newest on the right) — a sports-style "form guide" that
 * reads well even with thin history, instead of a mostly-empty daily grid.
 *
 *   - played → solid accent dot
 *   - missed → outlined dot (session existed, player didn't attend)
 */

const ACCENT = 'var(--accent, #22c55e)';
const MUTED = 'var(--text-muted)';

interface HistoryEntry {
  sessionId: string;
  datetime: string | null;
  attended: boolean;
}

interface Props {
  history: HistoryEntry[];
  /** How many of the most-recent sessions to show. Default 8. */
  limit?: number;
}

function sessionDate(h: HistoryEntry): Date | null {
  if (h.datetime) return new Date(h.datetime);
  const m = h.sessionId.match(/(\d{4})-(\d{2})-(\d{2})/);
  return m ? new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00`) : null;
}

/** Chronological (oldest → newest), date-resolvable sessions only. Exported so
 *  the card can compute the "X of your last Y" counts from the same set. */
export function recentSessions(history: HistoryEntry[], limit = 8) {
  return history
    .map((h) => ({ ...h, date: sessionDate(h) }))
    .filter((h): h is HistoryEntry & { date: Date } => h.date !== null)
    .sort((a, b) => a.date.getTime() - b.date.getTime())
    .slice(-limit);
}

export default function AttendanceSessionStrip({ history, limit = 8 }: Props) {
  const sessions = recentSessions(history, limit);

  if (sessions.length === 0) {
    return (
      <p style={{ margin: 0, fontSize: 12, color: MUTED }}>
        No sessions in this window yet.
      </p>
    );
  }

  return (
    <div
      role="img"
      aria-label={`Recent form across the last ${sessions.length} session${sessions.length === 1 ? '' : 's'}`}
      style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}
    >
      {sessions.map((s) => {
        const label = `${s.date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} — ${s.attended ? 'played' : 'missed'}`;
        return (
          <div
            key={s.sessionId}
            title={label}
            aria-label={label}
            style={{
              width: 20,
              height: 20,
              borderRadius: '50%',
              flex: '0 0 auto',
              background: s.attended ? ACCENT : 'transparent',
              border: s.attended ? 'none' : `2px solid ${ACCENT}`,
              opacity: s.attended ? 1 : 0.5,
            }}
          />
        );
      })}
    </div>
  );
}
