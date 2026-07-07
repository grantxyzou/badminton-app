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
});
