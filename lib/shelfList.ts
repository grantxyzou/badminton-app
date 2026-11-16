/**
 * THE SHELF LIST's rules — client-safe, no I/O (Grant, 2026-11-16, on the
 * canvas: "The strings should just be a list, no container … consider large
 * list inventories").
 *
 * Every string on the shelf has one STATUS, and the list groups by it in this
 * order: low on stock, out of stock, mismatched (more strung than was ever
 * logged), on the shelf, no stock logged. Within a group, A–Z. A shelf of
 * more than `LARGE_SHELF` strings gets a search, one row of filters (each
 * status, each brand, "not in the catalog") and group labels, and the groups
 * that need nobody ("on the shelf", "no stock logged") start FOLDED — what
 * needs you is the first screen, what is fine is one tap or a search away
 * (Grant, 2026-11-16, canvas v3: "isn't this list a little long?"). A search
 * or a filter opens every group, so a match is never inside a folded one. A
 * smaller shelf is just the list, in the same order.
 */

export type ShelfStatus = 'low' | 'out' | 'mismatched' | 'shelf' | 'none';

/** The groups, top to bottom. */
export const SHELF_STATUS_ORDER: readonly ShelfStatus[] = ['low', 'out', 'mismatched', 'shelf', 'none'];
/** The groups that need someone: drawn in the warning colour. */
export const NEEDS_YOU: ReadonlySet<ShelfStatus> = new Set(['low', 'out', 'mismatched']);

/** More strings than this and the list gets its search, filters and labels. */
export const LARGE_SHELF = 8;
/** The groups a large shelf starts with folded: nobody needs to act on them. */
export const FOLDED_BY_DEFAULT: ReadonlySet<ShelfStatus> = new Set(['shelf', 'none']);

export interface ShelfEntry {
  label: string;
  /** The linked catalog item's maker; null when the string is not in the catalog. */
  brand: string | null;
  status: ShelfStatus;
}

/**
 * One string's status from its stock line. Unknown stock (nothing bought,
 * never counted) is `none`; more strung than logged is `mismatched`, ahead of
 * "none left", because it says why; then out, then low (at or under the low
 * line, or a reorder warning from the usage rate).
 */
export function shelfStatus(i: {
  hasStock: boolean;
  remainingSets: number;
  overdrawnSets: number;
  low: boolean;
  reorder: 'now' | 'soon' | 'ok' | null;
}): ShelfStatus {
  if (!i.hasStock) return 'none';
  if (i.overdrawnSets > 0) return 'mismatched';
  if (i.remainingSets <= 0) return 'out';
  if (i.low || i.reorder === 'now' || i.reorder === 'soon') return 'low';
  return 'shelf';
}

/** A filter: everything, one status, one brand, or the strings not in the catalog. */
export type ShelfFilter = { kind: 'all' } | { kind: 'status'; status: ShelfStatus } | { kind: 'brand'; brand: string } | { kind: 'other' };
export interface ShelfChip { id: string; filter: ShelfFilter; count: number }

export const filterId = (f: ShelfFilter) =>
  f.kind === 'all' ? 'all' : f.kind === 'status' ? `status:${f.status}` : f.kind === 'brand' ? `brand:${f.brand}` : 'other';

const byName = (a: ShelfEntry, b: ShelfEntry) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base', numeric: true });

function matchesFilter(e: ShelfEntry, f: ShelfFilter): boolean {
  if (f.kind === 'all') return true;
  if (f.kind === 'status') return e.status === f.status;
  if (f.kind === 'brand') return e.brand === f.brand;
  return e.brand === null;
}

/**
 * The filter row: All, then each status that needs someone and has a string,
 * then each brand A–Z, then "not in the catalog" when any string is. A chip
 * with nothing under it is never shown.
 */
export function shelfChips(entries: readonly ShelfEntry[]): ShelfChip[] {
  const chips: ShelfChip[] = [{ id: 'all', filter: { kind: 'all' }, count: entries.length }];
  for (const status of SHELF_STATUS_ORDER) {
    if (!NEEDS_YOU.has(status)) continue;
    const count = entries.filter((e) => e.status === status).length;
    if (count > 0) chips.push({ id: filterId({ kind: 'status', status }), filter: { kind: 'status', status }, count });
  }
  const brands = [...new Set(entries.map((e) => e.brand).filter((b): b is string => !!b))].sort((a, b) => a.localeCompare(b));
  for (const brand of brands) {
    chips.push({ id: filterId({ kind: 'brand', brand }), filter: { kind: 'brand', brand }, count: entries.filter((e) => e.brand === brand).length });
  }
  const other = entries.filter((e) => e.brand === null).length;
  if (other > 0) chips.push({ id: 'other', filter: { kind: 'other' }, count: other });
  return chips;
}

export interface ShelfGroup<T extends ShelfEntry> {
  status: ShelfStatus;
  /** The rows to draw: empty while the group is folded. */
  entries: T[];
  /** Every string in the group, folded or not — what its label counts. */
  count: number;
  folded: boolean;
}

/**
 * The groups to draw, after the search (name contains it, any case) and the
 * filter. Empty groups are dropped. While nothing narrows the list, a group
 * named in `folded` draws no rows (its label says how many); a search or a
 * filter shows every match.
 */
export function shelfGroups<T extends ShelfEntry>(
  entries: readonly T[],
  opts: { query?: string; filter?: ShelfFilter; folded?: ReadonlySet<ShelfStatus> } = {},
): ShelfGroup<T>[] {
  const q = (opts.query ?? '').trim().toLowerCase();
  const filter = opts.filter ?? { kind: 'all' };
  const narrowed = q !== '' || filter.kind !== 'all';
  const shown = entries.filter((e) => (q === '' || e.label.toLowerCase().includes(q)) && matchesFilter(e, filter));
  const groups: ShelfGroup<T>[] = [];
  for (const status of SHELF_STATUS_ORDER) {
    const all = shown.filter((e) => e.status === status).sort(byName);
    if (all.length === 0) continue;
    const folded = !narrowed && !!opts.folded?.has(status);
    groups.push({ status, entries: folded ? [] : all, count: all.length, folded });
  }
  return groups;
}
