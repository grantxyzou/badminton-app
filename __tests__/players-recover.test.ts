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
    const pinHash = await hashPin('1234');
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
    const pinHash = await hashPin('1234');
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

  it('Admin attempting recover → 403', async () => {
    const pinHash = await hashPin('1234');
    seedPlayer(SESSION, 'Michael', { pinHash });
    const res = await POST(
      makeAdminRequest('POST', URL_PATH, {
        name: 'Michael',
        sessionId: SESSION,
        pin: '1234',
      }),
    );
    expect(res.status).toBe(403);
  });

  it('Flag off → 404', async () => {
    const prev = process.env.NEXT_PUBLIC_FLAG_RECOVERY;
    process.env.NEXT_PUBLIC_FLAG_RECOVERY = 'false';
    try {
      const pinHash = await hashPin('1234');
      seedPlayer(SESSION, 'Michael', { pinHash });
      const res = await POST(
        makeRequest('POST', URL_PATH, { name: 'Michael', sessionId: SESSION, pin: '1234' }),
      );
      expect(res.status).toBe(404);
    } finally {
      process.env.NEXT_PUBLIC_FLAG_RECOVERY = prev;
    }
  });
});

// Silence unused var lint
void adminCookieValue;
