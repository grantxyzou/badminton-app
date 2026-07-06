import { describe, it, expect, beforeEach } from 'vitest';
import {
  resetMockStore,
  setupAdminPin,
  seedPointer,
  seedSession,
  seedTestAdminMember,
  makeAdminRequest,
} from './helpers';
import { getStore } from './helpers';
import { POST as ADVANCE } from '@/app/api/session/advance/route';

setupAdminPin();

describe('POST /api/session/advance — snapshot fields', () => {
  beforeEach(async () => {
    resetMockStore();
    await seedTestAdminMember();
  });

  it('writes prevSnapshot from current session settings', async () => {
    seedPointer('session-2026-04-29');
    seedSession('session-2026-04-29', {
      courts: 3,
      costPerCourt: 35,
      maxPlayers: 14,
      deadline: '2026-04-29T18:00:00-04:00',
      datetime: '2026-04-29T20:00:00-04:00',
    });

    const req = makeAdminRequest('POST', 'http://localhost:3000/api/session/advance', {
      datetime: '2026-05-06T20:00:00-04:00',
      deadline: '2026-05-06T18:00:00-04:00',
      courts: 3,
      maxPlayers: 14,
    });
    const res = await ADVANCE(req);
    expect(res.status).toBe(201);

    const body = await res.json();
    expect(body.prevSnapshot).toBeDefined();
    expect(body.prevSnapshot.courtCount).toBe(3);
    expect(body.prevSnapshot.costPerCourt).toBe(35);
    expect(body.prevSnapshot.maxPlayers).toBe(14);
    expect(body.prevSnapshot.deadlineOffsetHours).toBe(-2); // deadline is 2h BEFORE start → -2
    expect(Array.isArray(body.anomaliesAtAdvance)).toBe(true);
  });

  it('carries title + venue from the POST body onto the new session', async () => {
    seedPointer('session-2026-04-29');
    seedSession('session-2026-04-29', { courts: 2, costPerCourt: 30, maxPlayers: 12 });

    const req = makeAdminRequest('POST', 'http://localhost:3000/api/session/advance', {
      datetime: '2026-05-06T20:00:00-04:00',
      deadline: '2026-05-06T18:00:00-04:00',
      courts: 2,
      maxPlayers: 12,
      title: 'Thursday Smash',
      locationName: 'Acme Courts',
      locationAddress: '123 Shuttle Ave',
    });
    const res = await ADVANCE(req);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.title).toBe('Thursday Smash');
    expect(body.locationName).toBe('Acme Courts');
    expect(body.locationAddress).toBe('123 Shuttle Ave');
  });

  it('loads chosen bird tubes into the new session, costed from inventory', async () => {
    const store = getStore();
    store['birds'] = [
      { id: 'pur-a', name: 'Yonex AS-30', tubes: 20, totalCost: 60, costPerTube: 3, date: '2026-04-20', createdAt: new Date().toISOString() },
    ];
    seedPointer('session-2026-04-29');
    seedSession('session-2026-04-29', { courts: 2, costPerCourt: 30, maxPlayers: 12 });

    const req = makeAdminRequest('POST', 'http://localhost:3000/api/session/advance', {
      datetime: '2026-05-06T20:00:00-04:00',
      deadline: '2026-05-06T18:00:00-04:00',
      courts: 2,
      maxPlayers: 12,
      birdUsages: [{ purchaseId: 'pur-a', tubes: 2 }],
    });
    const res = await ADVANCE(req);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.birdUsages).toHaveLength(1);
    expect(body.birdUsages[0]).toMatchObject({
      purchaseId: 'pur-a',
      purchaseName: 'Yonex AS-30',
      tubes: 2,
      costPerTube: 3,
      totalBirdCost: 6,
    });
  });

  // Advance now enforces the SAME bird contract as PUT /api/session (PR 2.2):
  // tubes:0 omits the entry, but a malformed entry 400s and an unknown
  // purchase 404s (previously all three were silently dropped).
  function advanceWithBirds(birdUsages: unknown) {
    const store = getStore();
    store['birds'] = [
      { id: 'pur-a', name: 'Yonex AS-30', tubes: 20, totalCost: 60, costPerTube: 3, date: '2026-04-20', createdAt: new Date().toISOString() },
    ];
    seedPointer('session-2026-04-29');
    seedSession('session-2026-04-29', { courts: 2, costPerCourt: 30, maxPlayers: 12 });
    return ADVANCE(makeAdminRequest('POST', 'http://localhost:3000/api/session/advance', {
      datetime: '2026-05-06T20:00:00-04:00',
      deadline: '2026-05-06T18:00:00-04:00',
      courts: 2,
      maxPlayers: 12,
      birdUsages,
    }));
  }

  it('omits a tubes:0 bird entry (0 = remove) and advances with no birdUsages', async () => {
    const res = await advanceWithBirds([{ purchaseId: 'pur-a', tubes: 0 }]);
    expect(res.status).toBe(201);
    expect((await res.json()).birdUsages).toBeUndefined();
  });

  it('rejects a malformed bird entry with 400 (was silently skipped)', async () => {
    const res = await advanceWithBirds([{ purchaseId: 'pur-a', tubes: 0.1 }]); // off the 0.25 grid
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/0\.25/);
  });

  it('rejects an unknown bird purchase with 404 (was silently skipped)', async () => {
    const res = await advanceWithBirds([{ purchaseId: 'nope', tubes: 2 }]);
    expect(res.status).toBe(404);
  });

  it('flags cost_changed in anomaliesAtAdvance when costPerCourt differs', async () => {
    seedPointer('session-2026-04-29');
    seedSession('session-2026-04-29', { courts: 2, costPerCourt: 32, maxPlayers: 12 });

    const req = makeAdminRequest('POST', 'http://localhost:3000/api/session/advance', {
      datetime: '2026-05-06T20:00:00-04:00',
      deadline: '2026-05-06T18:00:00-04:00',
      courts: 2,
      costPerCourt: 40, // changed
      maxPlayers: 12,
    });
    const res = await ADVANCE(req);
    const body = await res.json();
    expect(body.anomaliesAtAdvance).toContain('cost_changed');
  });

  it('flags max_players_changed when maxPlayers differs', async () => {
    seedPointer('session-2026-04-29');
    seedSession('session-2026-04-29', { courts: 2, costPerCourt: 32, maxPlayers: 12 });

    const req = makeAdminRequest('POST', 'http://localhost:3000/api/session/advance', {
      datetime: '2026-05-06T20:00:00-04:00',
      deadline: '2026-05-06T18:00:00-04:00',
      courts: 2,
      costPerCourt: 32,
      maxPlayers: 16, // changed
    });
    const res = await ADVANCE(req);
    const body = await res.json();
    expect(body.anomaliesAtAdvance).toContain('max_players_changed');
  });

  it('flags long_break in anomaliesAtAdvance when gap > 21 days', async () => {
    seedPointer('session-2026-04-01');
    seedSession('session-2026-04-01', {
      courts: 2,
      costPerCourt: 32,
      maxPlayers: 12,
      datetime: '2026-04-01T20:00:00-04:00',
    });

    const req = makeAdminRequest('POST', 'http://localhost:3000/api/session/advance', {
      datetime: '2026-04-29T20:00:00-04:00', // 28 days later
      deadline: '2026-04-29T18:00:00-04:00',
      courts: 2,
      costPerCourt: 32,
      maxPlayers: 12,
    });
    const res = await ADVANCE(req);
    const body = await res.json();
    expect(body.anomaliesAtAdvance).toContain('long_break');
  });

  it('omits prevSnapshot if there is no current session', async () => {
    // No seedPointer → no current session
    const req = makeAdminRequest('POST', 'http://localhost:3000/api/session/advance', {
      datetime: '2026-05-06T20:00:00-04:00',
      deadline: '2026-05-06T18:00:00-04:00',
      courts: 2,
      maxPlayers: 12,
    });
    const res = await ADVANCE(req);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.prevSnapshot).toBeUndefined();
    // anomaliesAtAdvance may be undefined or []
    expect(body.anomaliesAtAdvance ?? []).toEqual([]);
  });
});
