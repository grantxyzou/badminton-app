import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { resetMockStore, seedMember, getStore } from './helpers';
import { POST } from '../app/api/auth/complete-signup/route';
import { setPendingSignup, PENDING_COOKIE, type PendingSignup } from '../lib/pendingSignup';
import { lookupIdentity, reserveIdentity } from '../lib/authIdentity';

const URL_ = 'http://localhost:3000/bpm/api/auth/complete-signup';
let ipSeq = 0;

beforeEach(() => {
  resetMockStore();
  process.env.NEXT_PUBLIC_FLAG_AUTH_PROVIDERS = 'true';
});
afterEach(() => {
  delete process.env.NEXT_PUBLIC_FLAG_AUTH_PROVIDERS;
});

/** Mint a real signed pending cookie by round-tripping through the setter. */
function pendingCookie(over: Partial<PendingSignup> = {}): string {
  const res = NextResponse.json({});
  setPendingSignup(res, {
    provider: 'google',
    sub: 'google-sub-1',
    email: 'carolina@example.com',
    emailVerified: true,
    suggestedName: null,
    ...over,
  });
  const header = res.headers.getSetCookie().find((c) => c.startsWith(`${PENDING_COOKIE}=`))!;
  return header.split(';')[0];
}

function req(body: Record<string, unknown>, cookie?: string): NextRequest {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Client-IP': `10.9.${Math.floor(ipSeq / 250)}.${ipSeq++ % 250}`,
  };
  if (cookie) headers.Cookie = cookie;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new NextRequest(URL_, { method: 'POST', headers, body: JSON.stringify(body) } as any);
}

function members() {
  return (getStore()['members'] ?? []) as Array<{ id: string; name: string; email?: string }>;
}

describe('POST /api/auth/complete-signup', () => {
  it('creates the member, links the provider, and claims the verified email', async () => {
    const res = await POST(req({ name: 'Carolina' }, pendingCookie()));
    expect(res.status).toBe(201);

    expect(members()).toHaveLength(1);
    const m = members()[0];
    expect(m.name).toBe('Carolina');
    expect(m.email).toBe('carolina@example.com');

    expect((await lookupIdentity('google', 'google-sub-1'))?.memberId).toBe(m.id);
    expect((await lookupIdentity('email', 'carolina@example.com'))?.memberId).toBe(m.id);
    expect(res.headers.getSetCookie().join('\n')).toMatch(/member_session=[^;]+;/);
  });

  it('refuses a name that already belongs to someone, and reserves nothing', async () => {
    seedMember('Lin');
    const res = await POST(req({ name: 'lin' }, pendingCookie({ sub: 'google-sub-2' })));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('name_taken');
    expect(await lookupIdentity('google', 'google-sub-2')).toBeNull();
  });

  it('does NOT claim an unverified provider email', async () => {
    // Otherwise a provider account carrying an arbitrary unconfirmed address
    // could squat the real owner's future signup.
    const res = await POST(
      req({ name: 'Kento' }, pendingCookie({ emailVerified: false, sub: 'google-sub-3' })),
    );
    expect(res.status).toBe(201);
    expect(members()[0].email).toBeUndefined();
    expect(await lookupIdentity('email', 'carolina@example.com')).toBeNull();
  });

  it('releases the provider reservation when the email is already taken', async () => {
    const other = seedMember('Someone');
    await reserveIdentity('email', 'carolina@example.com', other.id);

    const res = await POST(req({ name: 'Akane' }, pendingCookie({ sub: 'google-sub-4' })));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('email_taken');
    // The provider key must not stay reserved for a member that was never made.
    expect(await lookupIdentity('google', 'google-sub-4')).toBeNull();
  });

  it('refuses a provider identity that is already linked elsewhere', async () => {
    const other = seedMember('Someone');
    await reserveIdentity('google', 'google-sub-5', other.id);
    const res = await POST(req({ name: 'Viktor' }, pendingCookie({ sub: 'google-sub-5' })));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('already_linked');
  });

  it('rejects a request with no pending cookie', async () => {
    const res = await POST(req({ name: 'Nobody' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('no_pending_signup');
  });

  it('rejects a FORGED pending cookie', async () => {
    // The signature is what stops the client writing its own provider facts.
    // HttpOnly only stops scripts READING the cookie.
    const forged = `${PENDING_COOKIE}=${Buffer.from(
      JSON.stringify({ v: { provider: 'google', sub: 'attacker' }, exp: 9999999999 }),
    ).toString('base64url')}.deadbeef`;
    const res = await POST(req({ name: 'Attacker' }, forged));
    expect(res.status).toBe(400);
    expect(members()).toHaveLength(0);
  });

  it('never takes the provider identity from the request body', async () => {
    // Body carries the NAME and nothing else. A sub in the body must be ignored
    // in favour of the signed cookie's.
    const res = await POST(
      req({ name: 'Sindhu', sub: 'attacker-sub', email: 'victim@example.com' }, pendingCookie()),
    );
    expect(res.status).toBe(201);
    expect(await lookupIdentity('google', 'attacker-sub')).toBeNull();
    expect((await lookupIdentity('google', 'google-sub-1'))).not.toBeNull();
  });

  it('404s when the flag is off', async () => {
    process.env.NEXT_PUBLIC_FLAG_AUTH_PROVIDERS = 'false';
    const res = await POST(req({ name: 'Carolina' }, pendingCookie()));
    expect(res.status).toBe(404);
  });
});
