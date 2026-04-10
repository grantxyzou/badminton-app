import { describe, it, expect, beforeEach } from 'vitest';
import {
  resetMockStore,
  setupAdminPin,
  makeAdminRequest,
  makeRequest,
  makeGetRequest,
  seedPointer,
  seedSession,
} from './helpers';
import { GET, POST, DELETE, PATCH } from '@/app/api/birds/route';

describe('Birds API', () => {
  beforeEach(() => {
    setupAdminPin();
    resetMockStore();
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
