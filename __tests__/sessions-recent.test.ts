import { describe, it, expect, beforeEach } from 'vitest';
import {
  resetMockStore,
  setupAdminPin,
  seedSession,
  seedPlayer,
  seedTestAdminMember,
  makeAdminRequest,
  makeRequest,
} from './helpers';
import { GET } from '@/app/api/sessions/recent/route';

setupAdminPin();

describe('GET /api/sessions/recent', () => {
  beforeEach(async () => {
    resetMockStore();
    await seedTestAdminMember();
  });

  it('non-admin gets 401', async () => {
    const req = makeRequest('GET', 'http://localhost:3000/api/sessions/recent');
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it('returns the last 6 sessions by default, descending by id', async () => {
    for (const date of ['2026-04-01', '2026-04-08', '2026-04-15', '2026-04-22', '2026-04-29', '2026-05-06', '2026-05-13']) {
      seedSession(`session-${date}`, { datetime: `${date}T20:00:00-04:00`, courts: 2, costPerCourt: 32 });
    }
    const req = makeAdminRequest('GET', 'http://localhost:3000/api/sessions/recent');
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.length).toBe(6);
    expect(body[0].sessionId).toBe('session-2026-05-13');
    expect(body[5].sessionId).toBe('session-2026-04-08');
  });

  it('respects ?limit= query param', async () => {
    for (const date of ['2026-04-01', '2026-04-08', '2026-04-15']) {
      seedSession(`session-${date}`, { datetime: `${date}T20:00:00-04:00`, courts: 2, costPerCourt: 32 });
    }
    const req = makeAdminRequest('GET', 'http://localhost:3000/api/sessions/recent?limit=2');
    const res = await GET(req);
    const body = await res.json();
    expect(body.length).toBe(2);
  });

  it('caps limit at 24', async () => {
    const req = makeAdminRequest('GET', 'http://localhost:3000/api/sessions/recent?limit=100');
    const res = await GET(req);
    expect(res.status).toBe(200);
  });

  it('summary includes attendanceCount, totalCost, paidPercent, anomalyCodes', async () => {
    seedSession('session-2026-05-13', {
      datetime: '2026-05-13T20:00:00-04:00',
      courts: 2,
      costPerCourt: 32,
      anomaliesAtAdvance: ['cost_changed'],
    });
    seedPlayer('session-2026-05-13', 'Daisy', { paid: true, removed: false, waitlisted: false });
    seedPlayer('session-2026-05-13', 'Mei', { paid: false, removed: false, waitlisted: false });
    seedPlayer('session-2026-05-13', 'Removed', { paid: false, removed: true });
    seedPlayer('session-2026-05-13', 'Waitlist', { paid: false, removed: false, waitlisted: true });

    const req = makeAdminRequest('GET', 'http://localhost:3000/api/sessions/recent');
    const res = await GET(req);
    const body = await res.json();
    const session = body[0];

    expect(session.attendanceCount).toBe(2);
    expect(session.totalCost).toBe(64);
    expect(session.paidPercent).toBe(50);
    expect(session.anomalyCodes).toEqual(['cost_changed']);
  });

  it('attributes players to the correct session — no cross-contamination', async () => {
    // The N+1 → single-IN()-query refactor must group player rows by sessionId
    // correctly. Two sessions with DISJOINT player sets and different mixes
    // catch any leakage (a bad group/post-filter would mis-count).
    seedSession('session-2026-05-13', { datetime: '2026-05-13T20:00:00-04:00', courts: 2, costPerCourt: 30 });
    seedPlayer('session-2026-05-13', 'A1', { paid: true });
    seedPlayer('session-2026-05-13', 'A2', { paid: true });
    seedPlayer('session-2026-05-13', 'A3', { paid: false });

    seedSession('session-2026-05-06', { datetime: '2026-05-06T20:00:00-04:00', courts: 1, costPerCourt: 40 });
    seedPlayer('session-2026-05-06', 'B1', { paid: true });
    seedPlayer('session-2026-05-06', 'B2', { paid: false, removed: true });   // excluded
    seedPlayer('session-2026-05-06', 'B3', { paid: false, waitlisted: true }); // excluded

    const res = await GET(makeAdminRequest('GET', 'http://localhost:3000/api/sessions/recent'));
    const body = await res.json();
    const byId: Record<string, { attendanceCount: number; paidPercent: number }> = Object.fromEntries(
      body.map((s: { sessionId: string }) => [s.sessionId, s]),
    );

    expect(byId['session-2026-05-13'].attendanceCount).toBe(3);
    expect(byId['session-2026-05-13'].paidPercent).toBe(67); // 2/3
    expect(byId['session-2026-05-06'].attendanceCount).toBe(1); // removed + waitlisted excluded
    expect(byId['session-2026-05-06'].paidPercent).toBe(100); // 1/1
  });

  it('handles a session with zero active players', async () => {
    seedSession('session-2026-05-13', { datetime: '2026-05-13T20:00:00-04:00', courts: 2, costPerCourt: 32 });
    const req = makeAdminRequest('GET', 'http://localhost:3000/api/sessions/recent');
    const res = await GET(req);
    const body = await res.json();
    expect(body[0].attendanceCount).toBe(0);
    expect(body[0].paidPercent).toBe(0);
  });
});
