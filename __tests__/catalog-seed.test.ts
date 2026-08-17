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
let queryCalls = 0;

vi.mock('@/lib/cosmos', () => ({
  ensureContainer: vi.fn(async () => {}),
  getContainer: vi.fn(() => ({
    items: {
      query: () => ({
        fetchAll: async () => {
          queryCalls++;
          return { resources: existingIds.map((id) => ({ id })) };
        },
      }),
      upsert: async (doc: unknown) => { upserts.push(doc); return { resource: doc }; },
    },
  })),
}));

const SEED_COUNT = 50; // scripts/data/equipment-catalog.json

async function freshModule() {
  vi.resetModules();
  return import('@/lib/catalogSeed');
}

beforeEach(() => {
  upserts.length = 0;
  existingIds = [];
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

  it('writes nothing when the catalog is already fully seeded', async () => {
    const { ensureCatalogSeeded } = await freshModule();
    // Pre-populate with every seed id.
    const first = await import('../scripts/data/equipment-catalog.json');
    existingIds = (first.default ?? first).items.map((i: { id: string }) => i.id);
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
