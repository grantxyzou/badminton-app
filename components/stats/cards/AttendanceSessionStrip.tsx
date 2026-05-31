'use client';

/**
 * Session-oriented attendance strip. One cell per ACTUAL session in the window
 * (not per calendar day) — so a once-a-week game reads densely instead of as a
 * mostly-empty 7×52 daily grid.
 *
 *   - played → solid accent
 *   - missed → outlined (session existed, player didn't attend)
 *
 * Cells run chronologically left→right and wrap. Each cell tooltips its date +
 * status. Meaningful even with only a handful of sessions of history.
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
}

function sessionDate(h: HistoryEntry): Date | null {
  if (h.datetime) return new Date(h.datetime);
  // Fall back to the date-keyed sessionId ("session-YYYY-MM-DD") if datetime
  // is absent on a legacy record.
  const m = h.sessionId.match(/(\d{4})-(\d{2})-(\d{2})/);
  return m ? new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00`) : null;
}

export default function AttendanceSessionStrip({ history }: Props) {
  // Chronological order (oldest → newest, latest on the right).
  const sessions = history
    .map((h) => ({ ...h, date: sessionDate(h) }))
    .filter((h): h is HistoryEntry & { date: Date } => h.date !== null)
    .sort((a, b) => a.date.getTime() - b.date.getTime());

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
      aria-label={`Attendance across ${sessions.length} session${sessions.length === 1 ? '' : 's'}`}
      style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}
    >
      {sessions.map((s) => {
        const label = `${s.date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} — ${s.attended ? 'played' : 'missed'}`;
        return (
          <div
            key={s.sessionId}
            title={label}
            aria-label={label}
            style={{
              width: 16,
              height: 16,
              borderRadius: 4,
              flex: '0 0 auto',
              background: s.attended ? ACCENT : 'transparent',
              border: s.attended ? 'none' : `1.5px solid ${ACCENT}`,
              opacity: s.attended ? 1 : 0.55,
            }}
          />
        );
      })}
    </div>
  );
}
