import { describe, it, expect, beforeEach } from 'vitest';
import { POST } from '@/app/api/players/route';
import {
  resetMockStore,
  seedPointer,
  seedSession,
  seedMember,
  setupAdminPin,
  makeRequest,
  getStore,
} from './helpers';
import { verifyPin } from '@/lib/recoveryHash';

const SESSION = 'session-2026-04-30';
const URL_PATH = 'http://localhost:3000/api/players';

beforeEach(() => {
  resetMockStore();
  setupAdminPin();
  seedPointer(SESSION);
  seedSession(SESSION);
});

describe('POST /api/players { sessionSignup: false } — account-only path', () => {
  it('creates a member with pinHash, no session player', async () => {
    const res = await POST(
      makeRequest('POST', URL_PATH, { name: 'Riley', pin: '4827', sessionSignup: false }),
    );
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.name).toBe('Riley');
    expect(data.deleteToken).toBeNull();
    expect(data.id).toMatch(/^[0-9a-f]{24}$/);

    const store = getStore();
    const members = (store['members'] ?? []) as Array<{ name: string; pinHash?: string }>;
    expect(members.find((m) => m.name === 'Riley')?.pinHash).toBeDefined();
    expect(store['players'] ?? []).toHaveLength(0);
  });

  it('PIN is required — 400 when omitted', async () => {
    const res = await POST(
      makeRequest('POST', URL_PATH, { name: 'Riley', sessionSignup: false }),
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/PIN required/);
  });

  it('rejects blocklisted PINs', async () => {
    const res = await POST(
      makeRequest('POST', URL_PATH, { name: 'Riley', pin: '1234', sessionSignup: false }),
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe('pin_too_common');
  });

  it('rejects malformed PINs (non-4-digit)', async () => {
    const res = await POST(
      makeRequest('POST', URL_PATH, { name: 'Riley', pin: '12', sessionSignup: false }),
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe('Invalid PIN format');
  });

  it('idempotent on repeat: existing member updated, no duplicate row', async () => {
    seedMember('Casey', { pinHash: 'old-hash' });

    const res = await POST(
      makeRequest('POST', URL_PATH, { name: 'Casey', pin: '5821', sessionSignup: false }),
    );
    expect(res.status).toBe(201);

    const store = getStore();
    const members = (store['members'] ?? []) as Array<{ name: string; pinHash?: string }>;
    const caseys = members.filter((m) => m.name === 'Casey');
    expect(caseys).toHaveLength(1);
    expect(caseys[0].pinHash).not.toBe('old-hash');
    if (caseys[0].pinHash) {
      expect(await verifyPin('5821', caseys[0].pinHash)).toBe(true);
    }
  });

  it('rate-limits at 3 attempts/hr per (name, IP)', async () => {
    const ip = { 'X-Client-IP': '10.99.0.1' };

    for (let i = 0; i < 3; i++) {
      const res = await POST(
        makeRequest('POST', URL_PATH, { name: 'Spammer', pin: '4827', sessionSignup: false }, ip),
      );
      expect(res.status).toBe(201);
    }

    const fourth = await POST(
      makeRequest('POST', URL_PATH, { name: 'Spammer', pin: '4827', sessionSignup: false }, ip),
    );
    expect(fourth.status).toBe(429);

    // Different name from same IP gets its own bucket
    const otherName = await POST(
      makeRequest('POST', URL_PATH, { name: 'Different', pin: '4827', sessionSignup: false }, ip),
    );
    expect(otherName.status).toBe(201);
  });

  it('does not run invite-list check (account creation is universal)', async () => {
    seedMember('Existing'); // active member exists, so non-admin signup normally requires being on the list

    // Account creation for a name not on the list still succeeds
    const res = await POST(
      makeRequest('POST', URL_PATH, { name: 'NewPerson', pin: '4827', sessionSignup: false }),
    );
    expect(res.status).toBe(201);
  });
});

describe('POST /api/players — default behavior unchanged when sessionSignup omitted', () => {
  it('still creates a session player by default', async () => {
    seedMember('Riley'); // on invite list

    const res = await POST(
      makeRequest('POST', URL_PATH, { name: 'Riley', pin: '4827' }),
    );
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.deleteToken).toMatch(/^[0-9a-f]{32}$/);

    const store = getStore();
    expect((store['players'] ?? []).filter((p) => (p as { name: string }).name === 'Riley')).toHaveLength(1);
  });
});
