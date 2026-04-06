import { describe, it, expect, beforeEach } from 'vitest';
import {
  resetMockStore,
  setupAdminPin,
  makeAdminRequest,
  makeRequest,
  makeGetRequest,
} from './helpers';
import { GET, POST, DELETE } from '@/app/api/birds/route';

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
});
