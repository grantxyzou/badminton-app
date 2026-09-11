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

/** Push one raw document into a mock container, creating the container. */
export function seedDoc<T extends Record<string, unknown>>(container: string, doc: T): T {
  const store = getStore();
  if (!store[container]) store[container] = [];
  store[container].push(doc);
  return doc;
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

/** A raw `groups` doc. Defaults are a plain club owned by `overrides.ownerMemberId ?? 'owner'`. */
export function seedGroup(id: string, overrides: Record<string, unknown> = {}) {
  return seedDoc('groups', {
    id,
    name: `Group ${id}`,
    sport: 'badminton',
    ownerMemberId: 'owner',
    createdAt: '2026-01-01T00:00:00.000Z',
    createdBy: 'owner',
    settings: { skipDates: [], maxPlayers: 12 },
    ...overrides,
  });
}

/**
 * A `memberships` doc AND the name reservation that belongs with it.
 *
 * It used to write only the row, and that made seeded state a shape the app
 * cannot produce: `addMembership` always reserves the name first, and with
 * groups on a name resolves through the RESERVATION, not by scanning
 * memberships. A test seeding the row alone therefore had a member who was on
 * the roster and simultaneously unreachable by name — which reads as a routing
 * bug in whatever route is under test. Pass `reserveName: false` for the
 * half-written state deliberately (an interrupted backfill), and note a
 * `removed` membership holds no reservation in real life either.
 */
export function seedMembership(
  groupId: string,
  memberId: string,
  overrides: Record<string, unknown> & { reserveName?: boolean } = {},
) {
  const { reserveName, ...rest } = overrides;
  const name = typeof rest.name === 'string' ? rest.name : memberId;
  const nameLower = name.trim().toLowerCase();
  const row = seedDoc('memberships', {
    id: `${groupId}:${memberId}`,
    groupId,
    memberId,
    name,
    nameLower,
    role: 'member',
    status: 'active',
    joinedAt: new Date().toISOString(),
    joinedVia: 'admin',
    ...rest,
  });
  const wantsReservation = reserveName ?? (rest.status ?? 'active') === 'active';
  if (wantsReservation) {
    const id = `${groupId}:name:${nameLower}`;
    const rows = (getStore()['memberships'] ?? []) as { id: string }[];
    if (!rows.some((r) => r.id === id)) {
      seedDoc('memberships', { id, groupId, kind: 'name', memberId, nameLower });
    }
  }
  return row;
}

export function seedAlias(appName: string, etransferName: string) {
  const store = getStore();
  if (!store['aliases']) store['aliases'] = [];
  const alias = {
    id: `alias-${Math.random().toString(36).slice(2, 8)}`,
    appName,
    etransferName,
  };
  store['aliases'].push(alias);
  return alias;
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
export async function seedTestAdminMember(opts: { membership?: boolean } = {}) {
  const store = getStore();
  if (!store['members']) store['members'] = [];
  const existing = (store['members'] as Array<{ id: string }>).find(
    (m) => m.id === TEST_ADMIN_MEMBER_ID,
  );
  const pinHash = await hashPin(TEST_PIN);
  if (existing) {
    Object.assign(existing, { role: 'admin', active: true, pinHash });
    if (opts.membership !== false) seedAdminMembership();
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
  if (opts.membership !== false) seedAdminMembership();
  return member;
}

/**
 * The test admin's BPM membership, seeded WITH the Member.
 *
 * With groups on, `Member.role` is not what admits an admin — the membership in
 * the resolved group is (`isAdminAuthedWithMember`, `POST /api/admin`). So a
 * seeded admin without one is an admin of nowhere, and every flag-on admin test
 * had to remember to add it by hand or read as a 401 that looks like a routing
 * bug. Flag OFF this row is inert: nothing reads `memberships` at all.
 *
 * `seedTestAdminMember({ membership: false })` opts out, for the one premise
 * where it would be wrong: the BACKFILL, whose whole job is a deployment that
 * has Members and no memberships yet.
 */
function seedAdminMembership() {
  const rows = (getStore()['memberships'] ?? []) as { id: string }[];
  if (rows.some((r) => r.id === `bpm:${TEST_ADMIN_MEMBER_ID}`)) return;
  seedMembership('bpm', TEST_ADMIN_MEMBER_ID, { name: TEST_ADMIN_NAME, role: 'owner' });
}

/** The memberId carried by the test admin cookie — exported so tests can
 *  seed a member doc at that id (e.g. a demoted/deactivated admin). */
export const ADMIN_MEMBER_ID = TEST_ADMIN_MEMBER_ID;

/**
 * Seed the test admin Member *synchronously* (no `pinHash`). The async-with-member
 * admin gate (`isAdminAuthedWithMember`) only re-checks `role === 'admin' &&
 * active === true`, so mutating-route tests don't need the scrypt-hashed PIN that
 * `seedTestAdminMember` computes — just the role/active fields. Pass overrides to
 * model a demoted (`{ role: 'member' }`) or deactivated (`{ active: false }`)
 * admin. Idempotent on the fixed admin memberId. Returns the member.
 */
export function seedAdminMember(overrides: Record<string, unknown> = {}) {
  const store = getStore();
  if (!store['members']) store['members'] = [];
  const base = {
    id: TEST_ADMIN_MEMBER_ID,
    name: TEST_ADMIN_NAME,
    role: 'admin' as const,
    sessionCount: 0,
    active: true,
    createdAt: new Date().toISOString(),
  };
  const existing = (store['members'] as Array<{ id: string }>).find(
    (m) => m.id === TEST_ADMIN_MEMBER_ID,
  );
  if (existing) {
    Object.assign(existing, base, overrides);
    return existing;
  }
  const member = { ...base, ...overrides };
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
export function adminCookieValue(
  /** `groupId: null` mints a cookie from before the claim existed (reads as BPM). */
  opts: { groupId?: string | null } = {},
): string {
  const now = Math.floor(Date.now() / 1000);
  const groupId = opts.groupId === undefined ? 'bpm' : opts.groupId;
  const payload = {
    memberId: TEST_ADMIN_MEMBER_ID,
    name: TEST_ADMIN_NAME,
    ...(groupId === null ? {} : { groupId }),
    // The AUDIENCE, mirroring `setAdminCookie`. Without it this is a token no
    // admin check accepts — which is the point: the cookie NAME is chosen by
    // the client, so only `typ` says which credential a value is.
    typ: 'admin',
    iat: now,
    exp: now + 60 * 60 * 8,
  };
  const headerB64 = base64urlEncode(Buffer.from(JSON.stringify(payload), 'utf8'));
  const sig = createHmac('sha256', TEST_SESSION_SECRET).update(headerB64).digest();
  const sigB64 = base64urlEncode(sig);
  return `${headerB64}.${sigB64}`;
}

/**
 * Build a valid `member_session` cookie value for a given member identity.
 * Same signed-payload format as the admin cookie (so it exercises the real
 * `verifyMemberAuth` path), but bound to an arbitrary name/id — used to test
 * member-scoped read gates like /api/stats/level.
 */
export function memberCookieValue(
  name: string,
  memberId = `member-${name.toLowerCase()}`,
  /** Seconds until expiry. Negative mints a LAPSED cookie — signature valid,
   *  expiry passed — the state a member is in after the 30-day TTL. */
  ttlSeconds = 60 * 60 * 24 * 30,
  /** The group claim (multi-group Phase 2). `null` mints a pre-claim cookie, which reads as BPM. */
  groupId: string | null = 'bpm',
  /** The audience, mirroring `setMemberCookie`. `null` mints a token from
   *  before the field existed — which still reads as a member session. */
  typ: 'member' | null = 'member',
): string {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    memberId,
    name,
    ...(groupId === null ? {} : { groupId }),
    ...(typ === null ? {} : { typ }),
    iat: now - 60,
    exp: now + ttlSeconds,
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
