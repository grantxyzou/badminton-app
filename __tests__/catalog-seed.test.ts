// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * The production `equipmentCatalog` container was created empty and never
 * filled — the seed script's POST endpoint was never built — so the racket
 * picker and /api/recommend both had zero data from day one. This covers the
 * self-seed that replaces that script.
 *
 * The real-Cosmos branch can't be exercised against a live DB from CI, so the
 * Cosmos client is faked at the module boundary and we assert the *shape* of
 * what it does: read ids once, upsert only what's missing, never duplicate.
 */

const upserts: unknown[] = [];
let existingIds: string[] = [];
/** Rows the fake Cosmos returns. Defaults to id-only rows built from
 *  `existingIds`; a test can set this directly to simulate rows whose SHAPE
 *  has drifted from the seed file. */
let existingRows: Array<Record<string, unknown>> | null = null;
let queryCalls = 0;

vi.mock('@/lib/cosmos', () => ({
  ensureContainer: vi.fn(async () => {}),
  getContainer: vi.fn(() => ({
    items: {
      query: () => ({
        fetchAll: async () => {
          queryCalls++;
          return { resources: existingRows ?? existingIds.map((id) => ({ id })) };
        },
      }),
      upsert: async (doc: unknown) => { upserts.push(doc); return { resource: doc }; },
    },
  })),
}));

const SEED_COUNT = 71; // scripts/data/equipment-catalog.json (50 + 21 from v2 import)

async function freshModule() {
  vi.resetModules();
  return import('@/lib/catalogSeed');
}

beforeEach(() => {
  upserts.length = 0;
  existingIds = [];
  existingRows = null;
  queryCalls = 0;
  process.env.COSMOS_CONNECTION_STRING = 'fake-connection-string';
});

afterEach(() => {
  delete process.env.COSMOS_CONNECTION_STRING;
  vi.restoreAllMocks();
});

describe('ensureCatalogSeeded', () => {
  it('seeds in mock mode too, so local dev matches prod', async () => {
    // lib/cosmos.ts only seeds the mock catalog as a side effect of touching
    // sessions/members, so a cold dev server opened straight to Stats →
    // Equipment used to show an empty picker.
    delete process.env.COSMOS_CONNECTION_STRING;
    const { ensureCatalogSeeded } = await freshModule();
    await ensureCatalogSeeded();
    expect(upserts).toHaveLength(SEED_COUNT);
  });

  it('seeds the full curated catalog when the container is empty', async () => {
    const { ensureCatalogSeeded } = await freshModule();
    await ensureCatalogSeeded();
    expect(upserts).toHaveLength(SEED_COUNT);
    // Deterministic ids, and real racket rows — not placeholders.
    const ids = upserts.map((d) => (d as { id: string }).id);
    expect(ids).toContain('racket-yonex-astrox-88d-pro');
    expect(new Set(ids).size).toBe(SEED_COUNT);
  });

  it('writes nothing when every row already matches the seed file', async () => {
    // Must supply FULL rows, not just ids: an id-only row has no `seeded: true`
    // and would be skipped by the ownership guard, so this test would pass
    // even with the signature comparison completely broken.
    const seedItems = (await import('../scripts/data/equipment-catalog.json')).default.items as Array<Record<string, unknown>>;
    existingRows = seedItems.map((i) => ({ ...i }));

    const { ensureCatalogSeeded } = await freshModule();
    await ensureCatalogSeeded();
    expect(upserts).toHaveLength(0);
  });

  it('repairs a partial seed by upserting only the missing rows', async () => {
    const { ensureCatalogSeeded } = await freshModule();
    existingIds = ['racket-yonex-astrox-88d-pro'];
    await ensureCatalogSeeded();
    expect(upserts).toHaveLength(SEED_COUNT - 1);
    expect(upserts.map((d) => (d as { id: string }).id))
      .not.toContain('racket-yonex-astrox-88d-pro');
  });

  // The v2 import changed the SHAPE of rows that already existed in Cosmos.
  // The old seeder only inserted MISSING ids, so those rows never gained
  // `balance`/`flex`/`tier` in production and `isScorable` silently skipped
  // them — 50 of 71 rackets unrecommendable, while every local test passed
  // because in dev the JSON file IS the catalog.
  it('refreshes a row whose shape drifted from the seed file', async () => {
    const seedItems = (await import('../scripts/data/equipment-catalog.json')).default.items as Array<Record<string, unknown>>;
    const first = seedItems[0];
    // Present, seeded, but carrying the pre-v2 attribute shape.
    existingRows = seedItems.map((i) => ({ ...i }));
    existingRows[0] = { ...first, seeded: true, attributes: { weight: '4U' } };

    const { ensureCatalogSeeded } = await freshModule();
    await ensureCatalogSeeded();

    expect(upserts).toHaveLength(1);
    expect((upserts[0] as { id: string }).id).toBe(first.id);
    expect((upserts[0] as { attributes: Record<string, unknown> }).attributes).toEqual(first.attributes);
  });

  // Key order is not guaranteed by Cosmos. A naive JSON.stringify comparison
  // would call every row stale and rewrite the whole catalog on every cold
  // start — expensive and invisible.
  it('treats a row with the same data in a different key order as unchanged', async () => {
    const seedItems = (await import('../scripts/data/equipment-catalog.json')).default.items as Array<Record<string, unknown>>;
    existingRows = seedItems.map((i) => {
      const attrs = i.attributes as Record<string, unknown> | undefined;
      const reversed = attrs ? Object.fromEntries(Object.entries(attrs).reverse()) : attrs;
      return { ...i, attributes: reversed };
    });

    const { ensureCatalogSeeded } = await freshModule();
    await ensureCatalogSeeded();

    expect(upserts).toHaveLength(0);
  });

  // Nothing but this seeder writes catalog rows today (the route is GET-only),
  // but a deploy must never revert an admin-authored row if that changes.
  it('never overwrites a row it does not own', async () => {
    const seedItems = (await import('../scripts/data/equipment-catalog.json')).default.items as Array<Record<string, unknown>>;
    existingRows = seedItems.map((i) => ({ ...i }));
    existingRows[0] = { ...seedItems[0], seeded: false, msrp: 999, attributes: { hand: 'curated' } };

    const { ensureCatalogSeeded } = await freshModule();
    await ensureCatalogSeeded();

    expect(upserts).toHaveLength(0);
  });

  it('caches the promise — a second call does no extra work', async () => {
    const { ensureCatalogSeeded } = await freshModule();
    await ensureCatalogSeeded();
    const afterFirst = upserts.length;
    await ensureCatalogSeeded();
    expect(upserts).toHaveLength(afterFirst); // no duplicate writes
    expect(queryCalls).toBe(1);               // and no duplicate reads
  });

  it('clears the cached promise on failure so the next request retries', async () => {
    const { ensureCatalogSeeded, __resetCatalogSeedForTests } = await freshModule();
    __resetCatalogSeedForTests();
    const cosmos = await import('@/lib/cosmos');
    vi.mocked(cosmos.ensureContainer).mockRejectedValueOnce(new Error('cosmos down'));

    await expect(ensureCatalogSeeded()).rejects.toThrow('cosmos down');
    // Latching the failure would leave the catalog permanently empty.
    await expect(ensureCatalogSeeded()).resolves.toBeUndefined();
    expect(upserts).toHaveLength(SEED_COUNT);
  });
});
