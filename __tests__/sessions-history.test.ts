import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as cosmos from '@/lib/cosmos';
import { GET } from '@/app/api/sessions/history/route';
import {
  resetMockStore, setupAdminPin, seedPointer, seedSession, seedPlayer,
  seedAdminMember, makeAdminRequest, makeRequest,
} from './helpers';

setupAdminPin();

const ACTIVE = 'session-2026-06-08';
const PAST = 'session-2026-06-01';
const URL = 'http://localhost:3000/api/sessions/history';
const RECIPIENT = { name: 'Grant', email: 'grant@example.com', memo: 'BPM {date} - {name}' };

function settled() {
  return {
    at: '2026-06-01T22:00:00-04:00', costPerPerson: 11, totalCost: 44,
    courtTotal: 44, birdTotal: 0, playerCount: 4,
    playerNames: ['Lin', 'Kento', 'Sindhu', 'Akane'],
  };
}

describe('GET /api/sessions/history', () => {
  beforeEach(() => {
    resetMockStore();
    seedAdminMember({ eTransferRecipient: RECIPIENT });
    seedPointer(ACTIVE);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects a non-admin with 401', async () => {
    seedSession(PAST, { settled: settled(), datetime: '2026-06-01T19:00:00-04:00' });
    const res = await GET(makeRequest('GET', URL));
    expect(res.status).toBe(401);
  });

  it('settled row: costPerPerson equals its receipt.costPerPerson (anti-divergence)', async () => {
    seedSession(PAST, { settled: settled(), datetime: '2026-06-01T19:00:00-04:00', courts: 2 });
    seedPlayer(PAST, 'Lin', { paid: true });
    seedPlayer(PAST, 'Kento', { paid: false });

    const res = await GET(makeAdminRequest('GET', URL));
    expect(res.status).toBe(200);
    const data = await res.json();
    const row = data.sessions.find((s: { sessionId: string }) => s.sessionId === PAST);

    expect(row.costPerPerson).toBe(11);
    expect(row.receipt).not.toBeNull();
    expect(row.receipt.costPerPerson).toBe(11);
    expect(row.receipt.playerNames).toEqual(['Lin', 'Kento', 'Sindhu', 'Akane']);
    expect(row.paidPercent).toBe(50); // 1 of 2 active roster paid
    expect(row.attendanceCount).toBe(2);
  });

  it('no recipient: row still shows cost, receipt null with a reason', async () => {
    seedAdminMember({ eTransferRecipient: undefined }); // clear global recipient
    seedSession(PAST, { settled: settled(), datetime: '2026-06-01T19:00:00-04:00' });

    const res = await GET(makeAdminRequest('GET', URL));
    const data = await res.json();
    const row = data.sessions.find((s: { sessionId: string }) => s.sessionId === PAST);

    expect(row.costPerPerson).toBe(11);
    expect(row.receipt).toBeNull();
    expect(row.receiptError).toMatch(/e-transfer recipient/i);
  });

  it('returns 503 when the sessions read throws (not a lying empty 200)', async () => {
    seedSession(PAST, { settled: settled(), datetime: '2026-06-01T19:00:00-04:00' });
    // Break ONLY the sessions container so auth (members) still succeeds.
    const realGetContainer = cosmos.getContainer;
    vi.spyOn(cosmos, 'getContainer').mockImplementation((name: string) => {
      if (name === 'sessions') throw new Error('cosmos down');
      return realGetContainer(name);
    });
    const res = await GET(makeAdminRequest('GET', URL));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBeTruthy();
  });

  it('excludes the currently-active session (this is a PAST-sessions list)', async () => {
    // Active session exists as a real unsettled doc; it must NOT appear here.
    seedSession(ACTIVE, { datetime: '2026-06-08T19:00:00-04:00', costPerCourt: 20, courts: 2 });
    seedSession(PAST, { settled: settled(), datetime: '2026-06-01T19:00:00-04:00' });
    const res = await GET(makeAdminRequest('GET', URL));
    expect(res.status).toBe(200);
    const data = await res.json();
    const ids = data.sessions.map((s: { sessionId: string }) => s.sessionId);
    expect(ids).toContain(PAST);
    expect(ids).not.toContain(ACTIVE);
  });
});
