/**
 * The Payments card's session calendar (docs/plans/payments-today-first.md):
 * which day a session falls on, what to say about the money on it, and the
 * month grid the picker draws. Pure, so the picker and its tests read one rule.
 */

/** What the picker marks on a session's day. */
export type SessionMoneyState =
  /** Somebody still owes (not paid, not covered). */
  | 'owe'
  /** Everybody on the roster has paid or been covered. */
  | 'paid'
  /** Nobody played, or the counts never answered for it: no dot. */
  | 'none';

export interface SessionCounts {
  unpaid: number;
  players: number;
}

const ID_DAY = /session-(\d{4}-\d{2}-\d{2})$/;

/**
 * How many sessions the calendar can show — nearly four years of weekly
 * nights. `GET /api/sessions` (the picker's list) and
 * `GET /api/sessions/history?counts=1` (its dots) both stop here, from the
 * one constant, so a day can never have a dot without a session or a session
 * without a dot.
 */
export const SESSION_CALENDAR_LIMIT = 200;

/**
 * The session's calendar day, `YYYY-MM-DD`. The id carries it for every
 * date-keyed session (`session-…` for BPM, `<group>:session-…` otherwise);
 * the legacy `current-session` doc falls back to its datetime read in the
 * club's zone — the same Vancouver pin every session time on screen uses.
 */
export function sessionDay(s: { id: string; datetime?: string }): string | null {
  const m = ID_DAY.exec(s.id);
  if (m) return m[1];
  if (!s.datetime) return null;
  const d = new Date(s.datetime);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Vancouver', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

/**
 * The money state of one session. The viewed session passes its LIVE roster
 * counts, so a "Mark paid" tap moves its dot at once; the rest read the
 * history counts. A session neither has answered for gets no dot — unknown
 * is not "all paid".
 */
export function sessionMoneyState(live: SessionCounts | null, history: SessionCounts | undefined): SessionMoneyState {
  const counts = live ?? history ?? null;
  if (!counts || counts.players === 0) return 'none';
  return counts.unpaid > 0 ? 'owe' : 'paid';
}

/** A Sunday-first month grid: leading blanks, then 1…n, padded to whole weeks. */
export function monthCells(year: number, month: number): (number | null)[] {
  const first = new Date(year, month, 1).getDay();
  const days = new Date(year, month + 1, 0).getDate();
  const cells: (number | null)[] = [...Array<null>(first).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

/** `YYYY-MM` of a day key. */
export const monthKey = (day: string) => day.slice(0, 7);

/** `YYYY-MM-DD` for a cell in a viewed month. */
export function dayKey(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** True when any session in a month BEFORE `ym` still owes — the dot on ‹. */
export function earlierMonthOwes(states: Map<string, SessionMoneyState>, ym: string): boolean {
  for (const [day, state] of states) {
    if (state === 'owe' && monthKey(day) < ym) return true;
  }
  return false;
}
