/**
 * When a stringing request has waited too long (docs/plans/stringing-request-nudge.md).
 *
 * Pure, so the hourly nudge (`lib/stringingNudge.ts`), the bench's highlight
 * and a stringer's card read one rule. A request is WAITING while its status
 * is still `requested`: nobody has taken it, or the person who took it has not
 * moved it on. Grant, 2026-11-12: nudge at 48 hours and again at 3 days.
 */
import type { StringingJob } from './types';

const HOUR_MS = 60 * 60 * 1000;

/** The marks, in hours since the request was made. One nudge per mark passed. */
export const REQUEST_NUDGE_HOURS = [48, 72] as const;

type WaitingInput = Pick<StringingJob, 'status' | 'createdAt'> & {
  archivedAt?: string | null;
  cancelledAt?: string | null;
};

/** Whole hours since the request was made, or null when it is not waiting at all. */
export function waitingHours(job: WaitingInput, now: number): number | null {
  if (job.status !== 'requested') return null;
  if (job.archivedAt || job.cancelledAt) return null;
  const t = Date.parse(job.createdAt);
  if (Number.isNaN(t) || t > now) return null;
  return Math.floor((now - t) / HOUR_MS);
}

/** Past the first mark: the bench and the stringer's card highlight it.
 *  `now` defaults to the clock, like `todayIso()` for the due line, so a card
 *  does not call `Date.now()` itself while it renders. */
export function isWaitingTooLong(job: WaitingInput, now: number = Date.now()): boolean {
  const h = waitingHours(job, now);
  return h !== null && h >= REQUEST_NUDGE_HOURS[0];
}

/** Whole days waited, for "Waiting 2 days". Never below 1 once highlighted. */
export function waitingDays(job: WaitingInput, now: number = Date.now()): number {
  const h = waitingHours(job, now) ?? 0;
  return Math.max(1, Math.floor(h / 24));
}

/**
 * How many nudges the job SHOULD have had by `now`: the marks it has passed.
 * The job is owed one push when this is more than the nudges stamped on it.
 */
export function nudgesDue(job: WaitingInput, now: number): number {
  const h = waitingHours(job, now);
  if (h === null) return 0;
  return REQUEST_NUDGE_HOURS.filter((mark) => h >= mark).length;
}

/** Nudges already sent (stamped before each send). */
export function nudgesSent(job: Pick<StringingJob, 'requestNudgedAt'>): number {
  return Array.isArray(job.requestNudgedAt) ? job.requestNudgedAt.length : 0;
}
