import type { BirdPurchase } from './types';

/** The recency window (days) that splits "recent" purchases from "older" ones. */
export const RECENT_WINDOW_DAYS = 60;

export interface PurchaseGroups {
  /** Purchases dated within the last `windowDays`, newest-first. */
  recent: BirdPurchase[];
  /** Purchases dated before the window, newest-first. */
  older: BirdPurchase[];
}

/**
 * Split bird purchases into `recent` (dated within the last `windowDays`) and
 * `older` (dated before that), each sorted newest-first.
 *
 * A purchase whose `date` does not parse to a finite time is excluded from
 * BOTH groups (it can't be placed on the timeline) — matching the two
 * independent `Number.isFinite(t)` filters this replaces in `BirdsPage`.
 * The boundary is inclusive on the recent side (`date >= cutoff` → recent).
 *
 * `nowMs` is injectable so the split is deterministically testable.
 */
export function splitPurchasesByRecency(
  purchases: BirdPurchase[],
  nowMs: number = Date.now(),
  windowDays: number = RECENT_WINDOW_DAYS,
): PurchaseGroups {
  const cutoff = nowMs - windowDays * 86_400_000;
  const newestFirst = (a: BirdPurchase, b: BirdPurchase) => (a.date < b.date ? 1 : -1);
  const recent: BirdPurchase[] = [];
  const older: BirdPurchase[] = [];
  for (const p of purchases) {
    const t = new Date(p.date).getTime();
    if (!Number.isFinite(t)) continue; // unparseable date → neither list
    if (t >= cutoff) recent.push(p);
    else older.push(p);
  }
  return { recent: recent.sort(newestFirst), older: older.sort(newestFirst) };
}
