import { describe, it, expect, beforeEach } from 'vitest';
import {
  resetMockStore,
  setupAdminPin,
  makeAdminRequest,
  makeRequest,
  seedPointer,
  seedSession,
  seedAdminMember,
} from './helpers';
import { POST as createPurchase, GET as getBirds } from '@/app/api/birds/route';
import { POST as reconcile } from '@/app/api/birds/reconcile/route';

describe('Birds reconcile API', () => {
  beforeEach(() => {
    setupAdminPin();
    resetMockStore();
    seedAdminMember();
  });

  async function seedStock(tubes: number, used = 0) {
    const res = await createPurchase(makeAdminRequest('POST', 'http://localhost:3000/api/birds', {
      name: 'Stock', tubes, totalCost: tubes * 10,
    }));
    const { id } = await res.json();
    if (used > 0) {
      seedPointer('session-2026-05-10');
      seedSession('session-2026-05-10', {
        birdUsages: [{ purchaseId: id, purchaseName: 'Stock', tubes: used, costPerTube: 10, totalBirdCost: used * 10 }],
      });
    }
    return id;
  }

  it('records a negative adjustment and lowers currentStock to the counted total', async () => {
    await seedStock(10, 2); // computed stock = 8
    const res = await reconcile(makeAdminRequest('POST', 'http://localhost:3000/api/birds/reconcile', {
      countedTotal: 6, reason: '2 water-damaged',
    }));
    const data = await res.json();
    expect(res.status).toBe(201);
    expect(data.delta).toBe(-2);
    expect(data.currentStock).toBe(6);

    // GET now reflects the adjustment.
    const getRes = await getBirds(makeAdminRequest('GET', 'http://localhost:3000/api/birds'));
    const birds = await getRes.json();
    expect(birds.currentStock).toBe(6);
    expect(birds.totalAdjustments).toBe(-2);
    // Adjustment docs must NOT leak into the purchases list.
    expect(birds.purchases).toHaveLength(1);
    expect(birds.adjustments).toHaveLength(1);
  });

  it('records a positive adjustment when the physical count is higher', async () => {
    await seedStock(4); // computed stock = 4
    const res = await reconcile(makeAdminRequest('POST', 'http://localhost:3000/api/birds/reconcile', {
      countedTotal: 5,
    }));
    const data = await res.json();
    expect(res.status).toBe(201);
    expect(data.delta).toBe(1);
    expect(data.currentStock).toBe(5);
  });

  it('rejects a no-op count that already matches', async () => {
    await seedStock(4);
    const res = await reconcile(makeAdminRequest('POST', 'http://localhost:3000/api/birds/reconcile', {
      countedTotal: 4,
    }));
    expect(res.status).toBe(400);
  });

  it('rejects a negative counted total', async () => {
    await seedStock(4);
    const res = await reconcile(makeAdminRequest('POST', 'http://localhost:3000/api/birds/reconcile', {
      countedTotal: -1,
    }));
    expect(res.status).toBe(400);
  });

  it('rejects non-admin', async () => {
    const res = await reconcile(makeRequest('POST', 'http://localhost:3000/api/birds/reconcile', {
      countedTotal: 5,
    }));
    expect(res.status).toBe(401);
  });
});
