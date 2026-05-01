import { describe, it, expect, beforeEach } from 'vitest';
import { POST } from '@/app/api/players/recover/route';
import {
  resetMockStore,
  seedPointer,
  seedSession,
  seedPlayer,
  setupAdminPin,
  adminCookieValue,
  makeRequest,
  makeAdminRequest,
  getStore,
} from './helpers';
import { hashPin } from '@/lib/recoveryHash';
import { issueCode, __resetForTests } from '@/lib/recoveryCodes';

const SESSION = 'session-2026-04-27';
const URL_PATH = 'http://localhost:3000/api/players/recover';

beforeEach(() => {
  resetMockStore();
  __resetForTests();
  setupAdminPin();
  seedPointer(SESSION);
  seedSession(SESSION);
  process.env.NEXT_PUBLIC_FLAG_RECOVERY = 'true';
});

describe('POST /api/players/recover', () => {
  it('PIN success: mints fresh deleteToken, never returns pinHash', async () => {
    // PIN auth verifies against members.pinHash (canonical source) per the
    // expanded Batch B architecture. Seed both records so the player
    // record exists for the deleteToken-mint path.
    const pinHash = await hashPin('1234');
    const { seedMember } = await import('./helpers');
    seedMember('Michael', { pinHash });
    const player = seedPlayer(SESSION, 'Michael', { pinHash, deleteToken: 'old-token' });

    const res = await POST(
      makeRequest('POST', URL_PATH, { name: 'Michael', sessionId: SESSION, pin: '1234' }),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.deleteToken).toMatch(/^[0-9a-f]{32}$/);
    expect(data.deleteToken).not.toBe('old-token');
    expect(data.pinHash).toBeUndefined();

    // Stored player has new token
    const stored = (getStore()['players'] as Array<{ id: string; deleteToken: string }>).find(
      (p) => p.id === player.id,
    );
    expect(stored?.deleteToken).toBe(data.deleteToken);
    expect(stored?.deleteToken).not.toBe('old-token');
  });

  it('Code success: consumes a valid issued code', async () => {
    const player = seedPlayer(SESSION, 'Sarah', { deleteToken: 'old-token' });
    const { code } = await issueCode(player.id, SESSION);

    const res = await POST(
      makeRequest('POST', URL_PATH, { name: 'Sarah', sessionId: SESSION, code }),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.deleteToken).toMatch(/^[0-9a-f]{32}$/);
  });

  it('Wrong PIN: 401 invalid_credentials', async () => {
    const pinHash = await hashPin('1234');
    const { seedMember } = await import('./helpers');
    seedMember('Michael', { pinHash });
    seedPlayer(SESSION, 'Michael', { pinHash });
    const res = await POST(
      makeRequest('POST', URL_PATH, { name: 'Michael', sessionId: SESSION, pin: '9999' }),
    );
    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.error).toBe('invalid_credentials');
  });

  it('Constant-time miss: non-existent name → 401 invalid_credentials', async () => {
    const res = await POST(
      makeRequest('POST', URL_PATH, { name: 'Ghost', sessionId: SESSION, pin: '1234' }),
    );
    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.error).toBe('invalid_credentials');
  });

  it('Rate limits at 5 attempts/hr per (name, IP); independent buckets per name', async () => {
    const pinHash = await hashPin('1234');
    seedPlayer(SESSION, 'Michael', { pinHash });

    const realIp = { 'X-Client-IP': '10.0.0.1' };
    const fakeIp = { 'X-Client-IP': '10.0.0.2' };

    // 5 wrong attempts against real name from realIp → all 401
    for (let i = 0; i < 5; i++) {
      const res = await POST(
        makeRequest(
          'POST',
          URL_PATH,
          { name: 'Michael', sessionId: SESSION, pin: '0000' },
          realIp,
        ),
      );
      expect(res.status).toBe(401);
    }
    // 6th from same (name, IP) → 429
    const sixth = await POST(
      makeRequest(
        'POST',
        URL_PATH,
        { name: 'Michael', sessionId: SESSION, pin: '0000' },
        realIp,
      ),
    );
    expect(sixth.status).toBe(429);

    // Different name OR different IP → still allowed
    const differentName = await POST(
      makeRequest(
        'POST',
        URL_PATH,
        { name: 'Ghost', sessionId: SESSION, pin: '0000' },
        realIp,
      ),
    );
    expect(differentName.status).toBe(401);

    const differentIp = await POST(
      makeRequest(
        'POST',
        URL_PATH,
        { name: 'Michael', sessionId: SESSION, pin: '0000' },
        fakeIp,
      ),
    );
    expect(differentIp.status).toBe(401);
  });

  it('Mints new token AND invalidates old', async () => {
    // Seed member.pinHash (canonical PIN store) + player record (so we
    // hit the existing-player branch that mints a new token).
    const pinHash = await hashPin('1234');
    const { seedMember } = await import('./helpers');
    seedMember('Michael', { pinHash });
    const player = seedPlayer(SESSION, 'Michael', { pinHash, deleteToken: 'old' });
    const res = await POST(
      makeRequest('POST', URL_PATH, { name: 'Michael', sessionId: SESSION, pin: '1234' }),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    const stored = (getStore()['players'] as Array<{ id: string; deleteToken: string }>).find(
      (p) => p.id === player.id,
    );
    expect(stored?.deleteToken).toBe(data.deleteToken);
    expect(stored?.deleteToken).not.toBe('old');
  });

  it('Both pin and code present → 400', async () => {
    const res = await POST(
      makeRequest('POST', URL_PATH, {
        name: 'Michael',
        sessionId: SESSION,
        pin: '1234',
        code: '123456',
      }),
    );
    expect(res.status).toBe(400);
  });

  it('Neither pin nor code → 400', async () => {
    const res = await POST(
      makeRequest('POST', URL_PATH, { name: 'Michael', sessionId: SESSION }),
    );
    expect(res.status).toBe(400);
  });

  it('Single-identity model: an admin recovering as themselves succeeds (admin cookie persists)', async () => {
    // Previously this test asserted 403 'Use reset-access' to keep admin
    // and player auth strictly separate. The single-identity model retired
    // that guard — admin status is a property of the member record, not a
    // separate auth surface. Recovery still requires the player's own
    // PIN, so an admin can only recover as themselves.
    const pinHash = await hashPin('1234');
    const { seedMember } = await import('./helpers');
    seedMember('Michael', { pinHash, role: 'admin' });
    seedPlayer(SESSION, 'Michael', { pinHash });
    const res = await POST(
      makeAdminRequest('POST', URL_PATH, {
        name: 'Michael',
        sessionId: SESSION,
        pin: '1234',
      }),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.deleteToken).toMatch(/^[0-9a-f]{32}$/);
  });

  // Note: the "Flag off → 404" test was removed when the recovery flag was
  // retired. The endpoint is now unconditionally active.

  describe('member-only fallback (no session player)', () => {
    it('verifies against members.pinHash and auto-creates a session player when signup is open', async () => {
      const pinHash = await hashPin('4827');
      const { seedMember } = await import('./helpers');
      seedMember('Riley', { pinHash });
      // No player record for the active session.

      const res = await POST(
        makeRequest('POST', URL_PATH, { name: 'Riley', sessionId: SESSION, pin: '4827' }),
      );
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.deleteToken).toMatch(/^[0-9a-f]{32}$/);

      // Session player was created on-the-fly
      const store = getStore();
      const players = (store['players'] ?? []) as Array<{ name: string; sessionId: string; deleteToken: string }>;
      const created = players.find((p) => p.name === 'Riley' && p.sessionId === SESSION);
      expect(created).toBeDefined();
      expect(created?.deleteToken).toBe(data.deleteToken);
    });

    it('returns identity-only (deleteToken: null) when signup is closed', async () => {
      const pinHash = await hashPin('4827');
      const { seedMember, seedSession, resetMockStore, seedPointer } = await import('./helpers');
      // Reset and reseed with signupOpen=false
      resetMockStore();
      seedPointer(SESSION);
      seedSession(SESSION, { signupOpen: false });
      seedMember('Riley', { pinHash });

      const res = await POST(
        makeRequest('POST', URL_PATH, { name: 'Riley', sessionId: SESSION, pin: '4827' }),
      );
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.deleteToken).toBeNull();

      // No session player created
      const store = getStore();
      expect((store['players'] ?? [])).toHaveLength(0);
    });

    it('wrong PIN against member.pinHash → 401, no player created', async () => {
      const pinHash = await hashPin('4827');
      const { seedMember } = await import('./helpers');
      seedMember('Riley', { pinHash });

      const res = await POST(
        makeRequest('POST', URL_PATH, { name: 'Riley', sessionId: SESSION, pin: '0000' }),
      );
      expect(res.status).toBe(401);

      const store = getStore();
      expect((store['players'] ?? [])).toHaveLength(0);
    });

    it('member exists without pinHash → 401 (constant-time miss), no player created', async () => {
      const { seedMember } = await import('./helpers');
      seedMember('Riley'); // no pinHash

      const res = await POST(
        makeRequest('POST', URL_PATH, { name: 'Riley', sessionId: SESSION, pin: '4827' }),
      );
      expect(res.status).toBe(401);
    });
  });
});

// Silence unused var lint
void adminCookieValue;
