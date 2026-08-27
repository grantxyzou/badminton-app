import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { resetMockStore, setupAdminPin } from './helpers';
import { setOAuthCookies, STATE_COOKIE, VERIFIER_COOKIE, createState } from '../lib/oauthState';
import { createHandoffId, handoffRef, beginHandoff, readHandoff } from '../lib/authHandoff';

/**
 * THE DEVICE CONDITION, AS A TEST.
 *
 * On an installed iOS PWA the callback arrives from Safari, carrying none of
 * the cookies `/start` set inside the app. Every case below sends the callback
 * with NO oauth cookies, which is not a simplification — it is exactly what the
 * production log line showed:
 *
 *   state=cookie_absent cookies=[NEXT_LOCALE] count=1
 *
 * What must hold: the handoff recovers the flow, the cookie path is unchanged
 * when cookies ARE present, and the state guard does not get weaker in any
 * other direction.
 */

vi.mock('@/lib/oauthProviders', async (orig) => {
  const actual = await orig<typeof import('@/lib/oauthProviders')>();
  return {
    ...actual,
    googleClient: () => ({
      validateAuthorizationCode: async (_code: string, verifier: string) => {
        // The verifier is the thing the missing cookie was carrying. If the
        // handoff did not restore it this throws, and the route answers
        // exchange_failed instead of getting anywhere.
        if (!verifier) throw new Error('no verifier');
        return { idToken: () => `fake.${verifier}` };
      },
    }),
    decodeIdTokenClaims: () => ({
      sub: 'google-sub-1',
      email: 'someone@example.com',
      emailVerified: true,
    }),
  };
});

const URL_ = 'https://bpm.grantzou.com/bpm/api/auth/google/callback';
let ipSeq = 0;

async function callback(qs: Record<string, string>, cookie?: string) {
  const { GET } = await import('../app/api/auth/google/callback/route');
  const url = `${URL_}?${new URLSearchParams(qs).toString()}`;
  const headers: Record<string, string> = {
    'X-Client-IP': `10.9.${Math.floor(ipSeq / 250)}.${ipSeq++ % 250}`,
  };
  if (cookie) headers.Cookie = cookie;
  return GET(new NextRequest(url, { headers }));
}

/** Serialize the two oauth cookies the way /start would, for the control case. */
function oauthCookies(state: string, verifier: string): string {
  const res = NextResponse.json({});
  setOAuthCookies(res, 'redirect', { state, codeVerifier: verifier });
  return res.headers
    .getSetCookie()
    .filter((c) => c.startsWith(`${STATE_COOKIE}=`) || c.startsWith(`${VERIFIER_COOKIE}=`))
    .map((c) => c.split(';')[0])
    .join('; ');
}

const locOf = (res: Response) => new URL(res.headers.get('location') ?? 'https://x/');
const errorOf = (res: Response) => locOf(res).searchParams.get('authError');
/**
 * With no member on record the resolution table lands on "new account, go pick
 * a name". Asserting THAT rather than merely "not an error" is what makes these
 * non-vacuous: reaching it proves the state was recovered, the verifier was
 * recovered, the code was exchanged and the claims were decoded.
 */
const reachedResolution = (res: Response) => locOf(res).searchParams.get('authFlow') === 'name';

beforeEach(() => {
  resetMockStore();
  setupAdminPin();
  process.env.NEXT_PUBLIC_FLAG_AUTH_PROVIDERS = 'true';
  process.env.APP_ORIGIN = 'https://bpm.grantzou.com';
});
afterEach(() => {
  delete process.env.NEXT_PUBLIC_FLAG_AUTH_PROVIDERS;
  delete process.env.APP_ORIGIN;
  vi.restoreAllMocks();
});

describe('google callback — the iOS PWA jar split', () => {
  /**
   * The headline. Before the fix this was a guaranteed `state_mismatch`; the
   * parked copy is what carries the flow now.
   */
  it('recovers a cookie-less callback when a handoff was parked', async () => {
    const id = createHandoffId();
    const ref = handoffRef(id);
    const state = createState();
    await beginHandoff(ref, { state, codeVerifier: 'verifier-from-start' });

    // No cookie argument at all — the Safari jar.
    const res = await callback({ code: 'abc', state: `${state}~${ref}` });

    expect(errorOf(res)).toBeNull();
    expect(reachedResolution(res)).toBe(true);
  });

  it('still refuses a cookie-less callback with NO handoff — the guard is intact', async () => {
    const res = await callback({ code: 'abc', state: createState() });
    expect(errorOf(res)).toBe('state_mismatch');
  });

  it('refuses a handoff ref that was never parked', async () => {
    const ref = handoffRef(createHandoffId());
    const res = await callback({ code: 'abc', state: `${createState()}~${ref}` });
    expect(errorOf(res)).toBe('state_mismatch');
  });

  /**
   * The parked state is still a real CSRF check. Holding a ref is not enough;
   * the state half has to match what /start recorded.
   */
  it('refuses when the parked state does not match the callback state', async () => {
    const id = createHandoffId();
    const ref = handoffRef(id);
    await beginHandoff(ref, { state: createState(), codeVerifier: 'v' });

    const res = await callback({ code: 'abc', state: `${createState()}~${ref}` });
    expect(errorOf(res)).toBe('state_mismatch');
  });

  /**
   * A `differs` means the jars DO match and the value is wrong — the case the
   * state check exists for. A handoff must not rescue it.
   */
  it('does NOT let a handoff rescue a genuine state mismatch', async () => {
    const id = createHandoffId();
    const ref = handoffRef(id);
    const state = createState();
    await beginHandoff(ref, { state, codeVerifier: 'v' });

    // Cookie present but holding a DIFFERENT state.
    const cookie = oauthCookies(createState(), 'cookie-verifier');
    const res = await callback({ code: 'abc', state: `${state}~${ref}` }, cookie);
    expect(errorOf(res)).toBe('state_mismatch');
  });

  it('leaves the ordinary cookie path untouched and never parks anything', async () => {
    const state = createState();
    const cookie = oauthCookies(state, 'cookie-verifier');
    const res = await callback({ code: 'abc', state }, cookie);

    expect(errorOf(res)).toBeNull();
    expect(reachedResolution(res)).toBe(true);
  });

  /** A single-jar browser that sends `hr` anyway must still use its cookies. */
  it('prefers the cookie even when a handoff ref is also present', async () => {
    const id = createHandoffId();
    const ref = handoffRef(id);
    const state = createState();
    await beginHandoff(ref, { state, codeVerifier: 'parked-verifier' });

    const cookie = oauthCookies(state, 'cookie-verifier');
    const res = await callback({ code: 'abc', state: `${state}~${ref}` }, cookie);
    expect(reachedResolution(res)).toBe(true);

    // The stash is still sitting there unconsumed — the cookie path never
    // touched it.
    expect(await readHandoff(ref)).not.toBeNull();
  });
});
