import type { StringLogEntry, StringingJob } from './types';

/**
 * When did this member's strings last go on, and is it time again?
 *
 * Two sources, because neither is complete on its own:
 *   - the SHOP: a stringing job that reached `ready` or `picked_up`. Includes
 *     archived jobs — archiving takes a racket off the bench, it does not
 *     un-string it.
 *   - the member's own RESTRING LOG (`PlayerGear.stringLog`, written by the
 *     gear route since 2026-09-14): restrings done somewhere else. Only the
 *     entries that ARE restrings — see `restringEntries`.
 *
 * The later of the two wins. Neither present is `null` — "we don't know", which
 * must never render as "due".
 */

const STRUNG: ReadonlySet<StringingJob['status']> = new Set(['ready', 'picked_up']);

/** The latest moment any of these jobs became ready (or was collected). */
export function lastStrungFromJobs(jobs: Pick<StringingJob, 'history'>[]): string | null {
  let latest: string | null = null;
  for (const job of jobs) {
    for (const step of job.history ?? []) {
      if (!STRUNG.has(step.status)) continue;
      if (latest === null || Date.parse(step.at) > Date.parse(latest)) latest = step.at;
    }
  }
  return latest;
}

/**
 * The log entries that are a RESTRING rather than a string being put in the bag.
 *
 * The gear route logs on a string ADD and on a real tension change. An add is
 * the day someone told the app about their strings, not the day those strings
 * went on — logging a six-month-old bed today would otherwise read "last strung
 * this week". So the first entry for each string item is dropped, and so is an
 * entry with no item id (nothing to group it by). What is left are tension
 * changes on a string already in the bag, which is what a restring looks like.
 */
export function restringEntries(stringLog: StringLogEntry[] | undefined): StringLogEntry[] {
  const seen = new Set<string>();
  const out: StringLogEntry[] = [];
  for (const entry of stringLog ?? []) {
    if (!entry.stringItemId) continue;
    if (seen.has(entry.stringItemId)) out.push(entry);
    else seen.add(entry.stringItemId);
  }
  return out;
}

/** The later of the shop's date and the member's own restrings. */
export function lastStrungAt(
  fromJobs: string | null,
  stringLog: StringLogEntry[] | undefined,
): string | null {
  const candidates = [fromJobs, ...restringEntries(stringLog).map((e) => e.at)].filter(
    (at): at is string => typeof at === 'string' && Number.isFinite(Date.parse(at)),
  );
  if (candidates.length === 0) return null;
  return candidates.reduce((a, b) => (Date.parse(b) > Date.parse(a) ? b : a));
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** Whole weeks since `at`, never negative (a clock skew is "this week"). */
export function weeksSince(at: string, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - Date.parse(at)) / WEEK_MS));
}

export type RestringState = { due: boolean; weeks: number } | null;

/**
 * Whether to suggest a restring.
 *
 * `null` means no date at all — render nothing, never "due" on a guess.
 * Otherwise `weeks` is always reported (the card shows "Last strung N weeks
 * ago"), and `due` decides whether the copy becomes an invitation.
 */
export function restringState(last: string | null, now: Date): RestringState {
  if (last === null) return null;
  const weeks = weeksSince(last, now);
  // TODO(Grant): decide when `due` flips.
  return { due: false, weeks };
}
