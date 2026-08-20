import { getContainer, ensureContainer } from './cosmos';
import catalogSeed from '../scripts/data/equipment-catalog.json';
import type { CatalogItem } from './types';

const SEED_ITEMS = catalogSeed.items as unknown as CatalogItem[];

/**
 * Ensures the `equipmentCatalog` container exists AND has the curated seed in
 * it. Cached-promise style, like every other lazy container bootstrap here.
 *
 * ## Why this exists
 *
 * `lib/cosmos.ts` seeds the catalog from the same JSON — but that block lives
 * in the MOCK-store path, so it only ever ran in local dev. Against real
 * Cosmos, `ensureContainer` created an empty container and nothing filled it:
 * `scripts/seed-equipment-catalog.mjs` was written to POST the items to
 * `/api/equipment/catalog`, but that route only ever got a `GET` (the script's
 * own docstring says "the POST endpoint lands in a follow-up PR" — it never
 * did). Net effect: the production catalog held **zero rackets** from day one,
 * so the picker rendered an empty list and `/api/recommend` had nothing to
 * recommend. Both deployments share one Cosmos DB, so both were starved.
 *
 * Seeding here — rather than in a script someone has to remember to run —
 * means the catalog cannot be empty again, including after a container is
 * recreated or a new DB is provisioned.
 *
 * ## Behaviour
 *
 * - Runs in mock mode too, deliberately. `lib/cosmos.ts` does seed the mock
 *   catalog, but only as a side effect of touching `sessions`/`members`, so a
 *   cold dev server that opens straight to Stats → Equipment shows an empty
 *   picker until something else happens to hit those containers. Seeding here
 *   as well makes mock and prod behave identically — the parity CLAUDE.md asks
 *   for — and both writes are id-idempotent, so they can't fight.
 * - Reads existing ids once, then upserts only the missing ones. Cheap on the
 *   common path (one query, zero writes), self-heals a partial seed, and picks
 *   up newly curated models on the next cold start.
 * - Ids in the seed JSON are deterministic (`racket-yonex-astrox-88d-pro`), so
 *   re-running can never duplicate a row.
 * - On failure the cached promise is cleared so the next request retries
 *   instead of latching a permanent failure.
 */
let ready: Promise<void> | null = null;

export function ensureCatalogSeeded(): Promise<void> {
  if (!ready) {
    ready = seed().catch((err) => {
      ready = null;
      throw err;
    });
  }
  return ready;
}

/** Order-independent signature of the fields the seed owns. Cosmos does not
 *  guarantee key order matches the source JSON, so a plain JSON.stringify
 *  would report every row as drifted and rewrite the whole catalog on every
 *  cold start. Sorting keys makes the steady state a genuine no-op. */
function seedSignature(item: Partial<CatalogItem>): string {
  return JSON.stringify(
    { brand: item.brand, model: item.model, msrp: item.msrp, skillRange: item.skillRange, attributes: item.attributes, sources: item.sources },
    (_key, value) =>
      value && typeof value === 'object' && !Array.isArray(value)
        ? Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
        : value,
  );
}

async function seed(): Promise<void> {
  // No-op in mock mode; creates the container in real Cosmos.
  await ensureContainer('equipmentCatalog', '/category');

  const container = getContainer('equipmentCatalog');
  const { resources } = await container.items
    .query({ query: 'SELECT c.id, c.seeded, c.brand, c.model, c.msrp, c.skillRange, c.attributes, c.sources FROM c' })
    .fetchAll();
  const existing = new Map(
    (resources as Array<Partial<CatalogItem> & { id?: string }>).map((r) => [r.id, r]),
  );

  // Refresh, don't just fill. This used to upsert only ids that were absent,
  // which is right for a growing catalog and wrong for one whose rows change
  // SHAPE. The v2 import added normalized `balance`/`flex`/`tier` to 39 rows
  // that already existed in Cosmos — the file gained them, the database never
  // did, and `isScorable` silently skipped 50 of 71 rackets in production
  // while every local test passed (in dev the JSON file IS the catalog).
  //
  // Only rows this seeder owns (`seeded: true`) are refreshed. The catalog
  // route is GET-only today so nothing else writes here, but an admin-authored
  // row must never be reverted by a deploy if that ever changes.
  const stale = SEED_ITEMS.filter((item) => {
    const current = existing.get(item.id);
    if (!current) return true;
    if (current.seeded !== true) return false;
    return seedSignature(current) !== seedSignature(item);
  });
  if (stale.length === 0) return;

  // Upsert (not create) so a half-written row from an interrupted seed is
  // repaired rather than throwing a conflict.
  await Promise.all(stale.map((item) => container.items.upsert(item)));
  console.info(`[catalog-seed] seeded/refreshed ${stale.length} catalog item(s)`);
}

/** Test seam — resets the cached promise between cases. */
export function __resetCatalogSeedForTests(): void {
  ready = null;
}
