import { describe, it, expect, beforeEach } from 'vitest';
import {
  resetMockStore,
  getStore,
  setupAdminPin,
  seedTestAdminMember,
  seedPointer,
  seedSession,
  seedMember,
  seedPlayer,
  makeRequest,
} from './helpers';
import { POST } from '@/app/api/players/route';
import { hashPin } from '@/lib/recoveryHash';
import { setMemberCookie } from '@/lib/auth';
import { NextResponse } from 'next/server';

/** Mint a valid signed member_session cookie value (the "trusted device" proof). */
function memberCookie(memberId: string, name: string): string {
  const res = NextResponse.json({});
  setMemberCookie(res, memberId, name);
  return res.cookies.get('member_session')!.value;
}

setupAdminPin();

/**
 * Regression tests for the unified Home sign-in flow.
 *
 * Before commit fa7544a, `POST /api/players` always rejected PIN'd
 * members with `pin_required` regardless of body content. Members-only is now
 * permanent (2026-10-17): a non-admin must hold a `member_session`, and the
 * name comes from it, so the name + PIN "sign-in" mode with no cookie is gone —
 * a correct PIN without an account cookie is refused at the gate. What
 * survives: a signed-in member's sign-up never leaks or re-mirrors their PIN.
 */
describe('POST /api/players with PIN (v1.4 unified Home sign-in fix)', () => {
  const sessionId = 'session-2026-05-20';
  const pin = '2468';
  let lin: { id: string };

  beforeEach(async () => {
    resetMockStore();
    seedPointer(sessionId);
    seedSession(sessionId, { maxPlayers: 12, signupOpen: true });
    const pinHash = await hashPin(pin);
    lin = seedMember('Lin', { pinHash }) as { id: string };
  });

  it('a signed-in PIN member registers (201) and the response strips pinHash', async () => {
    const req = makeRequest('POST', 'http://localhost:3000/api/players', {
      name: 'Lin',
      pin,
    }, { 'X-Client-IP': '10.0.0.1', Cookie: `member_session=${memberCookie(lin.id, 'Lin')}` });

    const res = await POST(req);
    expect(res.status).toBe(201);

    const body = await res.json();
    expect(body.name).toBe('Lin');
    expect(body.sessionId).toBe(sessionId);
    expect(body.deleteToken).toEqual(expect.any(String));
    // Strip canary: server must not leak the auth credentials back.
    expect(body.pinHash).toBeUndefined();
  });

  it('name + PIN with no member cookie is refused at the gate (401), right PIN or wrong, and counts nothing', async () => {
    for (const [i, candidate] of [pin, '9999', undefined].entries()) {
      const req = makeRequest('POST', 'http://localhost:3000/api/players', {
        name: 'Lin',
        ...(candidate ? { pin: candidate } : {}),
      }, { 'X-Client-IP': `10.0.0.${2 + i}` });

      const res = await POST(req);
      expect(res.status).toBe(401);
      // One answer for every case: the gate says nothing about the account.
      expect((await res.json()).error).toBe('Unauthorized');
    }
    expect(getStore()['players'] ?? []).toHaveLength(0);
    // The PIN was never checked, so no guess counted toward the account lock.
    const stored = (getStore().members as Array<{ id: string; pinLock?: unknown }>).find((m) => m.id === lin.id);
    expect(stored?.pinLock).toBeUndefined();
  });

  it('a PIN sent with a signed-in sign-up does not change the member.pinHash (no re-mirror)', async () => {
    // A sign-up is not a PIN change: the stored hash must not be re-hashed
    // with a new salt. Read the mock store directly.
    const storedBefore = ((getStore().members as { name?: string; pinHash?: string }[] | undefined)?.find((m) => m.name === 'Lin') as { pinHash?: string })?.pinHash;
    expect(storedBefore).toBeTruthy();

    const req = makeRequest('POST', 'http://localhost:3000/api/players', {
      name: 'Lin',
      pin,
    }, { 'X-Client-IP': '10.0.0.5', Cookie: `member_session=${memberCookie(lin.id, 'Lin')}` });
    const res = await POST(req);
    expect(res.status).toBe(201);

    const storedAfter = ((getStore().members as { name?: string; pinHash?: string }[] | undefined)?.find((m) => m.name === 'Lin') as { pinHash?: string })?.pinHash;
    expect(storedAfter).toBe(storedBefore);
  });
});

/**
 * Trusted-device sign-up: once a member has proven their PIN on a device, a
 * signed `member_session` cookie lets them sign up for future sessions without
 * re-entering the PIN. The cookie is name/id bound, so it can't be used to sign
 * up as a different member.
 */
describe('POST /api/players with trusted-device cookie (member_session)', () => {
  const sessionId = 'session-2026-05-20';
  const pin = '2468';
  let lin: { id: string };

  beforeEach(async () => {
    resetMockStore();
    seedPointer(sessionId);
    seedSession(sessionId, { maxPlayers: 12, signupOpen: true });
    const pinHash = await hashPin(pin);
    lin = seedMember('Lin', { pinHash }) as { id: string };
  });

  it('valid member_session cookie signs up a PIN member WITHOUT a PIN (201)', async () => {
    const cookie = memberCookie(lin.id, 'Lin');
    const req = makeRequest('POST', 'http://localhost:3000/api/players',
      { name: 'Lin' },
      { 'X-Client-IP': '10.1.0.1', Cookie: `member_session=${cookie}` });
    const res = await POST(req);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.name).toBe('Lin');
    expect(body.pinHash).toBeUndefined();
  });

  it('a member_session cookie for a DIFFERENT member signs up that member, never the named one', async () => {
    const viktor = seedMember('Viktor') as { id: string };
    const cookie = memberCookie(viktor.id, 'Viktor');
    const req = makeRequest('POST', 'http://localhost:3000/api/players',
      { name: 'Lin' },
      { 'X-Client-IP': '10.1.0.2', Cookie: `member_session=${cookie}` });
    const res = await POST(req);
    expect(res.status).toBe(201);
    expect((await res.json()).name).toBe('Viktor');
    const players = (getStore()['players'] ?? []) as Array<{ name: string }>;
    expect(players.map((p) => p.name)).toEqual(['Viktor']);
  });

  it('a cookie naming a member who does not exist is refused (401)', async () => {
    const cookie = memberCookie('someone-else', 'Lin');
    const req = makeRequest('POST', 'http://localhost:3000/api/players',
      { name: 'Lin' },
      { 'X-Client-IP': '10.1.0.5', Cookie: `member_session=${cookie}` });
    const res = await POST(req);
    expect(res.status).toBe(401);
    expect(getStore()['players'] ?? []).toHaveLength(0);
  });

  it('no cookie + no PIN is refused at the gate (401), writing nothing', async () => {
    const req = makeRequest('POST', 'http://localhost:3000/api/players',
      { name: 'Lin' }, { 'X-Client-IP': '10.1.0.3' });
    const res = await POST(req);
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe('Unauthorized');
    expect(getStore()['players'] ?? []).toHaveLength(0);
  });
});

/**
 * Waitlist sign-up enforces the same PIN guard as a normal sign-up. The Home
 * waitlist form now reveals the PIN field adaptively and sends `pin` alongside
 * `waitlist: true` — these tests lock in the server contract that form satisfies.
 * Regression for the "PIN required but no PIN input" waitlist bug.
 */
describe('POST /api/players waitlist with PIN', () => {
  const sessionId = 'session-2026-05-20';
  const pin = '2468';

  beforeEach(async () => {
    resetMockStore();
    seedPointer(sessionId);
    // Capacity of 2, both spots taken → the session is full so any further
    // sign-up must go through the waitlist branch.
    seedSession(sessionId, { maxPlayers: 2, signupOpen: true });
    seedPlayer(sessionId, 'Viktor');
    seedPlayer(sessionId, 'Carolina');
    const pinHash = await hashPin(pin);
    seedMember('Lin', { pinHash });
  });

  it('a signed-in PIN member + waitlist:true is waitlisted (201)', async () => {
    const lin = (getStore().members as Array<{ id: string; name: string }>).find((m) => m.name === 'Lin')!;
    const req = makeRequest('POST', 'http://localhost:3000/api/players', {
      name: 'Lin',
      waitlist: true,
    }, { 'X-Client-IP': '10.2.0.1', Cookie: `member_session=${memberCookie(lin.id, 'Lin')}` });

    const res = await POST(req);
    expect(res.status).toBe(201);

    const body = await res.json();
    expect(body.name).toBe('Lin');
    expect(body.waitlisted).toBe(true);
    expect(body.pinHash).toBeUndefined();
  });

  it('no cookie + waitlist:true is refused (401) before the waitlist branch, right PIN or not', async () => {
    const req = makeRequest('POST', 'http://localhost:3000/api/players', {
      name: 'Lin',
      pin,
      waitlist: true,
    }, { 'X-Client-IP': '10.2.0.2' });

    const res = await POST(req);
    expect(res.status).toBe(401);
    const players = (getStore()['players'] ?? []) as Array<{ name: string }>;
    expect(players.some((p) => p.name === 'Lin')).toBe(false);
  });
});

/**
 * Claiming an account by name alone.
 *
 * The PIN gate above only fires for a member that ALREADY has a `pinHash`. One
 * with none used to fall straight through, so anyone could type a name they did
 * not own, pick a PIN, and be signed in as that person from any device — the
 * exact operation `PATCH /api/members/me` refuses, and for the reason its own
 * comment gives: names are enumerable through `GET /api/members`.
 */
describe('a PIN-less member cannot be claimed by anyone who knows the name', () => {
  it('refuses a first-PIN set from a device with no proof', async () => {
    resetMockStore();
    seedPointer('session-2026-06-08');
    seedSession('session-2026-06-08');
    const member = seedMember('Lin'); // no pinHash

    const res = await POST(
      makeRequest('POST', 'http://x/api/players', { name: 'Lin', pin: '2468' }),
    );
    // Refused at the members-only gate now (it used to reach
    // `account_claim_needs_approval`); the threat and the outcome are the same.
    expect(res.status).toBe(401);

    // And nothing was written: no PIN, no session record.
    const stored = (getStore()['members'] as { id: string; pinHash?: string }[])
      .find((m) => m.id === member.id)!;
    expect(stored.pinHash ?? '').toBe('');
    expect(getStore()['players'] ?? []).toHaveLength(0);
  });

  it('allows it from the member’s own device', async () => {
    // The legitimate case: same person, cookie already minted at sign-up.
    resetMockStore();
    seedPointer('session-2026-06-08');
    seedSession('session-2026-06-08');
    const member = seedMember('Lin');

    const res = await POST(
      makeRequest('POST', 'http://x/api/players', { name: 'Lin', pin: '2468' }, {
        Cookie: `member_session=${memberCookie(member.id, 'Lin')}`,
      }),
    );
    expect(res.status).toBe(201);
  });

  /**
   * Signing up is not changing your PIN.
   *
   * The clear that drops a body `pin` after using it to authenticate lives
   * INSIDE the verification block, and that block is skipped for a caller who
   * is already trusted — a valid `member_session`, or an admin. So the hash
   * built from the body fell through to the member upsert and replaced
   * `members.pinHash` with nothing having verified the PIN being replaced.
   *
   * Holding a borrowed cookie was then enough to mint a durable credential:
   * the chosen PIN works at `/recover`, at `/api/admin` and at every other PIN
   * gate, outlives the cookie, and silently stops the owner's own PIN working.
   */
  it('does NOT rewrite an existing account PIN on a cookie-trusted sign-up', async () => {
    resetMockStore();
    seedPointer('session-2026-06-09');
    seedSession('session-2026-06-09');
    const original = await hashPin('2468');
    const member = seedMember('Lin', { pinHash: original });

    const res = await POST(
      makeRequest('POST', 'http://x/api/players', { name: 'Lin', pin: '9999' }, {
        Cookie: `member_session=${memberCookie(member.id, 'Lin')}`,
      }),
    );
    expect(res.status).toBe(201);

    const stored = (getStore()['members'] as Array<{ id: string; pinHash?: string }>).find((m) => m.id === member.id);
    expect(stored?.pinHash).toBe(original);
  });

  it('does NOT rewrite an existing account PIN on an ADMIN sign-up either', async () => {
    resetMockStore();
    seedPointer('session-2026-06-10');
    seedSession('session-2026-06-10');
    const original = await hashPin('2468');
    const member = seedMember('Viktor', { pinHash: original });

    // Admin mutations on this route re-read the Member doc (role + active).
    await seedTestAdminMember();
    const { makeAdminRequest } = await import('./helpers');
    const res = await POST(
      makeAdminRequest('POST', 'http://x/api/players', { name: 'Viktor', pin: '9999' }),
    );
    expect(res.status).toBe(201);

    const stored = (getStore()['members'] as Array<{ id: string; pinHash?: string }>).find((m) => m.id === member.id);
    expect(stored?.pinHash).toBe(original);
  });

  it('a brand-new name with no account is refused (401) and no account is minted', async () => {
    // Members-only: someone nobody has heard of is not claiming anything, but
    // they have no account either, so they cannot sign up (they need an invite).
    resetMockStore();
    seedPointer('session-2026-06-08');
    seedSession('session-2026-06-08');

    const res = await POST(
      makeRequest('POST', 'http://x/api/players', { name: 'Brand New Person', pin: '1357' }),
    );
    expect(res.status).toBe(401);
    expect(getStore()['members'] ?? []).toHaveLength(0);
    expect(getStore()['players'] ?? []).toHaveLength(0);
  });
});
