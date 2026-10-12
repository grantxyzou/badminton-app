/**
 * When to reorder shuttles — ONE rule for every admin surface.
 *
 * The Birds tile, the Birds page and Profile's "N need you" used to disagree:
 * the tile went by tubes on hand (< 5 alert, < 10 warn), the page by weeks of
 * runway (< 2 now, < 4 soon) and Profile by "4 weeks or fewer" — and Profile
 * skipped an empty cupboard entirely, because zero stock divided out to
 * "unknown". Weeks of runway is the honest measure (ten tubes is plenty for a
 * one-court club and a fortnight's worry for a four-court one), and an
 * empty cupboard at a club that uses birds is "reorder now".
 *
 * Pure and import-free: the tiles and Profile are client components.
 */
export type BirdReorder = 'now' | 'soon' | 'ok';

export const REORDER_NOW_WEEKS = 2;
export const REORDER_SOON_WEEKS = 4;

/** Weeks the stock lasts at the current burn; `null` when the burn is unknown. */
export function birdWeeksLeft(stock: number, burnPerSession: number): number | null {
  // No usage to measure against is "unknown" — even at zero stock, which for
  // a club that has never logged a tube means "not tracking", not "run out".
  if (burnPerSession <= 0) return null;
  return Math.max(0, stock) / burnPerSession;
}

/** `null` when there is no telling — some stock and no burn history yet. */
export function birdReorder(stock: number, burnPerSession: number): BirdReorder | null {
  const weeks = birdWeeksLeft(stock, burnPerSession);
  if (weeks === null) return null;
  if (weeks < REORDER_NOW_WEEKS) return 'now';
  if (weeks < REORDER_SOON_WEEKS) return 'soon';
  return 'ok';
}
