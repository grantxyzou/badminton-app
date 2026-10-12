import { groupScope } from './groupScope';
import { labelKey, readStringCatalog, readStringPurchases, stockBand, summarizeStringStock, type StockBand } from './stringStock';
import { readClubGearDocs } from './clubGearDocs';
import { tallyClubGear } from './clubGear';
import type { CatalogItem, StringingJob } from './types';

/**
 * The player-facing extras on `GET /api/stringing/strings`
 * (docs/design/strings-shelf-spec.md): a stock BAND per offered label and how
 * many on the roster play it. Server-only — it reads purchases, jobs and bags.
 */

const SHELF_TTL_MS = 60_000;

export interface ShelfExtras {
  stock: Record<string, StockBand>;
  players: Record<string, number>;
}

/**
 * Stock and the club count, per group, for a minute. Stock needs every
 * purchase and every job the club has ever logged, and the count needs every
 * bag on the roster — too much to read on each open of the Stringing tab.
 * A minute is short enough that a reel the stringer just logged shows up by
 * the time they have walked back to the court.
 *
 * Real Cosmos only, like the catalog memo: the mock store is reset between
 * tests and a cache over it would answer one test with another's shelf.
 */
const shelfCache = new Map<string, { at: number; value: ShelfExtras }>();

function cacheEnabled(): boolean {
  return Boolean(process.env.COSMOS_CONNECTION_STRING);
}

/** Test hook: the cache is module state and outlives a mock-store reset. */
export function resetShelfCache(): void {
  shelfCache.clear();
}

export async function readShelfExtras(
  groupId: string,
  strings: string[],
  links: Record<string, string>,
  aliases: Record<string, string> = {},
): Promise<ShelfExtras> {
  const cached = cacheEnabled() ? shelfCache.get(groupId) : undefined;
  if (cached && Date.now() - cached.at < SHELF_TTL_MS) return cached.value;

  const scope = groupScope(groupId);
  const [purchases, catalog, jobs, gear] = await Promise.all([
    readStringPurchases(scope),
    readStringCatalog(),
    // Every job, archived included: a racket strung last winter still used a set.
    scope.query<StringingJob>('stringingJobs', { select: 'c.id, c.stringLabel, c.status, c.archivedAt' }),
    readClubGearDocs(groupId),
  ]);

  const summary = summarizeStringStock({ offered: strings, links, aliases, purchases, jobs, catalog });
  const offeredKeys = new Map(strings.map((l) => [labelKey(l), l]));
  const stock: Record<string, StockBand> = {};
  for (const line of summary.lines) {
    // Only offered labels: a line for a string no longer on the list is the
    // admin's bookkeeping, not something a player is choosing between.
    const label = offeredKeys.get(labelKey(line.label));
    const band = stockBand(line);
    if (label && band) stock[label] = band;
  }

  // Matched by label, and for a linked string by the catalog's own name too
  // — a bag item picked from the catalog is labelled "<brand> <model>", which
  // is rarely how the stringer spelled the shelf label.
  const tally = new Map(tallyClubGear(gear).filter((e) => e.category === 'string').map((e) => [labelKey(e.label), e.count]));
  const players: Record<string, number> = {};
  for (const label of strings) {
    const item: CatalogItem | undefined = links[label] ? catalog.get(links[label]) : undefined;
    const count = tally.get(labelKey(label)) ?? (item ? tally.get(labelKey(`${item.brand} ${item.model}`)) : undefined);
    if (count !== undefined) players[label] = count;
  }

  const value = { stock, players };
  if (cacheEnabled()) shelfCache.set(groupId, { at: Date.now(), value });
  return value;
}

/** After the list changes, the stock and count keyed by it may have too. */
export function forgetShelfExtras(groupId: string): void {
  shelfCache.delete(groupId);
}
