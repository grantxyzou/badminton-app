/**
 * MEMBERS FIRST — the club's members get first pick of the spots until a set
 * time before the session; then the waitlist moves up in sign-up order
 * (docs/plans/members-first-window.md, Grant 2026-11-04: "Yes to all five").
 *
 * Pure and client-safe: Home, the Command Center and the server all read the
 * window through these, so the card that says "until Mon 11:59 PM" and the
 * route that decides cannot disagree.
 *
 * THE RULE IS STAMPED ON THE SESSION. Advance copies the club's setting onto
 * the new session (`Session.membersFirst`), and the end is worked out from
 * that and the session's own start. Changing the setting mid-week does not
 * move this week's window; moving the session's time moves its window with
 * it, so "Monday 11:59 PM" stays Monday 11:59 PM.
 *
 * THE CLUB'S CLOCK is Vancouver, the same pin every session time on screen
 * uses (CLAUDE.md Gotchas). "5 days before at 23:59" is a wall-clock time in
 * that zone, so a daylight-saving change between the two dates moves nothing.
 */

export interface MembersFirst {
  /** Calendar days before the session's day: 5 for a Saturday is the Monday. */
  daysBefore: number;
  /** The club's clock, 24-hour `HH:MM`. */
  time: string;
}

export const MEMBERS_FIRST_DAYS_MIN = 1;
export const MEMBERS_FIRST_DAYS_MAX = 6;

/** Six Feathers' rule — "11:59 p.m. every Monday" before a Saturday — and the style's default. */
export const DEFAULT_MEMBERS_FIRST: MembersFirst = { daysBefore: 5, time: '23:59' };

const CLUB_ZONE = 'America/Vancouver';

export function isMembersFirst(v: unknown): v is MembersFirst {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const r = v as Record<string, unknown>;
  if (Object.keys(r).some((k) => k !== 'daysBefore' && k !== 'time')) return false;
  return (
    typeof r.daysBefore === 'number' &&
    Number.isInteger(r.daysBefore) &&
    r.daysBefore >= MEMBERS_FIRST_DAYS_MIN &&
    r.daysBefore <= MEMBERS_FIRST_DAYS_MAX &&
    typeof r.time === 'string' &&
    /^([01]\d|2[0-3]):[0-5]\d$/.test(r.time)
  );
}

export function sameMembersFirst(a: MembersFirst | null, b: MembersFirst | null): boolean {
  if (a === null || b === null) return a === b;
  return a.daysBefore === b.daysBefore && a.time === b.time;
}

interface Wall { y: number; m: number; d: number; h: number; mi: number }

function wallAt(ms: number): Wall {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: CLUB_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(ms));
  const n = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? NaN);
  return { y: n('year'), m: n('month'), d: n('day'), h: n('hour') % 24, mi: n('minute') };
}

/** The instant the club's clock reads this wall time (two passes settle a DST edge). */
function instantOf(w: Wall): number {
  const asUtc = Date.UTC(w.y, w.m - 1, w.d, w.h, w.mi);
  const offset = (ms: number) => {
    const p = wallAt(ms);
    return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi) - Math.floor(ms / 60_000) * 60_000;
  };
  let t = asUtc - offset(asUtc);
  t = asUtc - offset(t);
  return t;
}

/**
 * When a rule ends for a session starting at `startIso`, or `null` when the
 * rule or the start is missing or the end would not fall before the start.
 */
export function membersFirstEnd(startIso: string | undefined, rule: unknown): string | null {
  if (!isMembersFirst(rule) || typeof startIso !== 'string') return null;
  const start = Date.parse(startIso);
  if (!Number.isFinite(start)) return null;
  const day = wallAt(start);
  const back = new Date(Date.UTC(day.y, day.m - 1, day.d - rule.daysBefore));
  const [h, mi] = rule.time.split(':').map(Number);
  const end = instantOf({ y: back.getUTCFullYear(), m: back.getUTCMonth() + 1, d: back.getUTCDate(), h, mi });
  return end < start ? new Date(end).toISOString() : null;
}

export interface WindowedSession {
  datetime?: string;
  settled?: unknown;
  membersFirst?: unknown;
  membersFirstReleasedAt?: string;
}

/** When this session's members-first window ends, or `null` if it has none. */
export function membersFirstUntil(session: WindowedSession | null | undefined): string | null {
  return session ? membersFirstEnd(session.datetime, session.membersFirst) : null;
}

/** Whether only members take a spot right now. Let in early by the organiser = closed. */
export function membersFirstOpen(session: WindowedSession | null | undefined, nowMs: number): boolean {
  const until = membersFirstUntil(session);
  return until !== null && !session?.membersFirstReleasedAt && nowMs < Date.parse(until);
}

/**
 * Whether the window has ended and nobody has let the waitlist in yet — the
 * one moment the next visit runs the promotion. Not once the session has
 * started or been settled: nothing moves then (lib/waitlistPromote.ts).
 */
export function membersFirstDue(session: WindowedSession | null | undefined, nowMs: number): boolean {
  const until = membersFirstUntil(session);
  if (until === null || session?.membersFirstReleasedAt || session?.settled) return false;
  const start = Date.parse(session?.datetime ?? '');
  return nowMs >= Date.parse(until) && Number.isFinite(start) && nowMs < start;
}
