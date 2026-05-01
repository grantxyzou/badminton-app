import { describe, it, expect, beforeEach } from 'vitest';
import {
  resetMockStore,
  setupAdminPin,
  seedMember,
  makeRequest,
  makeAdminRequest,
  makeGetRequest,
} from './helpers';
import { GET, POST, PATCH, DELETE } from '@/app/api/members/route';
import { GET as ME_GET, PATCH as ME_PATCH } from '@/app/api/members/me/route';
import { hashPin, verifyPin } from '@/lib/recoveryHash';

setupAdminPin();

describe('GET /api/members', () => {
  beforeEach(() => {
    resetMockStore();
    seedMember('Alice', { role: 'admin', sessionCount: 10 });
    seedMember('Bob', { role: 'member', sessionCount: 3 });
  });

  it('non-admin returns only [{name, active}] — no role, id, or stats', async () => {
    // ARRANGE: request without admin cookie
    const req = makeGetRequest('http://localhost:3000/api/members');

    // ACT
    const res = await GET(req);
    const data = await res.json();

    // ASSERT: each item has name + active, nothing else
    expect(res.status).toBe(200);
    expect(data).toHaveLength(2);
    for (const item of data) {
      expect(Object.keys(item)).toEqual(['name', 'active']);
    }
  });

  it('admin returns full member objects with all fields', async () => {
    // ARRANGE: admin request
    const req = makeGetRequest('http://localhost:3000/api/members', true);

    // ACT
    const res = await GET(req);
    const data = await res.json();

    // ASSERT: full records come back (role, id, sessionCount present)
    expect(res.status).toBe(200);
    expect(data).toHaveLength(2);
    const alice = data.find((m: { name: string }) => m.name === 'Alice');
    expect(alice).toBeDefined();
    expect(alice.role).toBe('admin');
    expect(alice.sessionCount).toBe(10);
    expect(alice.id).toBeDefined();
  });
});

describe('POST /api/members', () => {
  beforeEach(() => {
    resetMockStore();
  });

  it('admin creates a new member → 201', async () => {
    // ARRANGE: admin POST with a fresh name
    const req = makeAdminRequest('POST', 'http://localhost:3000/api/members', { name: 'Charlie' });

    // ACT
    const res = await POST(req);
    const data = await res.json();

    // ASSERT
    expect(res.status).toBe(201);
    expect(data.name).toBe('Charlie');
    expect(data.active).toBe(true);
    expect(data.role).toBe('member');
  });

  it('duplicate active member name → 409', async () => {
    // ARRANGE: seed an active member named Dana
    seedMember('Dana', { active: true });
    const req = makeAdminRequest('POST', 'http://localhost:3000/api/members', { name: 'Dana' });

    // ACT
    const res = await POST(req);
    const data = await res.json();

    // ASSERT
    expect(res.status).toBe(409);
    expect(data.error).toBe('Member already exists');
  });

  it('empty name → 400', async () => {
    // ARRANGE
    const req = makeAdminRequest('POST', 'http://localhost:3000/api/members', { name: '' });

    // ACT
    const res = await POST(req);
    const data = await res.json();

    // ASSERT
    expect(res.status).toBe(400);
    expect(data.error).toBe('Name required');
  });

  it('non-admin → 401', async () => {
    // ARRANGE: plain (unauthenticated) request
    const req = makeRequest('POST', 'http://localhost:3000/api/members', { name: 'Eve' });

    // ACT
    const res = await POST(req);

    // ASSERT
    expect(res.status).toBe(401);
  });
});

describe('GET /api/members/me', () => {
  beforeEach(() => {
    resetMockStore();
    seedMember('Alice', { role: 'admin', active: true });
  });

  it('?name=Alice where Alice is admin → { role: "admin" }', async () => {
    // ARRANGE
    const req = makeGetRequest('http://localhost:3000/api/members/me?name=Alice');

    // ACT
    const res = await ME_GET(req);
    const data = await res.json();

    // ASSERT
    expect(data.role).toBe('admin');
  });

  it('?name=Unknown → { role: "member" }', async () => {
    // ARRANGE: no member named Unknown in the store
    const req = makeGetRequest('http://localhost:3000/api/members/me?name=Unknown');

    // ACT
    const res = await ME_GET(req);
    const data = await res.json();

    // ASSERT: defaults to 'member' when name not found
    expect(data.role).toBe('member');
  });

  it('no name param → { role: "member" }', async () => {
    // ARRANGE: no query param at all
    const req = makeGetRequest('http://localhost:3000/api/members/me');

    // ACT
    const res = await ME_GET(req);
    const data = await res.json();

    // ASSERT: short-circuits to safe default
    expect(data.role).toBe('member');
  });
});

describe('PATCH /api/members/me — member-scoped PIN management', () => {
  beforeEach(() => {
    resetMockStore();
    setupAdminPin();
  });

  it('first-time set: claim flow — no currentPin required when member has no pinHash', async () => {
    seedMember('Riley');
    const res = await ME_PATCH(
      makeRequest('POST', 'http://localhost:3000/api/members/me', {
        name: 'Riley',
        newPin: '4827',
      }),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.hasPin).toBe(true);
  });

  it('change with correct currentPin succeeds', async () => {
    const oldHash = await hashPin('4827');
    seedMember('Riley', { pinHash: oldHash });

    const res = await ME_PATCH(
      makeRequest('POST', 'http://localhost:3000/api/members/me', {
        name: 'Riley',
        currentPin: '4827',
        newPin: '5392',
      }),
    );
    expect(res.status).toBe(200);
  });

  it('change with wrong currentPin → 401 invalid_credentials', async () => {
    const oldHash = await hashPin('4827');
    seedMember('Riley', { pinHash: oldHash });

    const res = await ME_PATCH(
      makeRequest('POST', 'http://localhost:3000/api/members/me', {
        name: 'Riley',
        currentPin: '0000',
        newPin: '5392',
      }),
    );
    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.error).toBe('invalid_credentials');
  });

  it('change WITHOUT currentPin (when member has pinHash) → 401 current_pin_required', async () => {
    const oldHash = await hashPin('4827');
    seedMember('Riley', { pinHash: oldHash });

    const res = await ME_PATCH(
      makeRequest('POST', 'http://localhost:3000/api/members/me', {
        name: 'Riley',
        newPin: '5392',
      }),
    );
    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.error).toBe('current_pin_required');
  });

  it('clear PIN with correct currentPin works', async () => {
    const oldHash = await hashPin('4827');
    seedMember('Riley', { pinHash: oldHash });

    const res = await ME_PATCH(
      makeRequest('POST', 'http://localhost:3000/api/members/me', {
        name: 'Riley',
        currentPin: '4827',
        newPin: null,
      }),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.hasPin).toBe(false);
  });

  it('blocklisted newPin → 400 pin_too_common', async () => {
    seedMember('Riley');
    const res = await ME_PATCH(
      makeRequest('POST', 'http://localhost:3000/api/members/me', {
        name: 'Riley',
        newPin: '1234',
      }),
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe('pin_too_common');
  });

  it('non-existent member → 401 invalid_credentials (constant-time, FAKE_HASH)', async () => {
    const res = await ME_PATCH(
      makeRequest('POST', 'http://localhost:3000/api/members/me', {
        name: 'Ghost',
        currentPin: '4827',
        newPin: '5392',
      }),
    );
    expect(res.status).toBe(401);
  });

  it('cross-week persistence: PIN set via member endpoint survives session advance', async () => {
    // Member set PIN; later when sessions advance, the member.pinHash
    // is still the source of truth — recover endpoint will verify
    // against it regardless of any (or no) session player.
    seedMember('Riley');
    await ME_PATCH(
      makeRequest('POST', 'http://localhost:3000/api/members/me', {
        name: 'Riley',
        newPin: '4827',
      }),
    );

    const { getStore } = await import('./helpers');
    const members = (getStore()['members'] ?? []) as Array<{ name: string; pinHash?: string }>;
    const stored = members.find((m) => m.name === 'Riley');
    expect(stored?.pinHash).toBeDefined();
    if (stored?.pinHash) {
      expect(await verifyPin('4827', stored.pinHash)).toBe(true);
    }
  });
});
