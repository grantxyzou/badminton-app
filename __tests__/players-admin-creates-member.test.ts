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
  seedMember,
  memberCookieValue,
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

  it('a non-admin with no account cannot sign up a new name, and no member is created', async () => {
    // Members-only: refused at the gate (401) before any name lookup — this
    // used to be `invite_list_not_found` (403) for a name-only call.
    const req = makeRequest('POST', 'http://localhost:3000/api/players', {
      name: 'Anonymous Stranger',
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
    const members = getStore()['members'] as Array<{ name: string }>;
    expect(members.some((m) => m.name === 'Anonymous Stranger')).toBe(false);
    expect(getStore()['players'] ?? []).toHaveLength(0);
  });

  it('a signed-in non-admin cannot create a member by naming one: the body name is ignored', async () => {
    const lin = seedMember('Lin');
    const req = makeRequest('POST', 'http://localhost:3000/api/players', {
      name: 'Anonymous Stranger',
    }, { Cookie: `member_session=${memberCookieValue('Lin', lin.id)}` });
    const res = await POST(req);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.name).toBe('Lin');
    expect(body.memberId).toBe(lin.id);
    const members = getStore()['members'] as Array<{ name: string }>;
    expect(members.some((m) => m.name === 'Anonymous Stranger')).toBe(false);
  });
});
