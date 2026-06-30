import { describe, it, expect, beforeEach } from 'vitest';
import { GET } from '@/app/api/players/unpaid/route';
import {
  resetMockStore,
  seedPointer,
  seedSession,
  seedPlayer,
  seedMember,
  seedAlias,
  makeRequest,
} from './helpers';

const ACTIVE = 'session-2026-06-08';
const OLDER = 'session-2026-06-01';
const URL = 'http://localhost:3000/api/players/unpaid';

function settled() {
  return {
    at: new Date().toISOString(),
    costPerPerson: 10,
    totalCost: 40,
    courtTotal: 40,
    birdTotal: 0,
    playerCount: 4,
    playerNames: [],
  };
}

beforeEach(() => {
  resetMockStore();
  seedPointer(ACTIVE);
  // Two settled sessions with distinct datetimes (newer = ACTIVE).
  seedSession(OLDER, { settled: settled(), datetime: '2026-06-01T19:00:00-04:00' });
  seedSession(ACTIVE, { settled: settled(), datetime: '2026-06-08T19:00:00-04:00' });
});

function get(name?: string) {
  const url = name ? `${URL}?name=${encodeURIComponent(name)}` : URL;
  return GET(makeRequest('GET', url));
}

describe('GET /api/players/unpaid', () => {
  it('sums unpaid settled sessions and reports the most recent', async () => {
    seedPlayer(OLDER, 'Lin', { owedAmount: 10, paid: false });
    seedPlayer(ACTIVE, 'Lin', { owedAmount: 12.5, paid: false });

    const res = await get('Lin');
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.totalOwed).toBe(22.5);
    expect(data.sessionCount).toBe(2);
    expect(data.mostRecent.sessionId).toBe(ACTIVE);
    expect(data.mostRecent.owedAmount).toBe(12.5);
  });

  it('excludes paid and written-off sessions', async () => {
    seedPlayer(OLDER, 'Lin', { owedAmount: 10, paid: true });
    seedPlayer(ACTIVE, 'Lin', { owedAmount: 12, writtenOff: true });

    const res = await get('Lin');
    const data = await res.json();
    expect(data.totalOwed).toBe(0);
    expect(data.sessionCount).toBe(0);
    expect(data.mostRecent).toBeNull();
  });

  it('matches the name case-insensitively', async () => {
    seedPlayer(ACTIVE, 'Lin', { owedAmount: 8, paid: false });
    const res = await get('lin');
    const data = await res.json();
    expect(data.totalOwed).toBe(8);
  });

  it('computes the per-person share for an unsettled PAST priced session', async () => {
    // $20/court × 2 courts = $40, split across the 4 active attendees = $10 each.
    // Seeding the full roster matters: seeding only the requester would give a
    // denominator of 1 → $40 (the trap).
    const PAST = 'session-2026-05-20';
    seedSession(PAST, { costPerCourt: 20, courts: 2, datetime: '2026-05-20T19:00:00-04:00' });
    seedPlayer(PAST, 'Lin', { paid: false });
    seedPlayer(PAST, 'Viktor', { paid: true }); // paid still counts toward the denominator
    seedPlayer(PAST, 'Akane', { paid: false });
    seedPlayer(PAST, 'Kento', { paid: false });

    const res = await get('Lin');
    const data = await res.json();
    expect(data.totalOwed).toBe(10);
    expect(data.mostRecent.sessionId).toBe(PAST);
  });

  it('contributes 0 for an unsettled past session with no recorded cost', async () => {
    const PAST = 'session-2026-05-20';
    seedSession(PAST, { costPerCourt: 0, courts: 0, datetime: '2026-05-20T19:00:00-04:00' });
    seedPlayer(PAST, 'Lin', { paid: false });

    const res = await get('Lin');
    const data = await res.json();
    expect(data.totalOwed).toBe(0);
  });

  it('never counts the active session via the live compute, even if its datetime is past', async () => {
    resetMockStore();
    const ACTIVE_UNSETTLED = 'session-2026-06-20';
    seedPointer(ACTIVE_UNSETTLED);
    seedSession(ACTIVE_UNSETTLED, {
      costPerCourt: 20,
      courts: 2,
      datetime: '2026-06-20T19:00:00-04:00',
    });
    seedPlayer(ACTIVE_UNSETTLED, 'Lin', { paid: false });
    seedPlayer(ACTIVE_UNSETTLED, 'Viktor', { paid: false });

    const res = await get('Lin');
    const data = await res.json();
    expect(data.totalOwed).toBe(0);
  });

  it('uses the frozen owedAmount for a settled session, never live cost inputs', async () => {
    // Absurd live court cost but a small frozen amount — proves the settled
    // branch reads owedAmount and does not double-count via the live path.
    const S = 'session-2026-05-10';
    seedSession(S, {
      settled: settled(),
      datetime: '2026-05-10T19:00:00-04:00',
      costPerCourt: 999,
      courts: 9,
    });
    seedPlayer(S, 'Lin', { owedAmount: 7, paid: false });

    const res = await get('Lin');
    const data = await res.json();
    expect(data.sessions.find((x: { sessionId: string }) => x.sessionId === S)?.owedAmount).toBe(7);
  });

  it('returns an empty payload when no name is given', async () => {
    const res = await get();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.totalOwed).toBe(0);
    expect(data.mostRecent).toBeNull();
  });

  it('counts a week signed up under an alias-linked name', async () => {
    // Lin (app name) e-transfers as "Lin Dan". An older week was recorded
    // under "Lin Dan"; querying "Lin" must now include it via the alias.
    seedMember('Lin', { id: 'm-lin' });
    seedAlias('Lin', 'Lin Dan');
    seedPlayer(OLDER, 'Lin Dan', { owedAmount: 9, paid: false });
    seedPlayer(ACTIVE, 'Lin', { owedAmount: 11, paid: false });

    const res = await get('Lin');
    const data = await res.json();
    expect(data.totalOwed).toBe(20);
    expect(data.sessionCount).toBe(2);
  });

  it('counts a renamed-member week matched by memberId even when the name differs', async () => {
    // The member is now "Carolina" but an old player row kept "Caro" — linked
    // by memberId, so it still counts without an alias.
    seedMember('Carolina', { id: 'm-caro' });
    seedPlayer(OLDER, 'Caro', { memberId: 'm-caro', owedAmount: 6, paid: false });

    const res = await get('Carolina');
    const data = await res.json();
    expect(data.totalOwed).toBe(6);
    expect(data.sessions[0].sessionId).toBe(OLDER);
  });

  it('excludes a settled session with a malformed datetime without throwing', async () => {
    const BAD = 'session-bad';
    seedSession(BAD, { settled: settled(), datetime: 'not-a-real-date' });
    seedPlayer(BAD, 'Lin', { owedAmount: 50, paid: false });

    const res = await get('Lin');
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.sessions.find((x: { sessionId: string }) => x.sessionId === BAD)).toBeUndefined();
  });
});
