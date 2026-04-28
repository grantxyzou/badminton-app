import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { POST, PATCH, GET } from '@/app/api/players/route';
import { NextRequest } from 'next/server';
import {
  resetMockStore as resetMockStoreH,
  setupAdminPin,
  seedPointer as seedPointerH,
  seedSession as seedSessionH,
  seedPlayer,
  makeRequest,
  makeAdminRequest,
  makeGetRequest,
  getStore,
} from './helpers';

// ---- HELPERS ----
// These build fake requests so we can call our route handler directly.

/** Counter to give each request a unique IP (avoids triggering rate limiter) */
let reqCounter = 0;

/** Build a POST request with a JSON body */
function makePostRequest(body: Record<string, unknown>): NextRequest {
  reqCounter++;
  return new NextRequest('http://localhost:3000/api/players', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Client-IP': `test-${reqCounter}`,
    },
    body: JSON.stringify(body),
  });
}

/** Reset the in-memory mock store between tests so they don't bleed into each other.
 *  IMPORTANT: We clear the object's contents instead of replacing it, because
 *  cosmos.ts holds a reference captured at import time. Replacing the object
 *  would leave cosmos.ts pointing at the old one. */
function resetMockStore() {
  const g = global as typeof globalThis & { _mockStore?: Record<string, unknown[]> };
  if (g._mockStore) {
    for (const key of Object.keys(g._mockStore)) {
      delete g._mockStore[key];
    }
  } else {
    g._mockStore = {};
  }
}

/** Seed a session so the route has something to look up */
function seedSession(id: string, overrides: Record<string, unknown> = {}) {
  const g = global as typeof globalThis & { _mockStore?: Record<string, unknown[]> };
  if (!g._mockStore) g._mockStore = {};
  if (!g._mockStore['sessions']) g._mockStore['sessions'] = [];
  g._mockStore['sessions'].push({
    id,
    sessionId: id,
    maxPlayers: 12,
    signupOpen: true,
    ...overrides,
  });
}

/** Seed the active-session pointer */
function seedPointer(activeSessionId: string) {
  const g = global as typeof globalThis & { _mockStore?: Record<string, unknown[]> };
  if (!g._mockStore) g._mockStore = {};
  if (!g._mockStore['sessions']) g._mockStore['sessions'] = [];
  g._mockStore['sessions'].push({
    id: 'active-session-pointer',
    sessionId: 'active-session-pointer',
    activeSessionId,
  });
}

// ---- TESTS ----

describe('POST /api/players', () => {
  // ARRANGE (shared): Before each test, wipe the slate clean and set up
  // a session with room for players. This is like resetting a Figma frame
  // before each design review — start from a known state.
  beforeEach(() => {
    resetMockStore();
    seedPointer('session-2026-04-05');
    seedSession('session-2026-04-05', { maxPlayers: 3 });
  });

  // TEST 1: The happy path — does the basic thing work?
  it('signs up a player successfully', async () => {
    // ARRANGE: nothing extra — the beforeEach already set up an open session

    // ACT: make the request
    const res = await POST(makePostRequest({ name: 'Grant' }));
    const data = await res.json();

    // ASSERT: check the result
    expect(res.status).toBe(201);         // 201 = "created"
    expect(data.name).toBe('Grant');       // name came back correctly
    expect(data.deleteToken).toBeDefined(); // got a cancel token
    expect(data.waitlisted).toBe(false);   // not on waitlist
  });

  // TEST 2: What if the session is full?
  // This tests the BOUNDARY — the moment behavior changes.
  it('rejects sign-up when session is full', async () => {
    // ARRANGE: fill the session (maxPlayers is 3)
    await POST(makePostRequest({ name: 'Alice' }));
    await POST(makePostRequest({ name: 'Bob' }));
    await POST(makePostRequest({ name: 'Charlie' }));

    // ACT: 4th player tries to join without requesting waitlist
    const res = await POST(makePostRequest({ name: 'Dave' }));
    const data = await res.json();

    // ASSERT: rejected with 409
    expect(res.status).toBe(409);
    expect(data.error).toBe('Session is full');
  });

  // TEST 3: Full session, but player asks for waitlist
  it('allows waitlist sign-up when session is full', async () => {
    // ARRANGE: fill the session
    await POST(makePostRequest({ name: 'Alice' }));
    await POST(makePostRequest({ name: 'Bob' }));
    await POST(makePostRequest({ name: 'Charlie' }));

    // ACT: 4th player requests waitlist
    const res = await POST(makePostRequest({ name: 'Dave', waitlist: true }));
    const data = await res.json();

    // ASSERT: accepted but waitlisted
    expect(res.status).toBe(201);
    expect(data.waitlisted).toBe(true);
  });

  // TEST 4: Duplicate name — same person trying to sign up twice
  it('rejects duplicate sign-up', async () => {
    // ARRANGE: sign up once
    await POST(makePostRequest({ name: 'Grant' }));

    // ACT: try again with same name
    const res = await POST(makePostRequest({ name: 'Grant' }));
    const data = await res.json();

    // ASSERT
    expect(res.status).toBe(409);
    expect(data.error).toBe('Already signed up');
  });

  // TEST 5: Empty name — basic validation
  it('rejects empty name', async () => {
    const res = await POST(makePostRequest({ name: '' }));
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toBe('Name required');
  });

  // TEST 6: Sign-ups closed
  it('rejects sign-up when sign-ups are closed', async () => {
    // ARRANGE: wipe and recreate session with signupOpen: false
    resetMockStore();
    seedPointer('session-2026-04-05');
    seedSession('session-2026-04-05', { signupOpen: false });

    // ACT
    const res = await POST(makePostRequest({ name: 'Grant' }));
    const data = await res.json();

    // ASSERT
    expect(res.status).toBe(403);
    expect(data.error).toBe('Sign-ups are not open yet');
  });

  // TEST 7: Non-member name rejected when members exist
  it('rejects name not in members list', async () => {
    // ARRANGE: add a member so the members check activates
    const g = global as typeof globalThis & { _mockStore?: Record<string, unknown[]> };
    if (!g._mockStore!['members']) g._mockStore!['members'] = [];
    g._mockStore!['members'].push({ id: 'm1', name: 'Alice', active: true });

    // ACT: try to sign up with a name that's NOT a member
    const res = await POST(makePostRequest({ name: 'Stranger' }));
    const data = await res.json();

    // ASSERT: rejected — not a recognized member
    expect(res.status).toBe(403);
    expect(data.error).toBe('invite_list_not_found');
    expect(data.name).toBe('Stranger');
  });

  // TEST 8: Member name IS accepted
  it('accepts name that matches a member', async () => {
    // ARRANGE: add a member
    const g = global as typeof globalThis & { _mockStore?: Record<string, unknown[]> };
    if (!g._mockStore!['members']) g._mockStore!['members'] = [];
    g._mockStore!['members'].push({ id: 'm1', name: 'Alice', active: true, sessionCount: 5 });

    // ACT: sign up with the member's name
    const res = await POST(makePostRequest({ name: 'Alice' }));
    const data = await res.json();

    // ASSERT: accepted
    expect(res.status).toBe(201);
    expect(data.name).toBe('Alice');
  });
});

describe('PATCH /api/players — pin field', () => {
  const SESSION = 'session-2026-04-05';
  const ORIGINAL_RECOVERY_FLAG = process.env.NEXT_PUBLIC_FLAG_RECOVERY;

  beforeEach(() => {
    resetMockStoreH();
    setupAdminPin();
    seedPointerH(SESSION);
    seedSessionH(SESSION);
    process.env.NEXT_PUBLIC_FLAG_RECOVERY = 'true';
  });

  afterEach(() => {
    if (ORIGINAL_RECOVERY_FLAG === undefined) {
      delete process.env.NEXT_PUBLIC_FLAG_RECOVERY;
    } else {
      process.env.NEXT_PUBLIC_FLAG_RECOVERY = ORIGINAL_RECOVERY_FLAG;
    }
  });

  function findPlayerInStore(id: string) {
    const players = (getStore()['players'] ?? []) as Array<Record<string, unknown>>;
    return players.find((p) => p.id === id);
  }

  it('admin sets a PIN — response strips pinHash but DB stores it', async () => {
    seedPlayer(SESSION, 'Grant', { id: 'p1', deleteToken: 'self-token' });
    const res = await PATCH(makeAdminRequest('PATCH', 'http://localhost/api/players', { id: 'p1', pin: '5839' }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.pinHash).toBeUndefined();
    expect(data.deleteToken).toBeUndefined();
    const stored = findPlayerInStore('p1');
    expect(typeof stored?.pinHash).toBe('string');
    expect((stored?.pinHash as string).length).toBeGreaterThan(0);
  });

  it('player self-sets PIN with valid deleteToken', async () => {
    seedPlayer(SESSION, 'Grant', { id: 'p1', deleteToken: 'self-token' });
    const res = await PATCH(
      makeRequest('PATCH', 'http://localhost/api/players', {
        id: 'p1',
        pin: '5839',
        deleteToken: 'self-token',
      })
    );
    expect(res.status).toBe(200);
    const stored = findPlayerInStore('p1');
    expect(typeof stored?.pinHash).toBe('string');
  });

  it('rejects non-admin without deleteToken (401)', async () => {
    seedPlayer(SESSION, 'Grant', { id: 'p1', deleteToken: 'self-token' });
    const res = await PATCH(
      makeRequest('PATCH', 'http://localhost/api/players', { id: 'p1', pin: '5839' })
    );
    expect(res.status).toBe(401);
  });

  it('rejects blocklisted PIN with pin_too_common', async () => {
    seedPlayer(SESSION, 'Grant', { id: 'p1', deleteToken: 'self-token' });
    const res = await PATCH(
      makeAdminRequest('PATCH', 'http://localhost/api/players', { id: 'p1', pin: '0000' })
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe('pin_too_common');
  });

  it('rejects malformed PIN (5 digits) with 400', async () => {
    seedPlayer(SESSION, 'Grant', { id: 'p1', deleteToken: 'self-token' });
    const res = await PATCH(
      makeAdminRequest('PATCH', 'http://localhost/api/players', { id: 'p1', pin: '12345' })
    );
    expect(res.status).toBe(400);
  });

  it('pin: null clears pinHash from DB', async () => {
    seedPlayer(SESSION, 'Grant', { id: 'p1', deleteToken: 'self-token', pinHash: 'salt:hash' });
    const res = await PATCH(
      makeAdminRequest('PATCH', 'http://localhost/api/players', { id: 'p1', pin: null })
    );
    expect(res.status).toBe(200);
    const stored = findPlayerInStore('p1');
    expect(stored?.pinHash).toBeUndefined();
  });

  it('GET strips pinHash from every player', async () => {
    seedPlayer(SESSION, 'Alice', { id: 'p1', pinHash: 'salt:hash-a' });
    seedPlayer(SESSION, 'Bob', { id: 'p2', pinHash: 'salt:hash-b' });
    const res = await GET(makeGetRequest('http://localhost/api/players'));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
    for (const p of data) {
      expect(p.pinHash).toBeUndefined();
      expect(p.deleteToken).toBeUndefined();
    }
  });
});

describe('POST /api/players — opt-in PIN at sign-up', () => {
  const SESSION = 'session-2026-04-05';
  const ORIGINAL_RECOVERY_FLAG = process.env.NEXT_PUBLIC_FLAG_RECOVERY;

  beforeEach(() => {
    resetMockStoreH();
    setupAdminPin();
    seedPointerH(SESSION);
    seedSessionH(SESSION);
    process.env.NEXT_PUBLIC_FLAG_RECOVERY = 'true';
  });

  afterEach(() => {
    if (ORIGINAL_RECOVERY_FLAG === undefined) {
      delete process.env.NEXT_PUBLIC_FLAG_RECOVERY;
    } else {
      process.env.NEXT_PUBLIC_FLAG_RECOVERY = ORIGINAL_RECOVERY_FLAG;
    }
  });

  function findPlayerByName(name: string) {
    const players = (getStore()['players'] ?? []) as Array<Record<string, unknown>>;
    return players.find((p) => (p.name as string)?.toLowerCase() === name.toLowerCase());
  }

  it('valid PIN at sign-up — 201, response strips pinHash, DB stores it, deleteToken returned', async () => {
    const res = await POST(makeRequest('POST', 'http://localhost/api/players', { name: 'Alice', pin: '5839' }));
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.pinHash).toBeUndefined();
    expect(typeof data.deleteToken).toBe('string');
    expect((data.deleteToken as string).length).toBeGreaterThan(0);
    const stored = findPlayerByName('Alice');
    expect(typeof stored?.pinHash).toBe('string');
    expect((stored?.pinHash as string).length).toBeGreaterThan(0);
  });

  it('blocklisted PIN at sign-up — 400 pin_too_common', async () => {
    const res = await POST(makeRequest('POST', 'http://localhost/api/players', { name: 'Bob', pin: '0000' }));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe('pin_too_common');
  });

  it('sign-up with no pin field — 201, current behavior preserved', async () => {
    const res = await POST(makeRequest('POST', 'http://localhost/api/players', { name: 'Carol' }));
    expect(res.status).toBe(201);
    const stored = findPlayerByName('Carol');
    expect(stored?.pinHash).toBeUndefined();
  });

  it('PIN silently ignored when flag is OFF — 201 succeeds, no pinHash in DB', async () => {
    process.env.NEXT_PUBLIC_FLAG_RECOVERY = 'false';
    try {
      const res = await POST(makeRequest('POST', 'http://localhost/api/players', { name: 'Dan', pin: '5839' }));
      expect(res.status).toBe(201);
      const stored = findPlayerByName('Dan');
      expect(stored?.pinHash).toBeUndefined();
    } finally {
      process.env.NEXT_PUBLIC_FLAG_RECOVERY = 'true';
    }
  });
});
