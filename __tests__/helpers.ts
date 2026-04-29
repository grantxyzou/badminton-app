import { createHmac } from 'crypto';
import { NextRequest } from 'next/server';
import { hashPin } from '../lib/recoveryHash';

/* ── Mock store management ── */

const g = global as typeof globalThis & { _mockStore?: Record<string, unknown[]> };

export function resetMockStore() {
  if (g._mockStore) {
    for (const key of Object.keys(g._mockStore)) {
      delete g._mockStore[key];
    }
  } else {
    g._mockStore = {};
  }
}

export function getStore(): Record<string, unknown[]> {
  if (!g._mockStore) g._mockStore = {};
  return g._mockStore;
}

/* ── Seeding helpers ── */

export function seedPointer(activeSessionId: string) {
  const store = getStore();
  if (!store['sessions']) store['sessions'] = [];
  store['sessions'].push({
    id: 'active-session-pointer',
    sessionId: 'active-session-pointer',
    activeSessionId,
  });
}

export function seedSession(id: string, overrides: Record<string, unknown> = {}) {
  const store = getStore();
  if (!store['sessions']) store['sessions'] = [];
  store['sessions'].push({
    id,
    sessionId: id,
    title: 'Test Session',
    maxPlayers: 12,
    signupOpen: true,
    courts: 2,
    datetime: new Date(Date.now() + 86400000).toISOString(),
    deadline: new Date(Date.now() + 86400000).toISOString(),
    ...overrides,
  });
}

export function seedPlayer(
  sessionId: string,
  name: string,
  overrides: Record<string, unknown> = {},
) {
  const store = getStore();
  if (!store['players']) store['players'] = [];
  const id = `player-${Math.random().toString(36).slice(2, 8)}`;
  const player = {
    id,
    name,
    sessionId,
    timestamp: new Date().toISOString(),
    paid: false,
    waitlisted: false,
    removed: false,
    deleteToken: `token-${id}`,
    ...overrides,
  };
  store['players'].push(player);
  return player;
}

export function seedMember(name: string, overrides: Record<string, unknown> = {}) {
  const store = getStore();
  if (!store['members']) store['members'] = [];
  const member = {
    id: `member-${Math.random().toString(36).slice(2, 8)}`,
    name,
    role: 'member' as const,
    sessionCount: 0,
    active: true,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
  store['members'].push(member);
  return member;
}

export function seedAnnouncement(sessionId: string, text: string, overrides: Record<string, unknown> = {}) {
  const store = getStore();
  if (!store['announcements']) store['announcements'] = [];
  const ann = {
    id: `ann-${Math.random().toString(36).slice(2, 8)}`,
    text,
    time: new Date().toISOString(),
    sessionId,
    ...overrides,
  };
  store['announcements'].push(ann);
  return ann;
}

/* ── Request builders ── */

let reqCounter = 0;

/** Generate a unique IP to avoid rate limiter collisions between tests */
function uniqueIp(): string {
  reqCounter++;
  return `test-${reqCounter}`;
}

/** Admin PIN used in tests (4 digits — matches the new unified PIN format) */
const TEST_PIN = '4242';
const TEST_SESSION_SECRET = 'test-session-secret-not-for-production-use-please';
const TEST_ADMIN_MEMBER_ID = 'member-test-admin';
const TEST_ADMIN_NAME = 'Test Admin';

/**
 * Set up the test session secret for the new signed-payload cookie format.
 * Replaces the legacy `setupAdminPin` (ADMIN_PIN env var). Tests that need
 * a real admin Member with a working pinHash should also call
 * `seedTestAdminMember()`.
 */
export function setupAdminPin() {
  process.env.SESSION_SECRET = TEST_SESSION_SECRET;
  // Legacy alias kept for any test that hasn't been updated yet.
  process.env.ADMIN_PIN = TEST_PIN;
}

export function getTestPin(): string {
  return TEST_PIN;
}

export function getTestAdminName(): string {
  return TEST_ADMIN_NAME;
}

/**
 * Seed the test Member that admin tests authenticate as: `role: 'admin'`,
 * `active: true`, and `pinHash` derived from `TEST_PIN`. Idempotent.
 */
export async function seedTestAdminMember() {
  const store = getStore();
  if (!store['members']) store['members'] = [];
  const existing = (store['members'] as Array<{ id: string }>).find(
    (m) => m.id === TEST_ADMIN_MEMBER_ID,
  );
  const pinHash = await hashPin(TEST_PIN);
  if (existing) {
    Object.assign(existing, { role: 'admin', active: true, pinHash });
    return existing;
  }
  const member = {
    id: TEST_ADMIN_MEMBER_ID,
    name: TEST_ADMIN_NAME,
    role: 'admin' as const,
    sessionCount: 0,
    active: true,
    createdAt: new Date().toISOString(),
    pinHash,
  };
  store['members'].push(member);
  return member;
}

function base64urlEncode(buf: Buffer): string {
  return buf.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

/**
 * Build a valid admin cookie value (signed payload) for the test admin.
 * Mirrors the production `signPayload` function exactly so tests exercise
 * the real verification path.
 */
export function adminCookieValue(): string {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    memberId: TEST_ADMIN_MEMBER_ID,
    name: TEST_ADMIN_NAME,
    iat: now,
    exp: now + 60 * 60 * 8,
  };
  const headerB64 = base64urlEncode(Buffer.from(JSON.stringify(payload), 'utf8'));
  const sig = createHmac('sha256', TEST_SESSION_SECRET).update(headerB64).digest();
  const sigB64 = base64urlEncode(sig);
  return `${headerB64}.${sigB64}`;
}

export function makeRequest(
  method: string,
  url: string,
  body?: Record<string, unknown>,
  headers?: Record<string, string>,
): NextRequest {
  const ip = uniqueIp();
  const reqHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Client-IP': ip,
    ...headers,
  };
  const init: { method: string; headers: Record<string, string>; body?: string } = {
    method,
    headers: reqHeaders,
  };
  if (body && method !== 'GET') {
    init.body = JSON.stringify(body);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new NextRequest(url, init as any);
}

export function makeAdminRequest(
  method: string,
  url: string,
  body?: Record<string, unknown>,
): NextRequest {
  const cookie = `admin_session=${adminCookieValue()}`;
  return makeRequest(method, url, body, { Cookie: cookie });
}

/** Build a GET request with query params */
export function makeGetRequest(url: string, admin = false): NextRequest {
  if (admin) {
    return makeAdminRequest('GET', url);
  }
  return makeRequest('GET', url);
}
