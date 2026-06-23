import { describe, it, expect, beforeEach } from 'vitest';
import { GET } from '@/app/api/players/unpaid/route';
import {
  resetMockStore,
  seedPointer,
  seedSession,
  seedPlayer,
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

  it('ignores owed amounts on UNsettled sessions', async () => {
    seedSession('session-2026-06-15', { datetime: '2026-06-15T19:00:00-04:00' }); // no settled snapshot
    seedPlayer('session-2026-06-15', 'Lin', { owedAmount: 99, paid: false });

    const res = await get('Lin');
    const data = await res.json();
    expect(data.totalOwed).toBe(0);
  });

  it('returns an empty payload when no name is given', async () => {
    const res = await get();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.totalOwed).toBe(0);
    expect(data.mostRecent).toBeNull();
  });
});
