import type { StringingJob } from './types';

/**
 * The restring reminder: once it has been long enough since a racket came back
 * from the shop, the Home card suggests another.
 *
 * SHOP JOBS ONLY, on purpose (Grant, 2026-09-14: "Only show up for people who
 * got stringing with me"). The member's own restring log was considered and
 * left out — it records strings done elsewhere, and a string added to the bag
 * logs an entry on the day it was TYPED, not the day it went on.
 */

/** Two months, the way a player hears "time for a restring". */
export const RESTRING_AFTER_WEEKS = 8;

const STRUNG: ReadonlySet<StringingJob['status']> = new Set(['ready', 'picked_up']);

/**
 * The latest moment any of these jobs became ready (or was collected).
 * Archived jobs belong in the input — archiving takes a racket off the bench,
 * it does not un-string it.
 */
export function lastStrungFromJobs(jobs: Pick<StringingJob, 'history'>[]): string | null {
  let latest: string | null = null;
  for (const job of jobs) {
    for (const step of job.history ?? []) {
      if (!STRUNG.has(step.status) || !Number.isFinite(Date.parse(step.at))) continue;
      if (latest === null || Date.parse(step.at) > Date.parse(latest)) latest = step.at;
    }
  }
  return latest;
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** Whole weeks since `at`, never negative (a clock skew is "this week"). */
export function weeksSince(at: string, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - Date.parse(at)) / WEEK_MS));
}

/**
 * Whole weeks since the shop last strung for this member, or `null` when there
 * is nothing to say: never used the shop, an unreadable date, or not yet due.
 * The card renders only a number, so "not due" and "unknown" both render
 * nothing — there is no quiet "last strung 3 weeks ago" line.
 */
export function restringDueWeeks(lastStrungAt: string | null, now: Date): number | null {
  if (lastStrungAt === null || !Number.isFinite(Date.parse(lastStrungAt))) return null;
  const weeks = weeksSince(lastStrungAt, now);
  return weeks >= RESTRING_AFTER_WEEKS ? weeks : null;
}
