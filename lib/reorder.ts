/**
 * Moving one item in a short, ordered list.
 *
 * The rate card's order is EDITORIAL — `normalisePricing` preserves it on
 * purpose, because cheapest-first or most-common-first is the stringer's call
 * and not the app's. So the list needs a way to be rearranged, and this is the
 * whole of the logic behind it.
 *
 * Pure and UI-agnostic on purpose. A first cut of this was a pointer-events
 * drag hook; the arithmetic below is the part that survived, and it is the part
 * where the off-by-ones live. Keeping it separate from the buttons means the
 * cases that actually break — a move that drops or duplicates a row — are
 * testable without a browser.
 */

/**
 * The array with `from` moved to `to`.
 *
 * Never mutates: the caller keeps the original for optimistic rollback, and a
 * splice in place would corrupt the value it rolls back to.
 *
 * Out-of-range is a no-op copy rather than a throw. Callers derive `to` from
 * `index ± 1` at the ends of a list, so asking for an impossible move is an
 * ordinary event, not a bug worth crashing a rate card over.
 */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  const out = [...list];
  if (from < 0 || from >= out.length || to < 0 || to >= out.length || from === to) return out;
  const [item] = out.splice(from, 1);
  out.splice(to, 0, item);
  return out;
}

/** Whether a row can move in a direction — for disabling the end buttons. */
export function canMove(index: number, delta: -1 | 1, length: number): boolean {
  const to = index + delta;
  return to >= 0 && to < length;
}
