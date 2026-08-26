import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { resetMockStore, setupAdminPin } from './helpers';
import { POST, readOneShotName } from '../app/api/auth/apple/callback/route';
import { setOAuthCookies, STATE_COOKIE, createState } from '../lib/oauthState';
import { readPendingSignup, setPendingSignup, PENDING_COOKIE } from '../lib/pendingSignup';

const URL_ = 'http://localhost:3000/bpm/api/auth/apple/callback';
let ipSeq = 0;

beforeEach(() => {
  resetMockStore();
  setupAdminPin();
  process.env.NEXT_PUBLIC_FLAG_AUTH_PROVIDERS = 'true';
});
afterEach(() => {
  delete process.env.NEXT_PUBLIC_FLAG_AUTH_PROVIDERS;
});

function stateCookie(value: string): string {
  const res = NextResponse.json({});
  setOAuthCookies(res, 'form_post', { state: value });
  const header = res.headers.getSetCookie().find((c) => c.startsWith(`${STATE_COOKIE}=`))!;
  return header.split(';')[0];
}

function formPost(fields: Record<string, string>, cookie?: string): NextRequest {
  const body = new URLSearchParams(fields).toString();
  const headers: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded',
    'X-Client-IP': `10.5.${Math.floor(ipSeq / 250)}.${ipSeq++ % 250}`,
  };
  if (cookie) headers.Cookie = cookie;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new NextRequest(URL_, { method: 'POST', headers, body } as any);
}

describe('POST /api/auth/apple/callback', () => {
  it("writes the state cookie as SameSite=None; Secure, or the flow can't work", () => {
    // Apple POSTs the callback cross-site, which strips even Lax. This is the
    // single most likely silent failure in the whole Apple path, and it is also
    // why the flow cannot run over http://localhost.
    const header = stateCookie('abc');
    const res = NextResponse.json({});
    setOAuthCookies(res, 'form_post', { state: 'abc' });
    const full = res.headers.getSetCookie().find((c) => c.startsWith(STATE_COOKIE))!;
    expect(header).toContain('abc');
    expect(full).toMatch(/SameSite=none/i);
    expect(full).toMatch(/Secure/);
  });

  it('rejects a callback whose state does not match the cookie', async () => {
    const res = await POST(
      formPost({ code: 'x', state: createState() }, stateCookie(createState())),
    );
    expect(res.headers.get('location')).toContain('authError=state_mismatch');
  });

  it('rejects a callback with no state cookie at all', async () => {
    // What a stripped cross-site cookie actually looks like in production.
    const res = await POST(formPost({ code: 'x', state: createState() }));
    expect(res.headers.get('location')).toContain('authError=state_mismatch');
  });

  it('treats a user-cancelled authorization as a quiet return, not a failure', async () => {
    const res = await POST(formPost({ error: 'user_cancelled_authorize' }));
    expect(res.headers.get('location')).toContain('authError=cancelled');
  });

  it('reports an unconfigured provider distinctly', async () => {
    const saved = process.env.APPLE_CLIENT_ID;
    delete process.env.APPLE_CLIENT_ID;
    const s = createState();
    const res = await POST(formPost({ code: 'x', state: s }, stateCookie(s)));
    expect(res.headers.get('location')).toContain('authError=provider_not_configured');
    if (saved !== undefined) process.env.APPLE_CLIENT_ID = saved;
  });

  it('404s when the flag is off', async () => {
    process.env.NEXT_PUBLIC_FLAG_AUTH_PROVIDERS = 'false';
    const res = await POST(formPost({ code: 'x', state: 'y' }));
    expect(res.status).toBe(404);
  });
});

describe("Apple's one-shot name", () => {
  it('parses the first+last name Apple sends on the first authorization only', () => {
    expect(
      readOneShotName(JSON.stringify({ name: { firstName: 'Carolina', lastName: 'Marin' } })),
    ).toBe('Carolina Marin');
  });

  it('copes with a partial or missing name rather than throwing', () => {
    expect(readOneShotName(JSON.stringify({ name: { firstName: 'Lin' } }))).toBe('Lin');
    expect(readOneShotName(JSON.stringify({ name: {} }))).toBeNull();
    expect(readOneShotName(JSON.stringify({}))).toBeNull();
    expect(readOneShotName('not json at all')).toBeNull();
    // The common case on EVERY sign-in after the first: Apple sends no user
    // field, and that must be a quiet null rather than an error.
    expect(readOneShotName(null)).toBeNull();
  });

  it('survives the round trip into the pending cookie', () => {
    // If the name is not carried here it is gone permanently -- the user can
    // only get another chance by removing the app from their Apple ID.
    const res = NextResponse.json({});
    setPendingSignup(res, {
      provider: 'apple',
      sub: 'apple-sub-1',
      email: 'relay@privaterelay.appleid.com',
      emailVerified: true,
      suggestedName: 'Carolina Marin',
    });
    const cookie = res.headers
      .getSetCookie()
      .find((c) => c.startsWith(PENDING_COOKIE))!
      .split(';')[0];

    const req = new NextRequest(URL_, {
      headers: { Cookie: cookie },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    expect(readPendingSignup(req)?.suggestedName).toBe('Carolina Marin');
  });
});
