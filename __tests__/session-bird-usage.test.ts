import { describe, it, expect, beforeEach } from 'vitest';
import { PATCH } from '@/app/api/session/bird-usage/route';
import {
  resetMockStore,
  setupAdminPin,
  makeRequest,
  makeAdminRequest,
  seedPointer,
  seedSession,
  getStore,
} from './helpers';

function seedPurchase(id: string, name: string, tubes = 10, costPerTube = 12): void {
  const store = getStore();
  if (!store['birds']) store['birds'] = [];
  store['birds'].push({
    id,
    name,
    tubes,
    totalCost: tubes * costPerTube,
    costPerTube,
    date: '2026-04-24',
    createdAt: new Date().toISOString(),
  });
}

describe('PATCH /api/session/bird-usage', () => {
  beforeEach(() => {
    setupAdminPin();
    resetMockStore();
    seedPointer('session-2026-04-24');
    seedSession('session-2026-04-24');
    seedPurchase('pur-yonex-1', 'Yonex AS-50');
  });

  it('rejects non-admin', async () => {
    const res = await PATCH(
      makeRequest('PATCH', 'http://localhost:3000/api/session/bird-usage', {
        sessionId: 'session-2026-04-24',
        purchaseId: 'pur-yonex-1',
        tubes: 2,
      }),
    );
    expect(res.status).toBe(401);
  });

  it('adds a usage entry on first assignment', async () => {
    const res = await PATCH(
      makeAdminRequest('PATCH', 'http://localhost:3000/api/session/bird-usage', {
        sessionId: 'session-2026-04-24',
        purchaseId: 'pur-yonex-1',
        tubes: 2,
      }),
    );
    expect(res.status).toBe(200);
    const updated = await res.json();
    expect(updated.birdUsages).toHaveLength(1);
    expect(updated.birdUsages[0].purchaseId).toBe('pur-yonex-1');
    expect(updated.birdUsages[0].tubes).toBe(2);
    expect(updated.birdUsages[0].totalBirdCost).toBe(24); // 2 * 12
  });

  it('replaces existing entry rather than duplicating', async () => {
    // First assignment
    await PATCH(
      makeAdminRequest('PATCH', 'http://localhost:3000/api/session/bird-usage', {
        sessionId: 'session-2026-04-24',
        purchaseId: 'pur-yonex-1',
        tubes: 2,
      }),
    );
    // Second assignment with different tubes
    const res = await PATCH(
      makeAdminRequest('PATCH', 'http://localhost:3000/api/session/bird-usage', {
        sessionId: 'session-2026-04-24',
        purchaseId: 'pur-yonex-1',
        tubes: 3.5,
      }),
    );
    const updated = await res.json();
    expect(updated.birdUsages).toHaveLength(1);
    expect(updated.birdUsages[0].tubes).toBe(3.5);
  });

  it('removes the entry when tubes === 0', async () => {
    await PATCH(
      makeAdminRequest('PATCH', 'http://localhost:3000/api/session/bird-usage', {
        sessionId: 'session-2026-04-24',
        purchaseId: 'pur-yonex-1',
        tubes: 2,
      }),
    );
    const res = await PATCH(
      makeAdminRequest('PATCH', 'http://localhost:3000/api/session/bird-usage', {
        sessionId: 'session-2026-04-24',
        purchaseId: 'pur-yonex-1',
        tubes: 0,
      }),
    );
    const updated = await res.json();
    expect(updated.birdUsages).toHaveLength(0);
  });

  it('rejects non-multiples of 0.25', async () => {
    const res = await PATCH(
      makeAdminRequest('PATCH', 'http://localhost:3000/api/session/bird-usage', {
        sessionId: 'session-2026-04-24',
        purchaseId: 'pur-yonex-1',
        tubes: 0.3,
      }),
    );
    expect(res.status).toBe(400);
  });

  it('returns 404 for unknown session', async () => {
    const res = await PATCH(
      makeAdminRequest('PATCH', 'http://localhost:3000/api/session/bird-usage', {
        sessionId: 'session-does-not-exist',
        purchaseId: 'pur-yonex-1',
        tubes: 2,
      }),
    );
    expect(res.status).toBe(404);
  });

  it('returns 404 for unknown purchase', async () => {
    const res = await PATCH(
      makeAdminRequest('PATCH', 'http://localhost:3000/api/session/bird-usage', {
        sessionId: 'session-2026-04-24',
        purchaseId: 'pur-does-not-exist',
        tubes: 2,
      }),
    );
    expect(res.status).toBe(404);
  });
});
