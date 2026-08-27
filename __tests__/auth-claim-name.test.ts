import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { resetMockStore, seedMember, setupAdminPin, getStore } from './helpers';
import { POST } from '../app/api/auth/claim-name/route';
import { setPendingSignup, PENDING_COOKIE, type PendingSignup } from '../lib/pendingSignup';
import { lookupIdentity, reserveIdentity } from '../lib/authIdentity';
import { hashPin } from '../lib/recoveryHash';

/**
 * Claiming an existing name with a provider identity.
 *
 * The collision this resolves is the ordinary case, not the edge case: every
 * existing member already has a name, so the FIRST thing any of them sees when
 * signing in with Google is "someone already plays under that name". Telling
 * them to leave, sign in with a PIN, and find Profile is four steps and a dead
 * end; proving it here is one.
 *
 * The security shape is the same as resolution rule 2 (link to an
 * authenticated member) with PIN proof standing in for the session cookie. A
 * name ALONE is never enough — names are enumerable via GET /api/members, and
 * accepting one as proof would hand any account to anyone who could read that
 * list.
 */
const URL_ = 'http://localhost:3000/bpm/api/auth/claim-name';
let ipSeq = 0;

beforeEach(() => {
  resetMockStore();
  setupAdminPin();
  process.env.NEXT_PUBLIC_FLAG_AUTH_PROVIDERS = 'true';
});
afterEach(() => {
  delete process.env.NEXT_PUBLIC_FLAG_AUTH_PROVIDERS;
});

function pendingCookie(over: Partial<PendingSignup> = {}): string {
  const res = NextResponse.json({});
  setPendingSignup(res, {
    provider: 'google',
    sub: 'google-sub-1',
    email: 'grant@example.com',
    emailVerified: true,
    suggestedName: null,
    ...over,
  });
  return res.headers
    .getSetCookie()
    .find((c) => c.startsWith(`${PENDING_COOKIE}=`))!
    .split(';')[0];
}

function req(body: Record<string, unknown>, cookie?: string): NextRequest {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Client-IP': `10.13.${Math.floor(ipSeq / 250)}.${ipSeq++ % 250}`,
  };
  if (cookie) headers.Cookie = cookie;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new NextRequest(URL_, { method: 'POST', headers, body: JSON.stringify(body) } as any);
}

function stored(id: string) {
  return (getStore()['members'] as Array<Record<string, unknown>>).find((m) => m.id === id)!;
}

describe('POST /api/auth/claim-name', () => {
  it('links the provider to the existing member when the PIN is right', async () => {
    const grant = seedMember('Grant', { pinHash: await hashPin('1130') });

    const res = await POST(req({ name: 'Grant', pin: '1130' }, pendingCookie()));
    expect(res.status).toBe(200);

    // Linked to the EXISTING member — no second Grant.
    expect((await lookupIdentity('google', 'google-sub-1'))?.memberId).toBe(grant.id);
    expect((getStore()['members'] as unknown[]).length).toBe(1);
    expect(stored(grant.id).linkedProviders).toEqual(['google']);
    expect(res.headers.getSetCookie().join('\n')).toMatch(/member_session=[^;]+;/);
  });

  it('matches the name case-insensitively, like every other name lookup', async () => {
    const grant = seedMember('Grant', { pinHash: await hashPin('1130') });
    const res = await POST(req({ name: 'grant', pin: '1130' }, pendingCookie()));
    expect(res.status).toBe(200);
    expect((await lookupIdentity('google', 'google-sub-1'))?.memberId).toBe(grant.id);
  });

  it('refuses a wrong PIN and links nothing', async () => {
    seedMember('Grant', { pinHash: await hashPin('1130') });
    const res = await POST(req({ name: 'Grant', pin: '9999' }, pendingCookie()));
    expect(res.status).toBe(401);
    expect(await lookupIdentity('google', 'google-sub-1')).toBeNull();
  });

  it('answers identically for a wrong PIN and a name that does not exist', async () => {
    // Otherwise this endpoint reports which names have accounts AND which of
    // those have PINs — a map of who is easiest to attack.
    seedMember('Grant', { pinHash: await hashPin('1130') });
    const wrong = await POST(req({ name: 'Grant', pin: '9999' }, pendingCookie()));
    const absent = await POST(
      req({ name: 'Nobody At All', pin: '9999' }, pendingCookie({ sub: 'sub-x' })),
    );
    expect(wrong.status).toBe(absent.status);
    expect(await wrong.json()).toEqual(await absent.json());
  });

  it('refuses a member who has no PIN, without revealing that fact', async () => {
    // The invite-list case. They must use an admin-issued code instead.
    seedMember('Carolina');
    const res = await POST(req({ name: 'Carolina', pin: '1130' }, pendingCookie()));
    expect(res.status).toBe(401);
    expect(await lookupIdentity('google', 'google-sub-1')).toBeNull();
  });

  it('accepts an admin-issued recovery code for a member with no PIN', async () => {
    const carolina = seedMember('Carolina', {
      recoveryCode: { hash: await hashPin('123456'), expiresAt: Date.now() + 900_000 },
    });

    const res = await POST(req({ name: 'Carolina', code: '123456' }, pendingCookie()));
    expect(res.status).toBe(200);
    expect((await lookupIdentity('google', 'google-sub-1'))?.memberId).toBe(carolina.id);
    // The code is single-use — consumed, so it cannot be replayed.
    expect(stored(carolina.id).recoveryCode).toBeUndefined();
  });

  it('refuses an expired recovery code', async () => {
    seedMember('Carolina', {
      recoveryCode: { hash: await hashPin('123456'), expiresAt: Date.now() - 1000 },
    });
    const res = await POST(req({ name: 'Carolina', code: '123456' }, pendingCookie()));
    expect(res.status).toBe(401);
  });

  it('rejects a request with no pending provider identity', async () => {
    // Without the signed cookie there is nothing to link, and accepting a
    // name+PIN here would make this a second, unaudited sign-in endpoint.
    seedMember('Grant', { pinHash: await hashPin('1130') });
    const res = await POST(req({ name: 'Grant', pin: '1130' }));
    expect(res.status).toBe(400);
  });

  it('refuses when the provider identity already belongs to someone else', async () => {
    const grant = seedMember('Grant', { pinHash: await hashPin('1130') });
    const other = seedMember('Someone');
    await reserveIdentity('google', 'google-sub-1', other.id);

    const res = await POST(req({ name: 'Grant', pin: '1130' }, pendingCookie()));
    expect(res.status).toBe(409);
    expect((await lookupIdentity('google', 'google-sub-1'))?.memberId).toBe(other.id);
    expect(stored(grant.id).linkedProviders).toBeUndefined();
  });

  it('does not steal an email already reserved by another member', async () => {
    const grant = seedMember('Grant', { pinHash: await hashPin('1130') });
    const other = seedMember('Someone');
    await reserveIdentity('email', 'grant@example.com', other.id);

    // The link still succeeds — the provider identity is what matters. The
    // address simply stays with whoever holds it.
    const res = await POST(req({ name: 'Grant', pin: '1130' }, pendingCookie()));
    expect(res.status).toBe(200);
    expect((await lookupIdentity('email', 'grant@example.com'))?.memberId).toBe(other.id);
    expect(stored(grant.id).email).toBeUndefined();
  });

  it('claims the verified email when nobody else holds it', async () => {
    const grant = seedMember('Grant', { pinHash: await hashPin('1130') });
    await POST(req({ name: 'Grant', pin: '1130' }, pendingCookie()));
    expect((await lookupIdentity('email', 'grant@example.com'))?.memberId).toBe(grant.id);
    expect(stored(grant.id).emailVerified).toBe(true);
  });

  it('does NOT claim an unverified provider email', async () => {
    const grant = seedMember('Grant', { pinHash: await hashPin('1130') });
    await POST(req({ name: 'Grant', pin: '1130' }, pendingCookie({ emailVerified: false })));
    expect(await lookupIdentity('email', 'grant@example.com')).toBeNull();
    expect(stored(grant.id).email).toBeUndefined();
  });

  it('gives an admin their admin cookie back', async () => {
    const grant = seedMember('Grant', { role: 'admin', pinHash: await hashPin('1130') });
    const res = await POST(req({ name: 'Grant', pin: '1130' }, pendingCookie()));
    expect(res.headers.getSetCookie().join('\n')).toMatch(/admin_session=[^;]+;/);
    expect(stored(grant.id).role).toBe('admin');
  });

  it('404s when the flag is off', async () => {
    process.env.NEXT_PUBLIC_FLAG_AUTH_PROVIDERS = 'false';
    const res = await POST(req({ name: 'Grant', pin: '1130' }, pendingCookie()));
    expect(res.status).toBe(404);
  });
});
