import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { resetMockStore, setupAdminPin, memberCookieValue } from './helpers';
import { GET } from '../app/api/auth/me/route';

/**
 * The endpoint that lets the client discover its own identity after a provider
 * redirect. Its three-state answer is the whole point: `false` means KNOWN
 * signed-out, `null` means UNKNOWN, and conflating them would let a burst of
 * requests log someone out of their own app.
 */
const URL_ = 'http://localhost:3000/bpm/api/auth/me';
let ipSeq = 0;

beforeEach(() => {
  resetMockStore();
  setupAdminPin();
  process.env.NEXT_PUBLIC_FLAG_AUTH_PROVIDERS = 'true';
});
afterEach(() => {
  delete process.env.NEXT_PUBLIC_FLAG_AUTH_PROVIDERS;
});

function req(cookie?: string, url = URL_): NextRequest {
  const headers: Record<string, string> = {
    'X-Client-IP': `10.19.${Math.floor(ipSeq / 250)}.${ipSeq++ % 250}`,
  };
  if (cookie) headers.Cookie = cookie;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new NextRequest(url, { headers } as any);
}

describe('GET /api/auth/me', () => {
  it('returns the name from a valid member cookie', async () => {
    const res = await GET(req(`member_session=${memberCookieValue('Lin', 'member-lin')}`));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ signedIn: true, name: 'Lin' });
  });

  it('answers a KNOWN signed-out for an anonymous caller', async () => {
    expect(await (await GET(req())).json()).toEqual({ signedIn: false, name: null });
  });

  it('treats a forged or expired cookie as signed-out, not as an error', async () => {
    for (const bad of ['member_session=garbage', 'member_session=a.b', 'member_session=']) {
      const body = await (await GET(req(bad))).json();
      expect(body).toEqual({ signedIn: false, name: null });
    }
  });

  it('ignores a ?name= query param — there is nothing to spoof', async () => {
    // Identity comes from the cookie ALONE. A name-keyed variant would report
    // any member's sign-in state to anyone who asked.
    const res = await GET(
      req(`member_session=${memberCookieValue('Lin', 'member-lin')}`, `${URL_}?name=Viktor`),
    );
    expect(await res.json()).toEqual({ signedIn: true, name: 'Lin' });
  });

  it('never leaks a memberId or any member field', async () => {
    const res = await GET(req(`member_session=${memberCookieValue('Lin', 'member-lin')}`));
    const text = JSON.stringify(await res.json());
    for (const forbidden of ['memberId', 'member-lin', 'pinHash', 'passwordHash', 'email']) {
      expect(text).not.toContain(forbidden);
    }
  });

  it('404s when the flag is off', async () => {
    process.env.NEXT_PUBLIC_FLAG_AUTH_PROVIDERS = 'false';
    expect((await GET(req())).status).toBe(404);
  });

  it('answers UNKNOWN, not signed-out, when throttled', async () => {
    // The limit is 30/min per IP; reuse ONE ip to trip it.
    const fixed = '10.20.20.20';
    const mk = (c?: string) => {
      const headers: Record<string, string> = { 'X-Client-IP': fixed };
      if (c) headers.Cookie = c;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return new NextRequest(URL_, { headers } as any);
    };
    const cookie = `member_session=${memberCookieValue('Lin', 'member-lin')}`;
    let throttled: { signedIn: unknown; name: unknown } | null = null;
    for (let i = 0; i < 40; i++) {
      const body = await (await GET(mk(cookie))).json();
      if (body.signedIn === null) {
        throttled = body;
        break;
      }
    }
    expect(throttled, 'expected the limiter to trip within 40 calls').not.toBeNull();
    // The distinction that matters: null, NOT false.
    expect(throttled).toEqual({ signedIn: null, name: null });
  });
});
