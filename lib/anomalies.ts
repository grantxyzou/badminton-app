import type { Session, PrevSessionSnapshot } from './types';

/** Closed set of anomaly codes the system can produce. Adding a new code
 *  requires adding to this union, which forces every consumer (server, UI,
 *  type narrowing) to handle it. Catches the previous typo-tolerant
 *  `code: string` flow where a misspelled dismissal silently never matched. */
export type AnomalyCode =
  | 'cost_changed'
  | 'courts_changed'
  | 'max_players_changed'
  | 'deadline_changed'
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
const MS_PER_HOUR = 3_600_000;

/**
 * How far the sign-up deadline may drift before it is worth mentioning.
 *
 * Not zero, and the reason is DST. A weekly session that crosses a boundary
 * moves its wall-clock offset by exactly one hour through nobody's decision,
 * and a warning that fires twice a year for something no one did is a warning
 * people learn to dismiss without reading — which costs you the one that
 * matters. Six hours ignores that and any hand-tidying of the time, while
 * still catching the half-day and full-day moves that change whether someone
 * gets a chance to sign up.
 */
const DEADLINE_DRIFT_TOLERANCE_HOURS = 6;

/** Hours from session start to deadline. Negative when the deadline is
 *  before the session, which is the normal case. `null` when the session has
 *  no deadline (or one that does not parse). The advance route writes this
 *  same function's answer into the snapshot, so the two sides of the
 *  comparison below cannot be computed two ways. */
export function deadlineOffsetHours(session: Session): number | null {
  if (!session.datetime || !session.deadline) return null;
  const start = new Date(session.datetime).getTime();
  const deadline = new Date(session.deadline).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(deadline)) return null;
  return (deadline - start) / MS_PER_HOUR;
}

/**
 * What the snapshot says about last week's deadline. Three answers, and the
 * first two are not the same thing:
 *
 * - `undefined` — the snapshot never recorded it (a doc written before the
 *   field existed, or built by hand). Nothing to compare, so nothing fires.
 * - `null` — recorded as NONE: sign-ups stayed open. Written as `null` since
 *   2026-10-21; before that the advance route wrote `0` for a missing
 *   deadline, and a deadline AT the session's own start closes nothing, so a
 *   stored `0` reads as none on either side of that date.
 * - a number — hours from start to the deadline it had.
 */
function snapshotDeadlineOffset(snapshot: PrevSessionSnapshot): number | null | undefined {
  const raw = snapshot.deadlineOffsetHours;
  if (raw === undefined) return undefined;
  if (raw === null || !Number.isFinite(raw) || raw === 0) return null;
  return raw;
}

export function detectSettingsDrift(
  session: Session,
  snapshot: PrevSessionSnapshot | undefined,
): AnomalyCode[] {
  if (!snapshot) return [];
  const codes: AnomalyCode[] = [];
  if ((session.costPerCourt ?? 0) !== snapshot.costPerCourt) codes.push('cost_changed');
  if (session.courts !== snapshot.courtCount) codes.push('courts_changed');
  if (session.maxPlayers !== snapshot.maxPlayers) codes.push('max_players_changed');

  /* The snapshot has RECORDED `deadlineOffsetHours` since it was introduced
     and SetupPage has displayed it, but nothing ever compared it — so the
     2026-09-03 session closed sign-ups on a Tuesday when every prior week
     closed on a Wednesday, and the only anomaly raised was maxPlayers going
     11 -> 12. A day less to sign up is a bigger deal to a player than one
     extra spot.

     The comparison is SYMMETRIC. A deadline that was there last week and is
     gone this week means sign-ups that used to close now stay open, and the
     first cut (2026-08-28) never said so — it compared only when both sides
     had one. Presence against absence fires with no tolerance: the tolerance
     exists for DST moving an offset an hour, and there is no DST story for
     "removed". A snapshot that never recorded the offset fires nothing. */
  const offset = deadlineOffsetHours(session);
  const was = snapshotDeadlineOffset(snapshot);
  if (was !== undefined) {
    if (offset === null || was === null) {
      if (offset !== was) codes.push('deadline_changed');
    } else if (Math.abs(offset - was) >= DEADLINE_DRIFT_TOLERANCE_HOURS) {
      codes.push('deadline_changed');
    }
  }

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
    case 'deadline_changed': {
      /* Said in hours-before, not as a signed offset: "-47" is a number an
         admin has to decode, and the thing they need to judge is how much
         notice their friends get. */
      const now = deadlineOffsetHours(session);
      const prev = snapshotDeadlineOffset(snapshot);
      const before = now === null ? null : Math.round(-now);
      const was = prev === null || prev === undefined ? null : Math.round(-prev);
      if (before !== null && was !== null) {
        return `Sign-ups close ${before}h before this session, was ${was}h last week.`;
      }
      if (before !== null) {
        return `Sign-ups close ${before}h before this session; last week they stayed open.`;
      }
      if (was !== null) {
        return `Sign-ups stay open this week; last week they closed ${was}h before the session.`;
      }
      return 'Sign-ups now close at a different time than last week.';
    }
    default:
      return code;
  }
}
