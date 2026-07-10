import { describe, it, expect, vi, afterEach } from 'vitest';
import * as cosmos from '@/lib/cosmos';
import { resolveBirdUsages } from '@/lib/birdWrite';

// A minimal `birds` container stub: resolveBirdUsages only ever calls
// `.item(id, id).read()`, so that's all we implement.
function stubBirds(read: () => Promise<{ resource: unknown }>) {
  vi.spyOn(cosmos, 'getContainer').mockReturnValue({
    item: () => ({ read }),
  } as unknown as ReturnType<typeof cosmos.getContainer>);
}

describe('resolveBirdUsages', () => {
  afterEach(() => vi.restoreAllMocks());

  it('resolves a non-array input to an empty array (caller decides clear vs leave)', async () => {
    expect(await resolveBirdUsages(undefined)).toEqual({ ok: true, usages: [] });
    expect(await resolveBirdUsages(null)).toEqual({ ok: true, usages: [] });
  });

  it('drops tubes:0 entries and short-circuits before any read', async () => {
    const read = vi.fn();
    stubBirds(read as never);
    const r = await resolveBirdUsages([{ purchaseId: 'p1', tubes: 0 }]);
    expect(r).toEqual({ ok: true, usages: [] });
    expect(read).not.toHaveBeenCalled();
  });

  it('returns 503 when an inventory read throws (transient) — never a silent cost drop', async () => {
    stubBirds(() => Promise.reject(new Error('throttled')));
    const r = await resolveBirdUsages([{ purchaseId: 'p1', tubes: 1 }]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(503);
  });

  it('rejects an adjustment doc (no costPerTube → NaN cost) with 404', async () => {
    stubBirds(() => Promise.resolve({ resource: { id: 'a1', type: 'adjustment' } }));
    const r = await resolveBirdUsages([{ purchaseId: 'a1', tubes: 1 }]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(404);
  });

  it('returns 404 for an unknown purchase (read resolves undefined)', async () => {
    stubBirds(() => Promise.resolve({ resource: undefined }));
    const r = await resolveBirdUsages([{ purchaseId: 'gone', tubes: 1 }]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(404);
  });

  it('snapshots a valid purchase with the shared cost formula', async () => {
    stubBirds(() => Promise.resolve({ resource: { id: 'p1', name: 'Yonex AS-30', costPerTube: 12 } }));
    const r = await resolveBirdUsages([{ purchaseId: 'p1', tubes: 2 }]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.usages).toHaveLength(1);
      expect(r.usages[0]).toMatchObject({ purchaseId: 'p1', purchaseName: 'Yonex AS-30', tubes: 2, totalBirdCost: 24 });
    }
  });

  // A pooled entry (Model B: one "tubes used" number, no batch) snapshots at the
  // CURRENT price = the most recent purchase's costPerTube.
  function stubBirdsWithPurchases(purchases: unknown[], read?: () => Promise<{ resource: unknown }>) {
    vi.spyOn(cosmos, 'getContainer').mockReturnValue({
      item: () => ({ read: read ?? (() => Promise.resolve({ resource: undefined })) }),
      items: { query: () => ({ fetchAll: () => Promise.resolve({ resources: purchases }) }) },
    } as unknown as ReturnType<typeof cosmos.getContainer>);
  }

  it('snapshots a pooled entry at the current (latest) price-per-tube', async () => {
    stubBirdsWithPurchases([
      { costPerTube: 30, date: '2026-06-01' },
      { costPerTube: 35, date: '2026-07-01' }, // latest → $35 is the going rate
    ]);
    const r = await resolveBirdUsages([{ pooled: true, tubes: 1.25 }]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.usages).toHaveLength(1);
      expect(r.usages[0]).toMatchObject({
        purchaseId: 'pool', purchaseName: 'Shuttles', tubes: 1.25, costPerTube: 35, totalBirdCost: 43.75,
      });
    }
  });

  it('ignores adjustment docs when picking the current pooled price', async () => {
    stubBirdsWithPurchases([
      { costPerTube: 35, date: '2026-07-01' },
      { type: 'adjustment', date: '2026-07-05' }, // no costPerTube — must not win
    ]);
    const r = await resolveBirdUsages([{ pooled: true, tubes: 1 }]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.usages[0]).toMatchObject({ costPerTube: 35, totalBirdCost: 35 });
  });

  it('pooled tubes:0 is dropped (removes the shuttle line)', async () => {
    stubBirdsWithPurchases([{ costPerTube: 35, date: '2026-07-01' }]);
    const r = await resolveBirdUsages([{ pooled: true, tubes: 0 }]);
    expect(r).toEqual({ ok: true, usages: [] });
  });

  it('a manual pricePerTube overrides the auto (latest-purchase) price', async () => {
    stubBirdsWithPurchases([{ costPerTube: 35, date: '2026-07-01' }]);
    const r = await resolveBirdUsages([{ pooled: true, tubes: 2, pricePerTube: 40 }]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.usages[0]).toMatchObject({ costPerTube: 40, totalBirdCost: 80 });
  });

  it('falls back to a manual price when there are no purchases yet', async () => {
    stubBirdsWithPurchases([]); // auto price would be 0
    const r = await resolveBirdUsages([{ pooled: true, tubes: 1, pricePerTube: 35 }]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.usages[0]).toMatchObject({ costPerTube: 35, totalBirdCost: 35 });
  });

  it('rejects an out-of-range manual price with 400', async () => {
    stubBirdsWithPurchases([]);
    const r = await resolveBirdUsages([{ pooled: true, tubes: 1, pricePerTube: -5 }]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(400);
  });
});
