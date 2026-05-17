import { describe, it, expect, beforeEach } from 'vitest';
import {
  resetMockStore,
  setupAdminPin,
  seedTestAdminMember,
  makeAdminRequest,
  makeGetRequest,
  seedSession,
  seedPlayer,
} from './helpers';
import { GET } from '@/app/api/admin/ledger/route';

setupAdminPin();

const BASE = 'http://localhost:3000/api/admin/ledger';

function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

/** Seed a session with a frozen settle snapshot. */
function settledSession(
  id: string,
  daysAgo: number,
  totalCost: number,
  playerCount: number,
) {
  const dt = daysAgoIso(daysAgo);
  seedSession(id, {
    datetime: dt,
    settled: {
      at: dt,
      costPerPerson: playerCount > 0 ? totalCost / playerCount : 0,
      totalCost,
      courtTotal: totalCost,
      birdTotal: 0,
      playerCount,
      playerNames: [],
    },
  });
}

describe('GET /api/admin/ledger', () => {
  beforeEach(async () => {
    resetMockStore();
    await seedTestAdminMember();
  });

  it('returns 401 for a non-admin caller', async () => {
    const res = await GET(makeGetRequest(BASE));
    expect(res.status).toBe(401);
  });

  it('returns a zeroed payload when no settled sessions exist', async () => {
    seedSession('session-2026-05-10', { datetime: daysAgoIso(7) }); // not settled
    const res = await GET(makeAdminRequest('GET', BASE));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.summary).toEqual({
      spent: 0,
      paidAmount: 0,
      coveredAmount: 0,
      collected: 0,
      gap: 0,
      sessionCount: 0,
      coveredCount: 0,
    });
    expect(body.bySession).toEqual([]);
    expect(body.byPlayer).toEqual([]);
  });

  it('computes the collected / spent / gap triple correctly', async () => {
    settledSession('session-a', 7, 30, 3);
    seedPlayer('session-a', 'Anna', { owedAmount: 10, paid: true });
    seedPlayer('session-a', 'Bo', { owedAmount: 10, writtenOff: true });
    seedPlayer('session-a', 'Cara', { owedAmount: 10 });

    const res = await GET(makeAdminRequest('GET', BASE));
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.summary).toEqual({
      spent: 30,
      paidAmount: 10,
      coveredAmount: 10,
      collected: 20,
      gap: 10,
      sessionCount: 1,
      coveredCount: 1,
    });

    expect(body.bySession).toHaveLength(1);
    expect(body.bySession[0]).toMatchObject({
      sessionId: 'session-a',
      attendanceCount: 3,
      totalCost: 30,
      paidCount: 1,
      coveredCount: 1,
      unpaidCount: 1,
      unpaidAmount: 10,
    });

    expect(body.byPlayer).toEqual([
      { memberId: null, name: 'Cara', sessionCount: 1, owedAmount: 10 },
    ]);
  });

  it('excludes unsettled sessions from spend and bySession', async () => {
    settledSession('session-settled', 5, 24, 2);
    seedPlayer('session-settled', 'Anna', { owedAmount: 12 });
    seedSession('session-open', { datetime: daysAgoIso(3) }); // no settled
    seedPlayer('session-open', 'Zed', { owedAmount: 99 });

    const res = await GET(makeAdminRequest('GET', BASE));
    const body = await res.json();
    expect(body.summary.spent).toBe(24);
    expect(body.summary.sessionCount).toBe(1);
    expect(body.bySession).toHaveLength(1);
    // Zed's session was never settled → he's not in the ledger at all.
    expect(body.byPlayer.find((p: { name: string }) => p.name === 'Zed')).toBeUndefined();
  });

  it('keeps a soft-deleted player who still owes in byPlayer', async () => {
    settledSession('session-b', 6, 15, 1);
    seedPlayer('session-b', 'Bruce', {
      owedAmount: 15,
      removed: true,
      removedAt: daysAgoIso(2),
    });

    const res = await GET(makeAdminRequest('GET', BASE));
    const body = await res.json();
    expect(body.byPlayer).toEqual([
      { memberId: null, name: 'Bruce', sessionCount: 1, owedAmount: 15 },
    ]);
    expect(body.summary.gap).toBe(15);
  });

  it('merges a memberId record with its same-name legacy twin', async () => {
    settledSession('session-x', 9, 20, 2);
    settledSession('session-y', 2, 20, 2);
    // Same person: one row migrated (has memberId), one legacy (no memberId).
    seedPlayer('session-x', 'Lin', { owedAmount: 10, memberId: 'mem-lin' });
    seedPlayer('session-y', 'lin', { owedAmount: 10 }); // legacy, lower-case

    const res = await GET(makeAdminRequest('GET', BASE));
    const body = await res.json();
    expect(body.byPlayer).toHaveLength(1);
    expect(body.byPlayer[0]).toMatchObject({
      memberId: 'mem-lin',
      sessionCount: 2,
      owedAmount: 20,
    });
  });

  it('filters by the 30d range and widens with all', async () => {
    settledSession('session-recent', 10, 18, 1);
    seedPlayer('session-recent', 'Recent', { owedAmount: 18 });
    settledSession('session-old', 60, 40, 1);
    seedPlayer('session-old', 'Old', { owedAmount: 40 });

    const res30 = await GET(makeAdminRequest('GET', `${BASE}?range=30d`));
    const body30 = await res30.json();
    expect(body30.summary.sessionCount).toBe(1);
    expect(body30.summary.spent).toBe(18);

    const resAll = await GET(makeAdminRequest('GET', `${BASE}?range=all`));
    const bodyAll = await resAll.json();
    expect(bodyAll.summary.sessionCount).toBe(2);
    expect(bodyAll.summary.spent).toBe(58);
  });

  it('defaults to the 12-week window when range is absent or invalid', async () => {
    settledSession('session-in', 50, 22, 1); // 50d ago — inside 12w (84d)
    seedPlayer('session-in', 'InWindow', { owedAmount: 22 });
    settledSession('session-out', 120, 33, 1); // 120d ago — outside 12w
    seedPlayer('session-out', 'OutWindow', { owedAmount: 33 });

    const resDefault = await GET(makeAdminRequest('GET', BASE));
    expect((await resDefault.json()).summary.sessionCount).toBe(1);

    const resGarbage = await GET(makeAdminRequest('GET', `${BASE}?range=banana`));
    expect((await resGarbage.json()).summary.sessionCount).toBe(1);
  });

  it('counts a paid+writtenOff record once (as paid, not double)', async () => {
    settledSession('session-dup', 4, 10, 1);
    seedPlayer('session-dup', 'Both', {
      owedAmount: 10,
      paid: true,
      writtenOff: true,
    });

    const res = await GET(makeAdminRequest('GET', BASE));
    const body = await res.json();
    expect(body.summary.paidAmount).toBe(10);
    expect(body.summary.coveredAmount).toBe(0);
    expect(body.summary.coveredCount).toBe(0);
    expect(body.summary.collected).toBe(10);
  });

  it('excludes an owed-zero player from byPlayer but keeps session attendance', async () => {
    settledSession('session-z', 8, 0, 4);
    seedPlayer('session-z', 'Freebie', { owedAmount: 0 });

    const res = await GET(makeAdminRequest('GET', BASE));
    const body = await res.json();
    expect(body.byPlayer).toEqual([]);
    expect(body.bySession[0].attendanceCount).toBe(4);
  });
});
