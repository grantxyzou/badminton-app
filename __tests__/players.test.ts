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
  getStore,
  seedAdminMember,
  seedMember,
  memberCookieValue,
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

/**
 * Sign up AS a member. Members-only is permanent: a non-admin caller must be a
 * signed-in active member and the name comes from the cookie's account, so
 * every non-admin sign-up seeds (or reuses) the member and sends their
 * `member_session`. The body's `name` is ignored for this caller.
 */
function makeMemberPostRequest(name: string, body: Record<string, unknown> = {}): NextRequest {
  reqCounter++;
  const store = getStore();
  const existing = ((store['members'] ?? []) as Array<{ id: string; name: string; active?: boolean }>)
    .find((m) => m.name === name && m.active === true);
  const member = existing ?? seedMember(name);
  return new NextRequest('http://localhost:3000/api/players', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Client-IP': `test-${reqCounter}`,
      Cookie: `member_session=${memberCookieValue(name, member.id)}`,
    },
    body: JSON.stringify({ name, ...body }),
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
    setupAdminPin(); // the cookie secret: every sign-up carries a signed cookie now
    seedPointer('session-2026-04-05');
    seedSession('session-2026-04-05', { maxPlayers: 3 });
  });

  // TEST 1: The happy path — does the basic thing work?
  it('signs up a player successfully', async () => {
    // ARRANGE: nothing extra — the beforeEach already set up an open session

    // ACT: make the request as the signed-in member Grant
    const res = await POST(makeMemberPostRequest('Grant'));
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
    await POST(makeMemberPostRequest('Alice'));
    await POST(makeMemberPostRequest('Bob'));
    await POST(makeMemberPostRequest('Charlie'));

    // ACT: 4th player tries to join without requesting waitlist
    const res = await POST(makeMemberPostRequest('Dave'));
    const data = await res.json();

    // ASSERT: rejected with 409
    expect(res.status).toBe(409);
    expect(data.error).toBe('Session is full');
  });

  // TEST 3: Full session, but player asks for waitlist
  it('allows waitlist sign-up when session is full', async () => {
    // ARRANGE: fill the session
    await POST(makeMemberPostRequest('Alice'));
    await POST(makeMemberPostRequest('Bob'));
    await POST(makeMemberPostRequest('Charlie'));

    // ACT: 4th player requests waitlist
    const res = await POST(makeMemberPostRequest('Dave', { waitlist: true }));
    const data = await res.json();

    // ASSERT: accepted but waitlisted
    expect(res.status).toBe(201);
    expect(data.waitlisted).toBe(true);
  });

  // TEST 4: Duplicate name — same person trying to sign up twice
  it('rejects duplicate sign-up', async () => {
    // ARRANGE: sign up once
    await POST(makeMemberPostRequest('Grant'));

    // ACT: try again as the same member
    const res = await POST(makeMemberPostRequest('Grant'));
    const data = await res.json();

    // ASSERT
    expect(res.status).toBe(409);
    expect(data.error).toBe('Already signed up');
  });

  // TEST 5: Empty name — basic validation. A non-admin's name comes from their
  // account, so only an admin (who signs up anyone by name) can send one.
  it('rejects empty name', async () => {
    seedAdminMember();
    const res = await POST(makeAdminRequest('POST', 'http://localhost/api/players', { name: '' }));
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
    const res = await POST(makeMemberPostRequest('Grant'));
    const data = await res.json();

    // ASSERT
    expect(res.status).toBe(403);
    expect(data.error).toBe('Sign-ups are not open yet');
  });

  // TEST 7: A stranger (no account, no cookie) is refused at the gate, before
  // any name lookup — they learn nothing about the members list and nothing
  // is written. (This used to be `invite_list_not_found` for a name-only call.)
  it('rejects a stranger with no account (401), writing nothing', async () => {
    // ARRANGE: add a member so the club has a roster
    const g = global as typeof globalThis & { _mockStore?: Record<string, unknown[]> };
    if (!g._mockStore!['members']) g._mockStore!['members'] = [];
    g._mockStore!['members'].push({ id: 'm1', name: 'Alice', active: true });

    // ACT: try to sign up by name with no cookie
    const res = await POST(makePostRequest({ name: 'Stranger' }));
    const data = await res.json();

    // ASSERT: refused at the gate; no player row
    expect(res.status).toBe(401);
    expect(data.error).toBe('Unauthorized');
    expect(data.name).toBeUndefined();
    expect(g._mockStore!['players'] ?? []).toHaveLength(0);
  });

  // TEST 8: Member is accepted, under their OWN name — a body name is ignored,
  // so a signed-in member cannot put someone else on the list.
  it('accepts a signed-in member under their account name, ignoring the body name', async () => {
    // ARRANGE: add a member
    const g = global as typeof globalThis & { _mockStore?: Record<string, unknown[]> };
    if (!g._mockStore!['members']) g._mockStore!['members'] = [];
    g._mockStore!['members'].push({ id: 'm1', name: 'Alice', active: true, sessionCount: 5 });

    // ACT: sign up as Alice while naming someone else in the body
    const res = await POST(makeMemberPostRequest('Alice', { name: 'Bob' }));
    const data = await res.json();

    // ASSERT: accepted, as Alice
    expect(res.status).toBe(201);
    expect(data.name).toBe('Alice');
    const players = (g._mockStore!['players'] ?? []) as Array<{ name: string }>;
    expect(players.map((p) => p.name)).toEqual(['Alice']);
  });
});

describe('PATCH /api/players — pin field', () => {
  const SESSION = 'session-2026-04-05';
  const ORIGINAL_RECOVERY_FLAG = process.env.NEXT_PUBLIC_FLAG_RECOVERY;

  beforeEach(() => {
    resetMockStoreH();
    setupAdminPin();
    // PATCH now derives its admin flag via the role-rechecking async gate, so
    // the cookie's admin Member must exist for the admin-set-PIN path.
    seedAdminMember();
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

  function findMemberInStore(id: string) {
    const members = (getStore()['members'] ?? []) as Array<Record<string, unknown>>;
    return members.find((m) => m.id === id);
  }

  /**
   * A `deleteToken` is session-scoped: it proves "this device signed this name
   * up for this week", never account ownership. This branch writes
   * `members.pinHash` — what `/api/players/recover` verifies — so accepting
   * the token here was a claim of any PIN-less account, the exact operation
   * `PATCH /api/members/me` refuses.
   */
  it('refuses a PIN set authorized by deleteToken alone', async () => {
    // id pinned to the one `memberCookieValue('Lin')` would carry, so the
    // only reason this 401s is the ABSENT cookie — not an id mismatch.
    const member = seedMember('Lin', { id: 'member-lin' }); // no pinHash
    seedPlayer(SESSION, 'Lin', { id: 'p1', deleteToken: 'self-token', memberId: member.id });
    const res = await PATCH(
      makeRequest('PATCH', 'http://localhost/api/players', {
        id: 'p1',
        pin: '5839',
        deleteToken: 'self-token',
      })
    );
    expect(res.status).toBe(401);
    expect(findPlayerInStore('p1')?.pinHash).toBeUndefined();
    expect(findMemberInStore(member.id)?.pinHash).toBeUndefined();
  });

  it('member sets their own PIN with a member_session cookie', async () => {
    const member = seedMember('Lin', { id: 'member-lin' });
    seedPlayer(SESSION, 'Lin', { id: 'p1', deleteToken: 'self-token', memberId: member.id });
    const res = await PATCH(
      makeRequest(
        'PATCH',
        'http://localhost/api/players',
        { id: 'p1', pin: '5839' },
        { Cookie: `member_session=${memberCookieValue('Lin')}` },
      )
    );
    expect(res.status).toBe(200);
    expect(typeof findPlayerInStore('p1')?.pinHash).toBe('string');
    expect(typeof findMemberInStore('member-lin')?.pinHash).toBe('string');
  });

  it('refuses to change an existing PIN without the current one', async () => {
    const member = seedMember('Lin', { id: 'member-lin', pinHash: 'salt:hash' });
    seedPlayer(SESSION, 'Lin', { id: 'p1', memberId: member.id });
    const res = await PATCH(
      makeRequest(
        'PATCH',
        'http://localhost/api/players',
        { id: 'p1', pin: '5839' },
        { Cookie: `member_session=${memberCookieValue('Lin')}` },
      )
    );
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe('current_pin_required');
    expect(findMemberInStore('member-lin')?.pinHash).toBe('salt:hash');
  });

  /**
   * The whole exploit end to end: an anonymous sign-up for a PIN-less member
   * used to hand back a real `deleteToken`, and that token used to be enough
   * to choose that account's PIN and then sign in as them through `/recover`.
   * Members-only closed the first half (no cookie, no sign-up); the token half
   * still matters, because a `deleteToken` sits in one browser's storage and
   * can leak — it must never be a claim on the account.
   */
  it('an anonymous caller cannot sign up a PIN-less member, and a signup token cannot claim the account', async () => {
    const member = seedMember('Lin', { id: 'member-lin' }); // no pinHash — claimable
    const anon = await POST(
      makeRequest('POST', 'http://localhost/api/players', { name: 'Lin' })
    );
    expect(anon.status).toBe(401);
    expect(getStore()['players'] ?? []).toHaveLength(0);

    // Lin signs up herself; the token she gets back is session-scoped only.
    const signup = await POST(
      makeRequest('POST', 'http://localhost/api/players', {}, {
        Cookie: `member_session=${memberCookieValue('Lin', member.id)}`,
      })
    );
    expect(signup.status).toBe(201);
    const { id, deleteToken } = await signup.json();
    expect(typeof deleteToken).toBe('string');

    // Whoever holds only that token (no cookie) cannot set a PIN with it.
    const res = await PATCH(
      makeRequest('PATCH', 'http://localhost/api/players', { id, pin: '7391', deleteToken })
    );
    expect(res.status).toBe(401);
    expect(findMemberInStore(member.id)?.pinHash).toBeUndefined();
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
    // The roster is members-only: read it as a signed-in (non-admin) member.
    const reader = seedMember('Reader');
    const res = await GET(makeRequest('GET', 'http://localhost/api/players', undefined, {
      Cookie: `member_session=${memberCookieValue('Reader', reader.id)}`,
    }));
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

  /** A signed-in member (no PIN yet) signing up as themselves. */
  function memberPost(name: string, body: Record<string, unknown>) {
    const member = seedMember(name);
    return makeRequest('POST', 'http://localhost/api/players', body, {
      Cookie: `member_session=${memberCookieValue(name, member.id)}`,
    });
  }

  function findPlayerByName(name: string) {
    const players = (getStore()['players'] ?? []) as Array<Record<string, unknown>>;
    return players.find((p) => (p.name as string)?.toLowerCase() === name.toLowerCase());
  }

  it('valid PIN at sign-up — 201, response strips pinHash, DB stores it, deleteToken returned', async () => {
    const res = await POST(memberPost('Alice', { name: 'Alice', pin: '5839' }));
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
    const res = await POST(memberPost('Bob', { name: 'Bob', pin: '0000' }));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe('pin_too_common');
  });

  it('sign-up with no pin field — 201, current behavior preserved', async () => {
    const res = await POST(memberPost('Carol', { name: 'Carol' }));
    expect(res.status).toBe(201);
    const stored = findPlayerByName('Carol');
    expect(stored?.pinHash).toBeUndefined();
  });

  // Note: the "PIN silently ignored when flag is OFF" test was removed when
  // the recovery flag was retired. PIN at signup is now accepted
  // unconditionally; absence is the only path that produces no pinHash.

  it('PIN at signup is now accepted regardless of any env flag (recovery flag retired)', async () => {
    const res = await POST(
      memberPost('Dan', { name: 'Dan', pin: '5839' }),
    );
    expect(res.status).toBe(201);
    const stored = findPlayerByName('Dan');
    expect(stored?.pinHash).toBeDefined();
    expect(typeof stored?.pinHash).toBe('string');
  });
});
