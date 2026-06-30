import { describe, it, expect, beforeEach } from 'vitest';
import { GET } from '@/app/api/admin/owed-audit/route';
import {
  resetMockStore,
  setupAdminPin,
  seedPointer,
  seedSession,
  seedPlayer,
  seedMember,
  seedAlias,
  seedTestAdminMember,
  makeAdminRequest,
  makeRequest,
} from './helpers';

setupAdminPin();

const ACTIVE = 'session-2026-06-08';
const OLDER = 'session-2026-06-01';
const URL = 'http://localhost:3000/api/admin/owed-audit';

function settled() {
  return { at: '', costPerPerson: 10, totalCost: 40, courtTotal: 40, birdTotal: 0, playerCount: 4, playerNames: [] };
}

function adminGet(query: string) {
  return GET(makeAdminRequest('GET', `${URL}?${query}`));
}

describe('GET /api/admin/owed-audit', () => {
  beforeEach(async () => {
    resetMockStore();
    await seedTestAdminMember();
    seedPointer(ACTIVE);
    seedSession(OLDER, { settled: settled(), datetime: '2026-06-01T19:00:00-04:00' });
    seedSession(ACTIVE, { settled: settled(), datetime: '2026-06-08T19:00:00-04:00' });
  });

  it('rejects a non-admin with 401', async () => {
    const res = await GET(makeRequest('GET', `${URL}?name=Lin`));
    expect(res.status).toBe(401);
  });

  it('requires a name or memberId', async () => {
    const res = await adminGet('');
    expect(res.status).toBe(400);
  });

  it('classifies each session with a reason and totals only the counted ones', async () => {
    seedMember('Lin', { id: 'm-lin' });
    seedPlayer(OLDER, 'Lin', { memberId: 'm-lin', owedAmount: 10, paid: true }); // paid → excluded
    seedPlayer(ACTIVE, 'Lin', { memberId: 'm-lin', owedAmount: 12.5, paid: false }); // counts

    const res = await adminGet('name=Lin');
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.totalOwed).toBe(12.5);
    expect(data.countedCount).toBe(1);
    expect(data.sessionCount).toBe(2);

    const byId = Object.fromEntries(data.sessions.map((s: { sessionId: string }) => [s.sessionId, s]));
    expect(byId[ACTIVE].counted).toBe(true);
    expect(byId[ACTIVE].reason).toBe('counted');
    expect(byId[OLDER].counted).toBe(false);
    expect(byId[OLDER].reason).toBe('paid');
  });

  it('surfaces all linked names so an admin can spot an unlinked variant', async () => {
    seedMember('Lin', { id: 'm-lin' });
    seedAlias('Lin', 'Lin Dan');
    seedPlayer(OLDER, 'Lin Dan', { owedAmount: 9, paid: false });
    seedPlayer(ACTIVE, 'Lin', { owedAmount: 11, paid: false });

    const res = await adminGet('name=Lin');
    const data = await res.json();
    expect(new Set(data.names)).toEqual(new Set(['Lin', 'Lin Dan']));
    expect(data.totalOwed).toBe(20);
  });

  it('flags an unsettled past session with no recorded cost', async () => {
    const PAST = 'session-2026-05-20';
    seedSession(PAST, { costPerCourt: 0, courts: 0, datetime: '2026-05-20T19:00:00-04:00' });
    seedPlayer(PAST, 'Lin', { paid: false });

    const res = await adminGet('name=Lin');
    const data = await res.json();
    const row = data.sessions.find((s: { sessionId: string }) => s.sessionId === PAST);
    expect(row.counted).toBe(false);
    expect(row.reason).toBe('unsettled_no_cost');
  });
});
