import { createHash } from 'crypto';
import { NextRequest } from 'next/server';

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

/** Admin PIN used in tests */
const TEST_PIN = 'test-pin-1234';

/** Set up the admin PIN env var for tests */
export function setupAdminPin() {
  process.env.ADMIN_PIN = TEST_PIN;
}

/** Get the test PIN value */
export function getTestPin(): string {
  return TEST_PIN;
}

/** Generate a valid admin cookie value matching the auth module's expected hash */
export function adminCookieValue(): string {
  return createHash('sha256').update(`badminton-admin:${TEST_PIN}`).digest('hex');
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
