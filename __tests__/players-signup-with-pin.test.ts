import { describe, it, expect, beforeEach } from 'vitest';
import {
  resetMockStore,
  setupAdminPin,
  seedPointer,
  seedSession,
  seedMember,
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
 * members with `pin_required` regardless of body content. The unified
 * Home form sent `pin` in the body after /recover succeeded but the
 * route ignored it. These tests lock in the post-fix behavior:
 *  - valid PIN in body → register the player (201)
 *  - wrong PIN in body → 401 pin_incorrect
 *  - no PIN in body → 401 pin_required (existing, unchanged)
 */
describe('POST /api/players with PIN (v1.4 unified Home sign-in fix)', () => {
  const sessionId = 'session-2026-05-20';
  const pin = '2468';

  beforeEach(async () => {
    resetMockStore();
    seedPointer(sessionId);
    seedSession(sessionId, { maxPlayers: 12, signupOpen: true });
    const pinHash = await hashPin(pin);
    seedMember('Lin', { pinHash });
  });

  it('valid PIN in body registers the player (201)', async () => {
    const req = makeRequest('POST', 'http://localhost:3000/api/players', {
      name: 'Lin',
      pin,
    }, { 'X-Client-IP': '10.0.0.1' });

    const res = await POST(req);
    expect(res.status).toBe(201);

    const body = await res.json();
    expect(body.name).toBe('Lin');
    expect(body.sessionId).toBe(sessionId);
    expect(body.deleteToken).toEqual(expect.any(String));
    // Strip canary: server must not leak the auth credentials back.
    expect(body.pinHash).toBeUndefined();
  });

  it('wrong PIN in body returns 401 pin_incorrect', async () => {
    const req = makeRequest('POST', 'http://localhost:3000/api/players', {
      name: 'Lin',
      pin: '9999',
    }, { 'X-Client-IP': '10.0.0.2' });

    const res = await POST(req);
    expect(res.status).toBe(401);

    const body = await res.json();
    expect(body.error).toBe('pin_incorrect');
  });

  it('missing PIN on a PIN-protected member returns 401 pin_required', async () => {
    const req = makeRequest('POST', 'http://localhost:3000/api/players', {
      name: 'Lin',
    }, { 'X-Client-IP': '10.0.0.3' });

    const res = await POST(req);
    expect(res.status).toBe(401);

    const body = await res.json();
    expect(body.error).toBe('pin_required');
  });

  it('valid PIN does not change the member.pinHash on success (no re-mirror)', async () => {
    // The fix sets pinHash = undefined after verification so the player
    // record + member upsert don't accidentally re-hash the same PIN
    // with a new salt. Verify the stored pinHash is unchanged by reading
    // the mock store directly.
    const { getStore } = await import('./helpers');
    const storedBefore = (getStore().members?.find((m: { name?: string }) => m.name === 'Lin') as { pinHash?: string })?.pinHash;
    expect(storedBefore).toBeTruthy();

    const req = makeRequest('POST', 'http://localhost:3000/api/players', {
      name: 'Lin',
      pin,
    }, { 'X-Client-IP': '10.0.0.4' });
    const res = await POST(req);
    expect(res.status).toBe(201);

    const storedAfter = (getStore().members?.find((m: { name?: string }) => m.name === 'Lin') as { pinHash?: string })?.pinHash;
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

  it('member_session cookie for a DIFFERENT name still requires the PIN', async () => {
    const cookie = memberCookie('someone-else', 'Viktor');
    const req = makeRequest('POST', 'http://localhost:3000/api/players',
      { name: 'Lin' },
      { 'X-Client-IP': '10.1.0.2', Cookie: `member_session=${cookie}` });
    const res = await POST(req);
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe('pin_required');
  });

  it('no cookie + no PIN still returns pin_required (guard intact)', async () => {
    const req = makeRequest('POST', 'http://localhost:3000/api/players',
      { name: 'Lin' }, { 'X-Client-IP': '10.1.0.3' });
    const res = await POST(req);
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe('pin_required');
  });

  it('signing up with the correct PIN mints a member_session cookie for next time', async () => {
    const req = makeRequest('POST', 'http://localhost:3000/api/players',
      { name: 'Lin', pin }, { 'X-Client-IP': '10.1.0.4' });
    const res = await POST(req);
    expect(res.status).toBe(201);
    expect(res.cookies.get('member_session')?.value).toBeTruthy();
  });
});
