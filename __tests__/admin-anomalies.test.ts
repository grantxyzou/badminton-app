import { describe, it, expect, beforeEach } from 'vitest';
import {
  resetMockStore,
  setupAdminPin,
  seedPointer,
  seedSession,
  seedTestAdminMember,
  makeAdminRequest,
  makeRequest,
  getStore,
} from './helpers';
import { GET } from '@/app/api/admin/anomalies/route';

setupAdminPin();

describe('GET /api/admin/anomalies', () => {
  beforeEach(async () => {
    resetMockStore();
    await seedTestAdminMember();
  });

  it('non-admin gets 401', async () => {
    const req = makeRequest('GET', 'http://localhost:3000/api/admin/anomalies');
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it('returns empty array when no active session', async () => {
    const req = makeAdminRequest('GET', 'http://localhost:3000/api/admin/anomalies');
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual([]);
  });

  it('returns cost_changed when current session diverges from prevSnapshot', async () => {
    seedPointer('session-2026-05-13');
    seedSession('session-2026-05-13', {
      courts: 2,
      costPerCourt: 40,
      maxPlayers: 12,
      datetime: '2026-05-13T20:00:00-04:00',
      prevSnapshot: { courtCount: 2, costPerCourt: 32, maxPlayers: 12, deadlineOffsetHours: -2, signupOpensOffsetHours: 0 },
    });
    const req = makeAdminRequest('GET', 'http://localhost:3000/api/admin/anomalies');
    const res = await GET(req);
    const body = await res.json();
    expect(body.find((a: { code: string }) => a.code === 'cost_changed')).toBeDefined();
  });

  it('returns skip_date when current session date is in admin skipDates', async () => {
    seedPointer('session-2026-05-20');
    seedSession('session-2026-05-20', {
      courts: 2, costPerCourt: 32, maxPlayers: 12,
      datetime: '2026-05-20T20:00:00-04:00',
    });
    const members = getStore()['members'] as Array<{ id: string; skipDates?: string[] }>;
    const me = members.find((m) => m.id === 'member-test-admin');
    if (me) me.skipDates = ['2026-05-20'];

    const req = makeAdminRequest('GET', 'http://localhost:3000/api/admin/anomalies');
    const res = await GET(req);
    const body = await res.json();
    const skip = body.find((a: { code: string }) => a.code === 'skip_date');
    expect(skip).toBeDefined();
    expect(skip.severity).toBe('blocking');
  });

  it('returns long_break when previous session was >21 days ago', async () => {
    seedSession('session-2026-04-01', { datetime: '2026-04-01T20:00:00-04:00' });
    seedPointer('session-2026-04-29');
    seedSession('session-2026-04-29', {
      courts: 2, costPerCourt: 32, maxPlayers: 12,
      datetime: '2026-04-29T20:00:00-04:00',
    });
    const req = makeAdminRequest('GET', 'http://localhost:3000/api/admin/anomalies');
    const res = await GET(req);
    const body = await res.json();
    expect(body.find((a: { code: string }) => a.code === 'long_break')).toBeDefined();
  });

  it('filters out dismissed codes', async () => {
    seedPointer('session-2026-05-13');
    seedSession('session-2026-05-13', {
      courts: 2, costPerCourt: 40, maxPlayers: 12,
      datetime: '2026-05-13T20:00:00-04:00',
      prevSnapshot: { courtCount: 2, costPerCourt: 32, maxPlayers: 12, deadlineOffsetHours: -2, signupOpensOffsetHours: 0 },
      anomaliesDismissed: ['cost_changed'],
    });
    const req = makeAdminRequest('GET', 'http://localhost:3000/api/admin/anomalies');
    const res = await GET(req);
    const body = await res.json();
    expect(body.find((a: { code: string }) => a.code === 'cost_changed')).toBeUndefined();
  });
});
