import { describe, it, expect, beforeEach } from 'vitest';
import {
  resetMockStore,
  setupAdminPin,
  seedTestAdminMember,
  makeAdminRequest,
  makeRequest,
  getStore,
} from './helpers';
import { POST } from '@/app/api/admin/migrate-memberId/route';

setupAdminPin();

describe('POST /api/admin/migrate-memberId', () => {
  beforeEach(async () => {
    resetMockStore();
    await seedTestAdminMember();
  });

  it('non-admin gets 401', async () => {
    const req = makeRequest('POST', 'http://localhost:3000/api/admin/migrate-memberId', { dryRun: true });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('links a player without memberId to an existing member by exact name', async () => {
    const store = getStore();
    (store['members'] as Array<unknown>).push({
      id: 'm1', name: 'Daisy', role: 'member', sessionCount: 0, active: true, createdAt: 'x',
    });
    store['players'] = [{ id: 'p1', name: 'Daisy', sessionId: 'session-2026-04-01', timestamp: 'x' }];

    const req = makeAdminRequest('POST', 'http://localhost:3000/api/admin/migrate-memberId', { dryRun: false });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.linked).toBe(1);
    expect(body.created).toBe(0);
    expect(body.collisions).toEqual([]);
    expect((store['players'][0] as { memberId?: string }).memberId).toBe('m1');
  });

  it('creates a member when one does not exist for the player name', async () => {
    const store = getStore();
    store['players'] = [{ id: 'p1', name: 'Newcomer', sessionId: 's1', timestamp: 'x' }];

    const req = makeAdminRequest('POST', 'http://localhost:3000/api/admin/migrate-memberId', { dryRun: false });
    const res = await POST(req);
    const body = await res.json();

    expect(body.created).toBe(1);
    expect(body.linked).toBe(1);
    const created = (store['members'] as Array<{ name: string }>).find((m) => m.name === 'Newcomer');
    expect(created).toBeDefined();
    expect((store['players'][0] as { memberId?: string }).memberId).toBeDefined();
  });

  it('skips records that already have memberId', async () => {
    const store = getStore();
    (store['members'] as Array<unknown>).push({
      id: 'm1', name: 'Daisy', role: 'member', sessionCount: 0, active: true, createdAt: 'x',
    });
    store['players'] = [{ id: 'p1', name: 'Daisy', sessionId: 's1', timestamp: 'x', memberId: 'm1' }];

    const req = makeAdminRequest('POST', 'http://localhost:3000/api/admin/migrate-memberId', { dryRun: false });
    const res = await POST(req);
    const body = await res.json();

    expect(body.linked).toBe(0);
    expect(body.skipped).toBe(1);
  });

  it('halts on collision: two distinct members sharing a name', async () => {
    const store = getStore();
    (store['members'] as Array<unknown>).push(
      { id: 'm1', name: 'Daisy', role: 'member', sessionCount: 0, active: true, createdAt: 'x' },
      { id: 'm2', name: 'Daisy', role: 'member', sessionCount: 0, active: true, createdAt: 'x' },
    );
    store['players'] = [{ id: 'p1', name: 'Daisy', sessionId: 's1', timestamp: 'x' }];

    const req = makeAdminRequest('POST', 'http://localhost:3000/api/admin/migrate-memberId', { dryRun: false });
    const res = await POST(req);
    const body = await res.json();

    expect(body.collisions.length).toBe(1);
    expect(body.collisions[0]).toEqual({ name: 'Daisy', memberCount: 2 });
    expect((store['players'][0] as { memberId?: string }).memberId).toBeUndefined();
  });

  it('dry run makes no writes', async () => {
    const store = getStore();
    store['players'] = [{ id: 'p1', name: 'Newcomer', sessionId: 's1', timestamp: 'x' }];
    const memberCountBefore = (store['members'] as Array<unknown>).length;

    const req = makeAdminRequest('POST', 'http://localhost:3000/api/admin/migrate-memberId', { dryRun: true });
    const res = await POST(req);
    const body = await res.json();

    expect(body.linked).toBe(0);
    expect(body.wouldLink).toBe(1);
    expect(body.wouldCreate).toBe(1);
    expect((store['members'] as Array<unknown>).length).toBe(memberCountBefore);
    expect((store['players'][0] as { memberId?: string }).memberId).toBeUndefined();
  });

  it('is idempotent — second run is a no-op', async () => {
    const store = getStore();
    (store['members'] as Array<unknown>).push({
      id: 'm1', name: 'Daisy', role: 'member', sessionCount: 0, active: true, createdAt: 'x',
    });
    store['players'] = [{ id: 'p1', name: 'Daisy', sessionId: 's1', timestamp: 'x' }];

    const req1 = makeAdminRequest('POST', 'http://localhost:3000/api/admin/migrate-memberId', { dryRun: false });
    const r1 = await (await POST(req1)).json();
    expect(r1.linked).toBe(1);

    const req2 = makeAdminRequest('POST', 'http://localhost:3000/api/admin/migrate-memberId', { dryRun: false });
    const r2 = await (await POST(req2)).json();
    expect(r2.linked).toBe(0);
    expect(r2.skipped).toBe(1);
  });
});
