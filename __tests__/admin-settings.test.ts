import { describe, it, expect, beforeEach } from 'vitest';
import {
  resetMockStore,
  setupAdminPin,
  seedTestAdminMember,
  makeAdminRequest,
  makeRequest,
  getStore,
} from './helpers';
import { PATCH } from '@/app/api/admin/settings/route';

setupAdminPin();

describe('PATCH /api/admin/settings', () => {
  beforeEach(async () => {
    resetMockStore();
    await seedTestAdminMember();
  });

  it('admin can set skipDates', async () => {
    const req = makeAdminRequest('PATCH', 'http://localhost:3000/api/admin/settings', {
      skipDates: ['2026-05-20', '2026-12-25'],
    });
    const res = await PATCH(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.skipDates).toEqual(['2026-05-20', '2026-12-25']);

    const members = getStore()['members'] as Array<{ id: string; skipDates?: string[] }>;
    const me = members.find((m) => m.id === 'member-test-admin');
    expect(me?.skipDates).toEqual(['2026-05-20', '2026-12-25']);
  });

  it('admin can set eTransferRecipient', async () => {
    const req = makeAdminRequest('PATCH', 'http://localhost:3000/api/admin/settings', {
      eTransferRecipient: { name: 'Grant', email: 'g@example.com' },
    });
    const res = await PATCH(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.eTransferRecipient.email).toBe('g@example.com');
  });

  it('rejects malformed skipDates (wrong format)', async () => {
    const req = makeAdminRequest('PATCH', 'http://localhost:3000/api/admin/settings', {
      skipDates: ['2026/05/20'],
    });
    const res = await PATCH(req);
    expect(res.status).toBe(400);
  });

  it('rejects skipDates with too many entries', async () => {
    const req = makeAdminRequest('PATCH', 'http://localhost:3000/api/admin/settings', {
      skipDates: Array.from({ length: 200 }, (_, i) => `2026-01-${String((i % 28) + 1).padStart(2, '0')}`),
    });
    const res = await PATCH(req);
    expect(res.status).toBe(400);
  });

  it('rejects malformed eTransferRecipient (missing email)', async () => {
    const req = makeAdminRequest('PATCH', 'http://localhost:3000/api/admin/settings', {
      eTransferRecipient: { name: 'Grant' },
    });
    const res = await PATCH(req);
    expect(res.status).toBe(400);
  });

  it('non-admin gets 401', async () => {
    const req = makeRequest('PATCH', 'http://localhost:3000/api/admin/settings', {
      skipDates: ['2026-05-20'],
    });
    const res = await PATCH(req);
    expect(res.status).toBe(401);
  });

  it('does not strip pinHash from the stored member doc', async () => {
    const beforeMembers = getStore()['members'] as Array<{ pinHash?: string }>;
    const beforePinHash = beforeMembers[0]?.pinHash;
    expect(beforePinHash).toBeDefined();

    const req = makeAdminRequest('PATCH', 'http://localhost:3000/api/admin/settings', {
      skipDates: ['2026-05-20'],
    });
    await PATCH(req);

    const afterMembers = getStore()['members'] as Array<{ pinHash?: string }>;
    expect(afterMembers[0]?.pinHash).toBe(beforePinHash);
  });

  it('strips pinHash from the response', async () => {
    const req = makeAdminRequest('PATCH', 'http://localhost:3000/api/admin/settings', {
      skipDates: ['2026-05-20'],
    });
    const res = await PATCH(req);
    const body = await res.json();
    expect(body.pinHash).toBeUndefined();
  });
});
