import type { Session, PrevSessionSnapshot } from './types';

/** Closed set of anomaly codes the system can produce. Adding a new code
 *  requires adding to this union, which forces every consumer (server, UI,
 *  type narrowing) to handle it. Catches the previous typo-tolerant
 *  `code: string` flow where a misspelled dismissal silently never matched. */
export type AnomalyCode =
  | 'cost_changed'
  | 'courts_changed'
  | 'max_players_changed'
  | 'long_break'
  | 'skip_date';

export type AnomalySeverity = 'info' | 'warning' | 'blocking';

/** Discriminated by code — and by extension severity/dismissable, since
 *  the (severity, dismissable) pairing is fixed per code. The illegal
 *  combo `severity: 'blocking' & dismissable: true` is unrepresentable. */
export type Anomaly =
  | { code: 'skip_date'; severity: 'blocking'; message: string; dismissable: false }
  | { code: Exclude<AnomalyCode, 'skip_date'>; severity: 'warning'; message: string; dismissable: true };

const LONG_BREAK_THRESHOLD_DAYS = 21;
const MS_PER_DAY = 86_400_000;

export function detectSettingsDrift(
  session: Session,
  snapshot: PrevSessionSnapshot | undefined,
): AnomalyCode[] {
  if (!snapshot) return [];
  const codes: AnomalyCode[] = [];
  if ((session.costPerCourt ?? 0) !== snapshot.costPerCourt) codes.push('cost_changed');
  if (session.courts !== snapshot.courtCount) codes.push('courts_changed');
  if (session.maxPlayers !== snapshot.maxPlayers) codes.push('max_players_changed');
  return codes;
}

export function detectLongBreak(
  prevDatetime: string | undefined,
  currentDatetime: string | undefined,
): boolean {
  if (!prevDatetime || !currentDatetime) return false;
  const prev = new Date(prevDatetime).getTime();
  const curr = new Date(currentDatetime).getTime();
  if (!Number.isFinite(prev) || !Number.isFinite(curr)) return false;
  return (curr - prev) > LONG_BREAK_THRESHOLD_DAYS * MS_PER_DAY;
}

/**
 * True when the current session's local-calendar date appears in the
 * admin's skipDates list. Uses the LOCAL date portion of the ISO string
 * (the part BEFORE the 'T'), which is what `withLocalTz` writes —
 * matching what an admin actually types when entering '2026-05-20'.
 *
 * A naive `.slice(0, 10)` on the full ISO string is correct only when
 * the offset doesn't push the wall-clock day across a UTC midnight. For
 * tz-stamped strings produced by withLocalTz this is fine; for any other
 * shape we fall back to a Date-parse path.
 */
export function detectSkipDate(
  currentDatetime: string | undefined,
  skipDates: string[] | undefined,
): boolean {
  if (!currentDatetime || !skipDates || skipDates.length === 0) return false;
  const localDate = toLocalIsoDate(currentDatetime);
  if (!localDate) return false;
  return skipDates.includes(localDate);
}

function toLocalIsoDate(iso: string): string {
  // withLocalTz output is 'YYYY-MM-DDTHH:MM:00±HH:MM'. The local calendar
  // date is the YYYY-MM-DD portion before the 'T'. Extract directly when
  // possible — this preserves the local date even on negative-offset
  // sessions whose UTC equivalent is the prior day.
  const tIdx = iso.indexOf('T');
  if (tIdx === 10) return iso.slice(0, 10);
  // Fallback: parse and use Date methods. Handles ISO strings without
  // an offset (treated as UTC by JS).
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

interface EvaluateInput {
  session: Session;
  prevSnapshot: PrevSessionSnapshot | undefined;
  prevSessionDatetime: string | undefined;
  skipDates: string[] | undefined;
  /** Codes the admin has already dismissed for this session. Wider type
   *  (`string[]`) because storage may contain legacy entries — we narrow
   *  to AnomalyCode internally with a type guard. */
  dismissed: string[];
}

export function evaluateAnomalies(input: EvaluateInput): Anomaly[] {
  const { session, prevSnapshot, prevSessionDatetime, skipDates, dismissed } = input;
  const out: Anomaly[] = [];

  for (const code of detectSettingsDrift(session, prevSnapshot)) {
    if (code === 'skip_date') continue; // can't actually be returned by detectSettingsDrift; satisfies TS
    out.push({
      code,
      severity: 'warning',
      message: messageFor(code, session, prevSnapshot),
      dismissable: true,
    });
  }

  if (detectLongBreak(prevSessionDatetime, session.datetime)) {
    out.push({
      code: 'long_break',
      severity: 'warning',
      message: 'It has been more than 21 days since the last session. Settings might be stale.',
      dismissable: true,
    });
  }

  if (detectSkipDate(session.datetime, skipDates)) {
    const date = session.datetime ? toLocalIsoDate(session.datetime) : '';
    out.push({
      code: 'skip_date',
      severity: 'blocking',
      message: `${date || 'This date'} is on your skip list. Did you mean to advance?`,
      dismissable: false,
    });
  }

  const dismissedSet = new Set(dismissed);
  return out.filter((a) => !dismissedSet.has(a.code));
}

function messageFor(code: AnomalyCode, session: Session, snapshot: PrevSessionSnapshot | undefined): string {
  if (!snapshot) return code;
  switch (code) {
    case 'cost_changed':
      return `Cost is $${session.costPerCourt ?? 0}/court this week, was $${snapshot.costPerCourt} last week. Confirm?`;
    case 'courts_changed':
      return `Courts changed from ${snapshot.courtCount} to ${session.courts}.`;
    case 'max_players_changed':
      return `Max players changed from ${snapshot.maxPlayers} to ${session.maxPlayers}.`;
    default:
      return code;
  }
}
