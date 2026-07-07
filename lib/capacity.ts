/**
 * Signup capacity race resolver (#79).
 *
 * `POST /api/players` checks the active-player count and then inserts — two
 * separate Cosmos operations. Concurrent signups can both pass the check and
 * both land active, exceeding `maxPlayers` by 1–2 spots (the CLAUDE.md gotcha).
 *
 * The fix is a post-insert reconciliation: once a request's own record is
 * committed, it re-derives the active set and demotes itself if it's past the
 * cap. Correctness hinges on a **deterministic total order** every racer agrees
 * on — first-come-first-served by `timestamp`, with `id` as a stable tiebreak.
 * Because the order is derived only from committed fields, every concurrent
 * request computes the same ranking and only the ones beyond the cap step back,
 * so the active count converges to `<= maxPlayers` without any coordination.
 *
 * This module is the pure, deterministic core (no I/O) so the ranking is fully
 * unit-testable; the handler wraps it with the re-query + demote writes.
 */

export interface CapacityEntry {
  id: string;
  /** ISO 8601 signup time. Missing sorts earliest (keeps its spot). */
  timestamp?: string;
}

/** Stable total order: earliest `timestamp` first, `id` as tiebreak. */
export function compareBySignup(a: CapacityEntry, b: CapacityEntry): number {
  const at = a.timestamp ?? '';
  const bt = b.timestamp ?? '';
  if (at !== bt) return at < bt ? -1 : 1;
  if (a.id !== b.id) return a.id < b.id ? -1 : 1;
  return 0;
}

/**
 * The ids that are OVER capacity — ranked at or beyond `maxPlayers` in the
 * first-come order. Empty when the active set fits within the cap.
 */
export function overCapacityIds(active: CapacityEntry[], maxPlayers: number): Set<string> {
  const cap = Math.max(0, Math.floor(maxPlayers));
  if (active.length <= cap) return new Set();
  return new Set([...active].sort(compareBySignup).slice(cap).map((p) => p.id));
}

/** Whether `playerId` is beyond the cap in the deterministic first-come order. */
export function isOverCapacity(
  active: CapacityEntry[],
  playerId: string,
  maxPlayers: number,
): boolean {
  return overCapacityIds(active, maxPlayers).has(playerId);
}
