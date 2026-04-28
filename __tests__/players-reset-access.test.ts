import { describe, it, expect, beforeEach } from 'vitest';
import { POST } from '@/app/api/players/reset-access/route';
import {
  resetMockStore,
  seedPointer,
  seedSession,
  seedPlayer,
  setupAdminPin,
  adminCookieValue,
  makeRequest,
  makeAdminRequest,
} from './helpers';
import { __resetForTests } from '@/lib/recoveryCodes';

const SESSION = 'session-2026-04-27';
const URL_PATH = 'http://localhost:3000/api/players/reset-access';

beforeEach(() => {
  resetMockStore();
  setupAdminPin();
  __resetForTests();
  seedPointer(SESSION);
  seedSession(SESSION);
  process.env.NEXT_PUBLIC_FLAG_RECOVERY = 'true';
});

describe('POST /api/players/reset-access', () => {
  it('returns 401 for non-admin (no cookie)', async () => {
    const player = seedPlayer(SESSION, 'Michael');
    const res = await POST(makeRequest('POST', URL_PATH, { playerId: player.id }));
    expect(res.status).toBe(401);
  });

  it('mints a 6-digit code for a valid player', async () => {
    const player = seedPlayer(SESSION, 'Michael');
    const res = await POST(makeAdminRequest('POST', URL_PATH, { playerId: player.id }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.code).toMatch(/^[0-9]{6}$/);
    expect(typeof data.expiresAt).toBe('number');
    expect(data.expiresAt).toBeGreaterThan(Date.now());
  });

  it('rejects soft-deleted player with 409', async () => {
    const player = seedPlayer(SESSION, 'Michael', { removed: true });
    const res = await POST(makeAdminRequest('POST', URL_PATH, { playerId: player.id }));
    expect(res.status).toBe(409);
  });

  it('returns 404 when player does not exist', async () => {
    const res = await POST(makeAdminRequest('POST', URL_PATH, { playerId: 'nonexistent' }));
    expect(res.status).toBe(404);
  });

  it('rate-limits at 10 requests/hour from same IP', async () => {
    const player = seedPlayer(SESSION, 'Michael');
    const cookie = `admin_session=${adminCookieValue()}`;
    const headers = { Cookie: cookie, 'X-Client-IP': '10.0.0.99' };

    for (let i = 0; i < 10; i++) {
      const res = await POST(makeRequest('POST', URL_PATH, { playerId: player.id }, headers));
      expect(res.status).toBe(200);
    }
    const res = await POST(makeRequest('POST', URL_PATH, { playerId: player.id }, headers));
    expect(res.status).toBe(429);
  });

  it('returns 404 when flag is off', async () => {
    const prev = process.env.NEXT_PUBLIC_FLAG_RECOVERY;
    process.env.NEXT_PUBLIC_FLAG_RECOVERY = 'false';
    try {
      const player = seedPlayer(SESSION, 'Michael');
      const res = await POST(makeAdminRequest('POST', URL_PATH, { playerId: player.id }));
      expect(res.status).toBe(404);
    } finally {
      process.env.NEXT_PUBLIC_FLAG_RECOVERY = prev;
    }
  });
});
