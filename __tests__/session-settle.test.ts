import { describe, it, expect, beforeEach } from 'vitest';
import { POST, DELETE } from '@/app/api/session/settle/route';
import { POST as AdvancePost } from '@/app/api/session/advance/route';
import { PATCH as BirdUsagePatch } from '@/app/api/session/bird-usage/route';
import {
  resetMockStore,
  setupAdminPin,
  makeRequest,
  makeAdminRequest,
  seedPointer,
  seedSession,
  seedPlayer,
  getStore,
} from './helpers';

const SID = 'session-2026-05-04';

function seedPurchase(id: string, costPerTube: number): void {
  const store = getStore();
  if (!store['birds']) store['birds'] = [];
  store['birds'].push({
    id,
    name: id,
    tubes: 10,
    totalCost: 10 * costPerTube,
    costPerTube,
    date: '2026-04-24',
    createdAt: new Date().toISOString(),
  });
}

describe('POST /api/session/settle', () => {
  beforeEach(() => {
    setupAdminPin();
    resetMockStore();
    seedPointer(SID);
    seedSession(SID, { costPerCourt: 30, courts: 2 });
  });

  it('rejects non-admin', async () => {
    seedPlayer(SID, 'Alice');
    const res = await POST(makeRequest('POST', 'http://localhost:3000/api/session/settle'));
    expect(res.status).toBe(401);
  });

  it('refuses when no active players', async () => {
    const res = await POST(makeAdminRequest('POST', 'http://localhost:3000/api/session/settle'));
    expect(res.status).toBe(400);
  });

  it('refuses when total cost is zero', async () => {
    // costPerCourt 30 but courts 0 → courtTotal 0, no birds → totalCost 0
    const store = getStore();
    const session = (store['sessions'] as Array<{ id: string; courts?: number }>).find((s) => s.id === SID)!;
    session.courts = 0;
    seedPlayer(SID, 'Alice');
    const res = await POST(makeAdminRequest('POST', 'http://localhost:3000/api/session/settle'));
    expect(res.status).toBe(400);
  });

  it('freezes the receipt: writes session.settled and stamps each active player', async () => {
    seedPlayer(SID, 'Alice');
    seedPlayer(SID, 'Bob');
    seedPlayer(SID, 'Carol');
    seedPlayer(SID, 'Dan');
    // 4 players × $15 = $60 total = 30 × 2 courts. costPerPerson = $15.
    const res = await POST(makeAdminRequest('POST', 'http://localhost:3000/api/session/settle'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.settled.costPerPerson).toBe(15);
    expect(json.settled.totalCost).toBe(60);
    expect(json.settled.playerCount).toBe(4);
    expect(json.settled.playerNames).toEqual(['Alice', 'Bob', 'Carol', 'Dan']);

    const store = getStore();
    const session = (store['sessions'] as Array<{ id: string; settled?: unknown; signupOpen?: boolean }>).find((s) => s.id === SID)!;
    expect(session.settled).toBeDefined();
    expect(session.signupOpen).toBe(false);

    const players = (store['players'] as Array<{ name: string; owedAmount?: number; settledAt?: string }>);
    expect(players.every((p) => p.owedAmount === 15)).toBe(true);
    expect(players.every((p) => typeof p.settledAt === 'string')).toBe(true);
  });

  it('excludes waitlisted and removed players from the denominator', async () => {
    seedPlayer(SID, 'Alice');
    seedPlayer(SID, 'Bob');
    seedPlayer(SID, 'Wait', { waitlisted: true });
    seedPlayer(SID, 'Gone', { removed: true });
    // 2 active × $30 = $60. costPerPerson = $30.
    const res = await POST(makeAdminRequest('POST', 'http://localhost:3000/api/session/settle'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.settled.costPerPerson).toBe(30);
    expect(json.settled.playerCount).toBe(2);
    expect(json.settled.playerNames).toEqual(['Alice', 'Bob']);

    const store = getStore();
    const players = store['players'] as Array<{ name: string; owedAmount?: number }>;
    const wait = players.find((p) => p.name === 'Wait')!;
    const gone = players.find((p) => p.name === 'Gone')!;
    expect(wait.owedAmount).toBeUndefined();
    expect(gone.owedAmount).toBeUndefined();
  });

  it('refuses to re-settle without unsettle first (idempotency guard)', async () => {
    seedPlayer(SID, 'Alice');
    seedPlayer(SID, 'Bob');
    await POST(makeAdminRequest('POST', 'http://localhost:3000/api/session/settle'));
    const second = await POST(makeAdminRequest('POST', 'http://localhost:3000/api/session/settle'));
    expect(second.status).toBe(409);
  });

  it('settled.totalCost survives retro bird-usage edits (the workflow this protects)', async () => {
    seedPlayer(SID, 'Alice');
    seedPlayer(SID, 'Bob');
    seedPurchase('pur-1', 10);
    const settleRes = await POST(makeAdminRequest('POST', 'http://localhost:3000/api/session/settle'));
    const settleJson = await settleRes.json();
    const frozenTotal = settleJson.settled.totalCost;
    const frozenPerPerson = settleJson.settled.costPerPerson;

    // Admin retro-assigns 2 tubes ($20) to this session AFTER settle.
    const patchRes = await BirdUsagePatch(
      makeAdminRequest('PATCH', 'http://localhost:3000/api/session/bird-usage', {
        sessionId: SID,
        purchaseId: 'pur-1',
        tubes: 2,
      }),
    );
    expect(patchRes.status).toBe(200);

    // The settled snapshot is unchanged — players who paid frozenPerPerson
    // are still on the books for that exact amount.
    const store = getStore();
    const session = (store['sessions'] as Array<{ id: string; settled?: { totalCost: number; costPerPerson: number }; birdUsages?: unknown[] }>).find((s) => s.id === SID)!;
    expect(session.settled?.totalCost).toBe(frozenTotal);
    expect(session.settled?.costPerPerson).toBe(frozenPerPerson);
    // But the live birdUsages array DID update — bookkeeping for the owner-ledger view.
    expect(session.birdUsages).toHaveLength(1);

    const players = store['players'] as Array<{ name: string; owedAmount?: number }>;
    expect(players.find((p) => p.name === 'Alice')?.owedAmount).toBe(frozenPerPerson);
  });
});

describe('DELETE /api/session/settle', () => {
  beforeEach(() => {
    setupAdminPin();
    resetMockStore();
    seedPointer(SID);
    seedSession(SID, { costPerCourt: 30, courts: 2 });
  });

  it('rejects non-admin', async () => {
    const res = await DELETE(makeRequest('DELETE', 'http://localhost:3000/api/session/settle'));
    expect(res.status).toBe(401);
  });

  it('404s when session not settled', async () => {
    seedPlayer(SID, 'Alice');
    const res = await DELETE(makeAdminRequest('DELETE', 'http://localhost:3000/api/session/settle'));
    expect(res.status).toBe(404);
  });

  it('clears settled snapshot and per-player owed/settledAt, preserves paid', async () => {
    seedPlayer(SID, 'Alice', { paid: true });
    seedPlayer(SID, 'Bob', { paid: false });
    await POST(makeAdminRequest('POST', 'http://localhost:3000/api/session/settle'));

    // Sanity: stamps applied
    const storeBefore = getStore();
    const aliceBefore = (storeBefore['players'] as Array<{ name: string; owedAmount?: number }>).find((p) => p.name === 'Alice')!;
    expect(aliceBefore.owedAmount).toBeDefined();

    const unsettleRes = await DELETE(makeAdminRequest('DELETE', 'http://localhost:3000/api/session/settle'));
    expect(unsettleRes.status).toBe(200);

    const store = getStore();
    const session = (store['sessions'] as Array<{ id: string; settled?: unknown }>).find((s) => s.id === SID)!;
    expect(session.settled).toBeUndefined();

    const players = store['players'] as Array<{ name: string; owedAmount?: number; settledAt?: string; paid?: boolean }>;
    const alice = players.find((p) => p.name === 'Alice')!;
    const bob = players.find((p) => p.name === 'Bob')!;
    expect(alice.owedAmount).toBeUndefined();
    expect(alice.settledAt).toBeUndefined();
    expect(alice.paid).toBe(true); // PRESERVED — paid is independently meaningful
    expect(bob.paid).toBe(false);
  });

  it('allows re-settle after unsettle', async () => {
    seedPlayer(SID, 'Alice');
    seedPlayer(SID, 'Bob');
    await POST(makeAdminRequest('POST', 'http://localhost:3000/api/session/settle'));
    await DELETE(makeAdminRequest('DELETE', 'http://localhost:3000/api/session/settle'));
    const re = await POST(makeAdminRequest('POST', 'http://localhost:3000/api/session/settle'));
    expect(re.status).toBe(200);
  });
});

describe('advance derives prevCostPerPerson from settled snapshot', () => {
  beforeEach(() => {
    setupAdminPin();
    resetMockStore();
    seedPointer(SID);
    seedSession(SID, { costPerCourt: 30, courts: 2 });
  });

  it('uses settled.costPerPerson over live recompute when present', async () => {
    seedPlayer(SID, 'Alice');
    seedPlayer(SID, 'Bob');
    // Settle with 2 players → $30 each.
    await POST(makeAdminRequest('POST', 'http://localhost:3000/api/session/settle'));

    // Now retroactively muck with the cost AFTER settle (simulating mid-week edit).
    // Live recompute would now say $50/person. Settled snapshot says $30.
    const store = getStore();
    const session = (store['sessions'] as Array<{ id: string; costPerCourt?: number }>).find((s) => s.id === SID)!;
    session.costPerCourt = 50;

    // Advance — newSession.prevCostPerPerson should reflect settled ($30), not live ($50).
    const advanceRes = await AdvancePost(
      makeAdminRequest('POST', 'http://localhost:3000/api/session/advance', {
        datetime: '2026-05-11T20:00:00-04:00',
        deadline: '2026-05-11T18:00:00-04:00',
        courts: 2,
        maxPlayers: 12,
      }),
    );
    expect(advanceRes.status).toBe(201);
    const newSession = await advanceRes.json();
    expect(newSession.prevCostPerPerson).toBe(30);
  });

  it('falls back to live compute when previous session was never settled', async () => {
    seedPlayer(SID, 'Alice');
    seedPlayer(SID, 'Bob');
    // No settle.
    const advanceRes = await AdvancePost(
      makeAdminRequest('POST', 'http://localhost:3000/api/session/advance', {
        datetime: '2026-05-11T20:00:00-04:00',
        deadline: '2026-05-11T18:00:00-04:00',
        courts: 2,
        maxPlayers: 12,
      }),
    );
    expect(advanceRes.status).toBe(201);
    const newSession = await advanceRes.json();
    // 2 players, courtTotal $60 → $30/person
    expect(newSession.prevCostPerPerson).toBe(30);
  });
});
