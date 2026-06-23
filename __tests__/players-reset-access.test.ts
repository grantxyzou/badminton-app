import { describe, it, expect, beforeEach } from 'vitest';
import { POST } from '@/app/api/players/reset-access/route';
import {
  resetMockStore,
  seedPointer,
  seedSession,
  seedMember,
  setupAdminPin,
  adminCookieValue,
  makeRequest,
  makeAdminRequest,
  seedAdminMember,
  getStore,
} from './helpers';

const SESSION = 'session-2026-04-27';
const URL_PATH = 'http://localhost:3000/api/players/reset-access';

beforeEach(() => {
  resetMockStore();
  seedAdminMember();
  setupAdminPin();
  seedPointer(SESSION);
  seedSession(SESSION);
});

describe('POST /api/players/reset-access', () => {
  it('returns 401 for non-admin (no cookie)', async () => {
    seedMember('Michael');
    const res = await POST(makeRequest('POST', URL_PATH, { name: 'Michael' }));
    expect(res.status).toBe(401);
  });

  it('mints a 6-digit code for a member by name and stores it on the member doc', async () => {
    const member = seedMember('Michael');
    const res = await POST(makeAdminRequest('POST', URL_PATH, { name: 'Michael' }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.code).toMatch(/^[0-9]{6}$/);
    expect(typeof data.expiresAt).toBe('number');
    expect(data.expiresAt).toBeGreaterThan(Date.now());

    // Code persists on the member doc (survives cold starts).
    const stored = (getStore()['members'] as Array<{ id: string; recoveryCode?: unknown }>).find(
      (m) => m.id === member.id,
    );
    expect(stored?.recoveryCode).toBeTruthy();
  });

  it('works for a member who is NOT signed up for the active session', async () => {
    // The whole point of the fix: no player record is needed.
    seedMember('Riley');
    const res = await POST(makeAdminRequest('POST', URL_PATH, { name: 'Riley' }));
    expect(res.status).toBe(200);
  });

  it('matches the member case-insensitively', async () => {
    seedMember('Michael');
    const res = await POST(makeAdminRequest('POST', URL_PATH, { name: 'michael' }));
    expect(res.status).toBe(200);
  });

  it('returns 404 when no member exists for that name', async () => {
    const res = await POST(makeAdminRequest('POST', URL_PATH, { name: 'Nobody' }));
    expect(res.status).toBe(404);
  });

  it('returns 400 when name is missing', async () => {
    const res = await POST(makeAdminRequest('POST', URL_PATH, {}));
    expect(res.status).toBe(400);
  });

  it('rate-limits at 10 requests/hour from same IP', async () => {
    seedMember('Michael');
    const cookie = `admin_session=${adminCookieValue()}`;
    const headers = { Cookie: cookie, 'X-Client-IP': '10.0.0.99' };

    for (let i = 0; i < 10; i++) {
      const res = await POST(makeRequest('POST', URL_PATH, { name: 'Michael' }, headers));
      expect(res.status).toBe(200);
    }
    const res = await POST(makeRequest('POST', URL_PATH, { name: 'Michael' }, headers));
    expect(res.status).toBe(429);
  });
});
