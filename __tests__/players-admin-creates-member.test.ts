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
import { POST } from '@/app/api/players/route';

setupAdminPin();

describe('POST /api/players — admin creates member when missing', () => {
  beforeEach(async () => {
    resetMockStore();
    await seedTestAdminMember();
    seedPointer('session-2026-05-06');
    seedSession('session-2026-05-06');
  });

  it('admin signing up a brand-new name creates a member and links memberId', async () => {
    const req = makeAdminRequest('POST', 'http://localhost:3000/api/players', {
      name: 'Brand New Player',
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.memberId).toBeDefined();

    const members = getStore()['members'] as Array<{ id: string; name: string }>;
    const created = members.find((m) => m.name === 'Brand New Player');
    expect(created).toBeDefined();
    expect(body.memberId).toBe(created!.id);
  });

  it('admin signing up an existing member name reuses that memberId', async () => {
    const members = getStore()['members'] as Array<{
      id: string;
      name: string;
      sessionCount: number;
      active: boolean;
      createdAt: string;
      role: string;
    }>;
    members.push({
      id: 'member-existing-daisy',
      name: 'Daisy',
      sessionCount: 5,
      active: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      role: 'member',
    });

    const req = makeAdminRequest('POST', 'http://localhost:3000/api/players', {
      name: 'Daisy',
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.memberId).toBe('member-existing-daisy');

    const namedMembers = members.filter((m) => m.name === 'Daisy');
    expect(namedMembers.length).toBe(1); // no duplicate
  });

  it('non-admin signing up a name not in members is rejected when invite list is populated', async () => {
    // members is non-empty (just the admin) — invite-only behavior fires
    const req = makeRequest('POST', 'http://localhost:3000/api/players', {
      name: 'Anonymous Stranger',
    });
    const res = await POST(req);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('invite_list_not_found');
  });
});
