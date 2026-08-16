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

async function seed(): Promise<void> {
  // No-op in mock mode; creates the container in real Cosmos.
  await ensureContainer('equipmentCatalog', '/category');

  const container = getContainer('equipmentCatalog');
  const { resources } = await container.items
    .query({ query: 'SELECT c.id FROM c' })
    .fetchAll();
  const existing = new Set((resources as Array<{ id?: string }>).map((r) => r.id));

  const missing = SEED_ITEMS.filter((item) => !existing.has(item.id));
  if (missing.length === 0) return;

  // Upsert (not create) so a half-written row from an interrupted seed is
  // repaired rather than throwing a conflict.
  await Promise.all(missing.map((item) => container.items.upsert(item)));
  console.info(`[catalog-seed] seeded ${missing.length} catalog item(s)`);
}

/** Test seam — resets the cached promise between cases. */
export function __resetCatalogSeedForTests(): void {
  ready = null;
}
