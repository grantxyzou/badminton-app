import { describe, it, expect, beforeEach } from 'vitest';
import {
  resetMockStore,
  setupAdminPin,
  seedSession,
  seedPlayer,
  seedMember,
  seedTestAdminMember,
  makeAdminRequest,
  makeRequest,
} from './helpers';
import { GET } from '@/app/api/members/[id]/history/route';

setupAdminPin();

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

describe('GET /api/members/[id]/history', () => {
  beforeEach(async () => {
    resetMockStore();
    await seedTestAdminMember();
  });

  it('non-admin gets 401', async () => {
    const req = makeRequest('GET', 'http://localhost:3000/api/members/m1/history');
    const res = await GET(req, ctx('m1'));
    expect(res.status).toBe(401);
  });

  it('returns 404 when member does not exist', async () => {
    const req = makeAdminRequest('GET', 'http://localhost:3000/api/members/missing/history');
    const res = await GET(req, ctx('missing'));
    expect(res.status).toBe(404);
  });

  it('returns sessions ordered DESC by date with attendance/paid status', async () => {
    seedMember('Daisy', { id: 'm-daisy' });
    seedSession('session-2026-04-29', {
      datetime: '2026-04-29T20:00:00-04:00', courts: 2, costPerCourt: 32,
    });
    seedSession('session-2026-05-06', {
      datetime: '2026-05-06T20:00:00-04:00', courts: 2, costPerCourt: 32,
    });
    seedPlayer('session-2026-04-29', 'Daisy', { memberId: 'm-daisy', paid: true, removed: false, waitlisted: false });
    seedPlayer('session-2026-05-06', 'Daisy', { memberId: 'm-daisy', paid: false, removed: false, waitlisted: false });

    const req = makeAdminRequest('GET', 'http://localhost:3000/api/members/m-daisy/history');
    const res = await GET(req, ctx('m-daisy'));
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.member.id).toBe('m-daisy');
    expect(body.member.name).toBe('Daisy');
    expect(body.sessions).toHaveLength(2);
    expect(body.sessions[0].sessionId).toBe('session-2026-05-06');
    expect(body.sessions[0].paid).toBe(false);
    expect(body.sessions[1].paid).toBe(true);
    expect(body.lifetime.attended).toBe(2);
    expect(body.lifetime.totalPaid).toBe(1);
  });

  it('marks waitlisted/removed sessions as not-attended', async () => {
    seedMember('Mei', { id: 'm-mei' });
    seedSession('session-2026-05-06', { datetime: '2026-05-06T20:00:00-04:00', courts: 2, costPerCourt: 32 });
    seedPlayer('session-2026-05-06', 'Mei', { memberId: 'm-mei', paid: false, removed: true });

    const req = makeAdminRequest('GET', 'http://localhost:3000/api/members/m-mei/history');
    const res = await GET(req, ctx('m-mei'));
    const body = await res.json();

    expect(body.sessions).toHaveLength(1);
    expect(body.sessions[0].attended).toBe(false);
    expect(body.lifetime.attended).toBe(0);
  });

  it('falls back to name lookup for legacy player records without memberId', async () => {
    seedMember('Sam', { id: 'm-sam' });
    seedSession('session-2026-04-01', { datetime: '2026-04-01T20:00:00-04:00', courts: 2, costPerCourt: 32 });
    seedPlayer('session-2026-04-01', 'Sam', { paid: true, removed: false, waitlisted: false });

    const req = makeAdminRequest('GET', 'http://localhost:3000/api/members/m-sam/history');
    const res = await GET(req, ctx('m-sam'));
    const body = await res.json();

    expect(body.sessions).toHaveLength(1);
    expect(body.lifetime.attended).toBe(1);
  });

  it('returns empty history when member exists but has no player records', async () => {
    seedMember('Newbie', { id: 'm-newbie' });
    const req = makeAdminRequest('GET', 'http://localhost:3000/api/members/m-newbie/history');
    const res = await GET(req, ctx('m-newbie'));
    const body = await res.json();

    expect(body.sessions).toEqual([]);
    expect(body.lifetime.attended).toBe(0);
    expect(body.lifetime.totalPaid).toBe(0);
  });
});
