import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as cosmos from '@/lib/cosmos';
import {
  resetMockStore,
  setupAdminPin,
  makeAdminRequest,
  makeRequest,
  makeGetRequest,
  seedPointer,
  seedSession,
  seedAdminMember,
} from './helpers';
import { GET, POST, DELETE, PATCH } from '@/app/api/birds/route';
import { POST as reconcile } from '@/app/api/birds/reconcile/route';

describe('Birds API', () => {
  beforeEach(() => {
    setupAdminPin();
    resetMockStore();
    seedAdminMember();
  });

  describe('POST /api/birds', () => {
    it('creates a purchase with required fields', async () => {
      const res = await POST(makeAdminRequest('POST', 'http://localhost:3000/api/birds', {
        name: 'Victor Master No.3',
        tubes: 4,
        totalCost: 80,
        date: '2026-04-03',
      }));
      const data = await res.json();

      expect(res.status).toBe(201);
      expect(data.name).toBe('Victor Master No.3');
      expect(data.tubes).toBe(4);
      expect(data.totalCost).toBe(80);
      expect(data.costPerTube).toBe(20);
    });

    it('creates a purchase with optional fields', async () => {
      const res = await POST(makeAdminRequest('POST', 'http://localhost:3000/api/birds', {
        name: 'Ling-Mei 60',
        tubes: 2,
        totalCost: 50,
        speed: 77,
        qualityRating: 4,
        notes: 'Good for doubles',
      }));
      const data = await res.json();

      expect(res.status).toBe(201);
      expect(data.speed).toBe(77);
      expect(data.qualityRating).toBe(4);
      expect(data.notes).toBe('Good for doubles');
    });

    it('rejects missing name', async () => {
      const res = await POST(makeAdminRequest('POST', 'http://localhost:3000/api/birds', {
        tubes: 4, totalCost: 80,
      }));
      expect(res.status).toBe(400);
    });

    it('rejects tubes <= 0', async () => {
      const res = await POST(makeAdminRequest('POST', 'http://localhost:3000/api/birds', {
        name: 'Test', tubes: 0, totalCost: 80,
      }));
      expect(res.status).toBe(400);
    });

    it('rejects cost <= 0', async () => {
      const res = await POST(makeAdminRequest('POST', 'http://localhost:3000/api/birds', {
        name: 'Test', tubes: 4, totalCost: 0,
      }));
      expect(res.status).toBe(400);
    });

    it('rejects non-admin', async () => {
      const res = await POST(makeRequest('POST', 'http://localhost:3000/api/birds', {
        name: 'Test', tubes: 4, totalCost: 80,
      }));
      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/birds', () => {
    it('returns purchases and current stock', async () => {
      // Add a purchase first
      await POST(makeAdminRequest('POST', 'http://localhost:3000/api/birds', {
        name: 'Victor Master No.3', tubes: 4, totalCost: 80,
      }));

      const res = await GET(makeAdminRequest('GET', 'http://localhost:3000/api/birds'));
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.purchases).toHaveLength(1);
      expect(data.currentStock).toBe(4);
      expect(data.purchases[0].name).toBe('Victor Master No.3');
    });

    it('rejects non-admin', async () => {
      const res = await GET(makeGetRequest('http://localhost:3000/api/birds'));
      expect(res.status).toBe(401);
    });

    it('currentStock deducts across array usages and legacy single-object sessions', async () => {
      // One purchase with 10 tubes
      const createRes = await POST(makeAdminRequest('POST', 'http://localhost:3000/api/birds', {
        name: 'Shared Tube', tubes: 10, totalCost: 100,
      }));
      const { id: purchaseId } = await createRes.json();

      // Session A: new array shape, consumes 2 + 1.5 tubes
      seedPointer('session-2026-04-05');
      seedSession('session-2026-04-05', {
        birdUsages: [
          { purchaseId, purchaseName: 'Shared Tube', tubes: 2, costPerTube: 10, totalBirdCost: 20 },
          { purchaseId, purchaseName: 'Shared Tube', tubes: 1.5, costPerTube: 10, totalBirdCost: 15 },
        ],
      });
      // Session B: legacy single-object shape, consumes 0.5 tubes
      seedSession('session-2026-04-12', {
        birdUsage: {
          purchaseId, purchaseName: 'Shared Tube', tubes: 0.5, costPerTube: 10, totalBirdCost: 5,
        },
      });

      const res = await GET(makeAdminRequest('GET', 'http://localhost:3000/api/birds'));
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.totalPurchased).toBe(10);
      expect(data.totalUsed).toBe(4); // 2 + 1.5 + 0.5
      expect(data.currentStock).toBe(6);
      // Per-purchase remaining drives the create-session picker's stock filter.
      expect(data.remainingByPurchase[purchaseId]).toBe(6);
    });

    it('reports remainingByPurchase=0 for a fully-used purchase', async () => {
      const createRes = await POST(makeAdminRequest('POST', 'http://localhost:3000/api/birds', {
        name: 'Depleted', tubes: 2, totalCost: 20,
      }));
      const { id: purchaseId } = await createRes.json();

      seedPointer('session-2026-05-01');
      seedSession('session-2026-05-01', {
        birdUsages: [
          { purchaseId, purchaseName: 'Depleted', tubes: 2, costPerTube: 10, totalBirdCost: 20 },
        ],
      });

      const res = await GET(makeAdminRequest('GET', 'http://localhost:3000/api/birds'));
      const data = await res.json();
      expect(data.remainingByPurchase[purchaseId]).toBe(0);
    });

    it('returns 503 when the read throws (not a lying 200 + zero stock)', async () => {
      vi.spyOn(cosmos, 'getContainer').mockImplementation(() => {
        throw new Error('cosmos down');
      });
      try {
        const res = await GET(makeAdminRequest('GET', 'http://localhost:3000/api/birds'));
        expect(res.status).toBe(503);
        const body = await res.json();
        expect(body.error).toBeTruthy();
      } finally {
        vi.restoreAllMocks();
      }
    });

    it('clamps over-consumed stock at 0 and reports the overshoot as stockDrift', async () => {
      // Purchase 2 tubes, but sessions recorded 5 used (e.g. the purchase was
      // edited down after the fact) → raw stock would be -3.
      const createRes = await POST(makeAdminRequest('POST', 'http://localhost:3000/api/birds', {
        name: 'Over-used', tubes: 2, totalCost: 20,
      }));
      const { id: purchaseId } = await createRes.json();

      seedPointer('session-2026-05-08');
      seedSession('session-2026-05-08', {
        birdUsages: [
          { purchaseId, purchaseName: 'Over-used', tubes: 5, costPerTube: 10, totalBirdCost: 50 },
        ],
      });

      const res = await GET(makeAdminRequest('GET', 'http://localhost:3000/api/birds'));
      const data = await res.json();
      expect(data.currentStock).toBe(0);        // clamped, never negative
      expect(data.stockDrift).toBe(3);          // overshoot surfaced, not hidden
      expect(data.remainingByPurchase[purchaseId]).toBe(0); // per-purchase clamp
    });

    it('GET stock and reconcile agree: counting exactly the displayed stock is a no-op', async () => {
      await POST(makeAdminRequest('POST', 'http://localhost:3000/api/birds', {
        name: 'Parity', tubes: 10, totalCost: 100,
      }));
      const { id: purchaseId } = (await (await GET(makeAdminRequest('GET', 'http://localhost:3000/api/birds'))).json()).purchases[0];
      seedPointer('session-2026-05-15');
      seedSession('session-2026-05-15', {
        birdUsages: [
          { purchaseId, purchaseName: 'Parity', tubes: 0.25, costPerTube: 10, totalBirdCost: 2.5 },
          { purchaseId, purchaseName: 'Parity', tubes: 0.5, costPerTube: 10, totalBirdCost: 5 },
        ],
      });

      const getData = await (await GET(makeAdminRequest('GET', 'http://localhost:3000/api/birds'))).json();
      expect(getData.currentStock).toBe(9.25);
      const res = await reconcile(makeAdminRequest('POST', 'http://localhost:3000/api/birds/reconcile', {
        countedTotal: getData.currentStock,
      }));
      // Same number on both sides → "already matches" (400 no-op), never a
      // spurious penny adjustment.
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toMatch(/already matches/i);
    });

    it('off-grid legacy usage: counting zero reconciles to exactly minus the displayed stock', async () => {
      // 0.1-tube values are off the 0.25 grid AND inexact in binary — the
      // raw-sum-round-once rule must keep GET's displayed stock and
      // reconcile's delta in exact agreement anyway.
      await POST(makeAdminRequest('POST', 'http://localhost:3000/api/birds', {
        name: 'OffGrid', tubes: 10, totalCost: 100,
      }));
      const { id: purchaseId } = (await (await GET(makeAdminRequest('GET', 'http://localhost:3000/api/birds'))).json()).purchases[0];
      seedPointer('session-2026-05-22');
      seedSession('session-2026-05-22', {
        birdUsages: [
          { purchaseId, purchaseName: 'OffGrid', tubes: 0.1, costPerTube: 10, totalBirdCost: 1 },
          { purchaseId, purchaseName: 'OffGrid', tubes: 0.1, costPerTube: 10, totalBirdCost: 1 },
          { purchaseId, purchaseName: 'OffGrid', tubes: 0.1, costPerTube: 10, totalBirdCost: 1 },
        ],
      });

      const getData = await (await GET(makeAdminRequest('GET', 'http://localhost:3000/api/birds'))).json();
      const res = await reconcile(makeAdminRequest('POST', 'http://localhost:3000/api/birds/reconcile', {
        countedTotal: 0,
      }));
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.delta).toBe(-getData.currentStock);
    });
  });

  describe('DELETE /api/birds', () => {
    it('deletes a purchase', async () => {
      // Create then delete
      const createRes = await POST(makeAdminRequest('POST', 'http://localhost:3000/api/birds', {
        name: 'Test', tubes: 2, totalCost: 40,
      }));
      const { id } = await createRes.json();

      const res = await DELETE(makeAdminRequest('DELETE', 'http://localhost:3000/api/birds', { id }));
      expect(res.status).toBe(200);
    });

    it('refuses (409) to delete a purchase that sessions still reference', async () => {
      const createRes = await POST(makeAdminRequest('POST', 'http://localhost:3000/api/birds', {
        name: 'Referenced', tubes: 4, totalCost: 80,
      }));
      const { id } = await createRes.json();

      seedPointer('session-2026-06-01');
      seedSession('session-2026-06-01', {
        datetime: '2026-06-01T19:00:00-04:00',
        birdUsages: [
          { purchaseId: id, purchaseName: 'Referenced', tubes: 2, costPerTube: 20, totalBirdCost: 40 },
        ],
      });

      const res = await DELETE(makeAdminRequest('DELETE', 'http://localhost:3000/api/birds', { id }));
      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.error).toMatch(/used by 1 session/i);
      expect(body.error).toMatch(/move its tubes/i);
      expect(body.sessionCount).toBe(1);
      expect(body.sessionDates).toEqual(['2026-06-01T19:00:00-04:00']);

      // Doc untouched — still visible in GET, stock math intact.
      const getData = await (await GET(makeAdminRequest('GET', 'http://localhost:3000/api/birds'))).json();
      expect(getData.purchases).toHaveLength(1);
      expect(getData.currentStock).toBe(2);
    });

    it('still deletes an adjustment doc (reconcile undo) even when sessions have usage', async () => {
      const createRes = await POST(makeAdminRequest('POST', 'http://localhost:3000/api/birds', {
        name: 'Stocked', tubes: 4, totalCost: 80,
      }));
      const { id: purchaseId } = await createRes.json();
      seedPointer('session-2026-06-08');
      seedSession('session-2026-06-08', {
        birdUsages: [
          { purchaseId, purchaseName: 'Stocked', tubes: 1, costPerTube: 20, totalBirdCost: 20 },
        ],
      });
      // Create an adjustment via reconcile, then undo it via DELETE.
      const recRes = await reconcile(makeAdminRequest('POST', 'http://localhost:3000/api/birds/reconcile', {
        countedTotal: 2,
      }));
      const { adjustment } = await recRes.json();

      const res = await DELETE(makeAdminRequest('DELETE', 'http://localhost:3000/api/birds', { id: adjustment.id }));
      expect(res.status).toBe(200);
    });

    it('rejects missing id', async () => {
      const res = await DELETE(makeAdminRequest('DELETE', 'http://localhost:3000/api/birds', {}));
      expect(res.status).toBe(400);
    });

    it('rejects non-admin', async () => {
      const res = await DELETE(makeRequest('DELETE', 'http://localhost:3000/api/birds', { id: 'test' }));
      expect(res.status).toBe(401);
    });
  });

  describe('PATCH /api/birds', () => {
    it('updates name only', async () => {
      const createRes = await POST(makeAdminRequest('POST', 'http://localhost:3000/api/birds', {
        name: 'Old Name', tubes: 4, totalCost: 80,
      }));
      const { id } = await createRes.json();

      const res = await PATCH(makeAdminRequest('PATCH', 'http://localhost:3000/api/birds', {
        id, name: 'New Name',
      }));
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.name).toBe('New Name');
      expect(data.tubes).toBe(4);
      expect(data.costPerTube).toBe(20);
    });

    it('updates tubes and totalCost, recalculates costPerTube', async () => {
      const createRes = await POST(makeAdminRequest('POST', 'http://localhost:3000/api/birds', {
        name: 'Test', tubes: 4, totalCost: 80,
      }));
      const { id } = await createRes.json();

      const res = await PATCH(makeAdminRequest('PATCH', 'http://localhost:3000/api/birds', {
        id, tubes: 2, totalCost: 50,
      }));
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.tubes).toBe(2);
      expect(data.totalCost).toBe(50);
      expect(data.costPerTube).toBe(25);
    });

    it('updates optional fields', async () => {
      const createRes = await POST(makeAdminRequest('POST', 'http://localhost:3000/api/birds', {
        name: 'Test', tubes: 4, totalCost: 80,
      }));
      const { id } = await createRes.json();

      const res = await PATCH(makeAdminRequest('PATCH', 'http://localhost:3000/api/birds', {
        id, speed: 78, qualityRating: 5, notes: 'Updated notes',
      }));
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.speed).toBe(78);
      expect(data.qualityRating).toBe(5);
      expect(data.notes).toBe('Updated notes');
    });

    it('clears optional fields when set to null', async () => {
      const createRes = await POST(makeAdminRequest('POST', 'http://localhost:3000/api/birds', {
        name: 'Test', tubes: 4, totalCost: 80, speed: 77, notes: 'Some notes',
      }));
      const { id } = await createRes.json();

      const res = await PATCH(makeAdminRequest('PATCH', 'http://localhost:3000/api/birds', {
        id, speed: null, notes: null,
      }));
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.speed).toBeUndefined();
      expect(data.notes).toBeUndefined();
    });

    it('returns 404 for unknown id', async () => {
      const res = await PATCH(makeAdminRequest('PATCH', 'http://localhost:3000/api/birds', {
        id: 'does-not-exist', name: 'Ghost',
      }));
      expect(res.status).toBe(404);
    });

    it('rejects missing id', async () => {
      const res = await PATCH(makeAdminRequest('PATCH', 'http://localhost:3000/api/birds', {
        name: 'Test',
      }));
      expect(res.status).toBe(400);
    });

    it('rejects empty name', async () => {
      const createRes = await POST(makeAdminRequest('POST', 'http://localhost:3000/api/birds', {
        name: 'Test', tubes: 4, totalCost: 80,
      }));
      const { id } = await createRes.json();

      const res = await PATCH(makeAdminRequest('PATCH', 'http://localhost:3000/api/birds', {
        id, name: '   ',
      }));
      expect(res.status).toBe(400);
    });

    it('rejects tubes <= 0', async () => {
      const createRes = await POST(makeAdminRequest('POST', 'http://localhost:3000/api/birds', {
        name: 'Test', tubes: 4, totalCost: 80,
      }));
      const { id } = await createRes.json();

      const res = await PATCH(makeAdminRequest('PATCH', 'http://localhost:3000/api/birds', {
        id, tubes: 0,
      }));
      expect(res.status).toBe(400);
    });

    it('rejects non-admin', async () => {
      const res = await PATCH(makeRequest('PATCH', 'http://localhost:3000/api/birds', {
        id: 'test', name: 'Hacked',
      }));
      expect(res.status).toBe(401);
    });
  });
});
