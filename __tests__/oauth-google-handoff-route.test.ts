import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { resetMockStore, setupAdminPin, seedMember, memberCookieValue, getStore } from './helpers';
import { setOAuthCookies, STATE_COOKIE, VERIFIER_COOKIE, createState } from '../lib/oauthState';
import { createHandoffId, handoffRef, beginHandoff, readHandoff, claimHandoff } from '../lib/authHandoff';
import { reserveIdentity, lookupIdentity } from '../lib/authIdentity';
import { PENDING_COOKIE, readPendingSignup } from '../lib/pendingSignup';

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
const CALLBACK_URL = URL_;
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
/** The app finishes it: the browser lands on the hand-off page, with the code in the fragment. */
const handedToApp = (res: Response) => locOf(res).pathname === '/bpm/auth/done';
const fragmentOf = (res: Response) => new URLSearchParams(locOf(res).hash.replace(/^#/, ''));

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
    // A new identity: parked for the app to name, which proves the state and
    // verifier were recovered and the code exchanged.
    expect(handedToApp(res)).toBe(true);
    expect((await readHandoff(ref))?.pending?.sub).toBe('google-sub-1');
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

/**
 * SECURITY SCAN F3 / F4 — through the real google callback.
 *
 * The handoff ref is chosen by whoever calls `/start`, so it proves who STARTED
 * a sign-in, never who finished it. These pin the three rules that follow from
 * that (lib/authHandoff.ts): no parking on the cookie path unless the native
 * shell started it; a parked-state callback is non-authenticating; a native
 * park needs a return code.
 */
describe('google callback — the handoff cannot be turned against the person who finishes it', () => {
  const sessionCookie = (res: Response) =>
    res.headers.getSetCookie().find((c) => /^member_session=[^;]+;/.test(c));

  it('F4: a single-jar browser that carries someone else\'s ref parks NOTHING claimable', async () => {
    const victim = seedMember('Carolina');
    await reserveIdentity('google', 'google-sub-1', victim.id);
    // The attacker minted this pair and sent the victim `/start?hr=<ref>`.
    const attackerId = createHandoffId();
    const ref = handoffRef(attackerId);
    const state = createState();
    await beginHandoff(ref, { state, codeVerifier: 'v' });

    const res = await callback({ code: 'abc', state: `${state}~${ref}` }, oauthCookies(state, 'cookie-verifier'));

    // The victim is signed in, in their own browser, as themselves...
    expect(locOf(res).searchParams.get('signedIn')).toBe('1');
    expect(sessionCookie(res)).toBeTruthy();
    // ...and the attacker's preimage redeems nothing.
    expect((await readHandoff(ref))?.memberId).toBeUndefined();
    expect((await claimHandoff(attackerId)).status).not.toBe('ready');
  });

  it('F4, name step: the cookie path does not carry the ref into complete-signup', async () => {
    const ref = handoffRef(createHandoffId());
    const state = createState();
    await beginHandoff(ref, { state, codeVerifier: 'v' });

    const res = await callback({ code: 'abc', state: `${state}~${ref}` }, oauthCookies(state, 'cookie-verifier'));
    expect(reachedResolution(res)).toBe(true);
    const pending = res.headers.getSetCookie().find((c) => c.startsWith(`${PENDING_COOKIE}=`))!;
    const parsed = readPendingSignup(
      new NextRequest(CALLBACK_URL, { headers: { Cookie: pending.split(';')[0] } }),
    );
    expect(parsed).not.toBeNull();
    expect(parsed!.handoff ?? null).toBeNull();
  });

  it('F3: a cookie-less callback signs THIS browser in as nobody, and the app still collects', async () => {
    const m = seedMember('Akane');
    await reserveIdentity('google', 'google-sub-1', m.id);
    const id = createHandoffId();
    const ref = handoffRef(id);
    const state = createState();
    await beginHandoff(ref, { state, codeVerifier: 'v' });

    const res = await callback({ code: 'abc', state: `${state}~${ref}` });

    expect(sessionCookie(res)).toBeUndefined();
    expect(handedToApp(res)).toBe(true);
    // In the FRAGMENT — a query string would reach the server's logs.
    expect(locOf(res).search).not.toContain('tc=');
    const typedCode = fragmentOf(res).get('tc');
    expect(typedCode).toMatch(/^[0-9]{6}$/);
    expect(await claimHandoff(id, Date.now(), { typedCode })).toEqual({ status: 'ready', memberId: m.id });
  });

  /**
   * GAP 2, closed. The attacker ran `/start` and sent the victim Google's own
   * link; the victim's browser completes. The attacker holds the preimage and
   * is asked for a code only the victim's screen shows.
   */
  it('Gap 2: the preimage alone gets a code prompt, never the session', async () => {
    const victim = seedMember('Viktor');
    await reserveIdentity('google', 'google-sub-1', victim.id);
    const attackerId = createHandoffId();
    const ref = handoffRef(attackerId);
    const state = createState();
    await beginHandoff(ref, { state, codeVerifier: 'v' });

    await callback({ code: 'abc', state: `${state}~${ref}` });

    expect(await claimHandoff(attackerId)).toEqual({ status: 'code_required', wrong: false });
  });

  /**
   * GAP 1, closed. The attacker starts a sign-in with THEIR Google account and
   * sends the victim the callback. The victim's browser used to get a
   * pending-signup cookie and a name prompt, where typing their own name and
   * PIN linked the attacker's Google to them. Now it gets nothing to type into.
   */
  it('Gap 1: a cookie-less callback for a new identity gives this browser no name step', async () => {
    const id = createHandoffId();
    const ref = handoffRef(id);
    const state = createState();
    await beginHandoff(ref, { state, codeVerifier: 'v' });

    const res = await callback({ code: 'abc', state: `${state}~${ref}` });

    expect(res.headers.getSetCookie().find((c) => c.startsWith(`${PENDING_COOKIE}=`))).toBeUndefined();
    expect(reachedResolution(res)).toBe(false);
    const typedCode = fragmentOf(res).get('tc');
    expect(await claimHandoff(id, Date.now(), { typedCode })).toMatchObject({ status: 'needs_name' });
  });

  /**
   * THE POP-UP. Its window ran `/start`, so it holds the state cookie — but it
   * is not the app, and on iOS its jar may not be the app's. So it is handled
   * like the jar split: completed, not signed in, and handed back by message.
   */
  it('pop-up: completes even on the cookie path, signs the pop-up in as nobody, and posts home', async () => {
    const m = seedMember('Lin');
    await reserveIdentity('google', 'google-sub-1', m.id);
    const id = createHandoffId();
    const ref = handoffRef(id);
    const state = createState();
    await beginHandoff(ref, { state, codeVerifier: 'v', popup: true, openerOrigin: 'https://bpm.grantzou.com' });

    const res = await callback({ code: 'abc', state: `${state}~${ref}` }, oauthCookies(state, 'cookie-verifier'));

    expect(sessionCookie(res)).toBeUndefined();
    expect(handedToApp(res)).toBe(true);
    const fragment = fragmentOf(res);
    expect(fragment.get('ho')).toBe('https://bpm.grantzou.com');
    expect(fragment.get('tc')).toMatch(/^[0-9]{6}$/);
    expect(await claimHandoff(id, Date.now(), { returnCode: fragment.get('hc') })).toEqual({ status: 'ready', memberId: m.id });
  });

  it('pop-up: never links to a session the pop-up window holds', async () => {
    const other = seedMember('Kento', { pinHash: 'x' });
    const ref = handoffRef(createHandoffId());
    const state = createState();
    await beginHandoff(ref, { state, codeVerifier: 'v', popup: true });

    await callback(
      { code: 'abc', state: `${state}~${ref}` },
      `${oauthCookies(state, 'cookie-verifier')}; member_session=${memberCookieValue('Kento', other.id)}`,
    );

    expect(await lookupIdentity('google', 'google-sub-1')).toBeNull();
  });

  it('F3: a cookie-less callback never links the provider to a session this browser holds', async () => {
    const victim = seedMember('Kento', { pinHash: 'x' });
    const ref = handoffRef(createHandoffId());
    const state = createState();
    await beginHandoff(ref, { state, codeVerifier: 'v' });

    await callback(
      { code: 'abc', state: `${state}~${ref}` },
      `member_session=${memberCookieValue('Kento', victim.id)}`,
    );

    expect(await lookupIdentity('google', 'google-sub-1')).toBeNull();
    const stored = (getStore()['members'] as Array<Record<string, unknown>>).find((x) => x.id === victim.id)!;
    expect(stored.linkedProviders).toBeUndefined();
  });

  it('native: the sheet keeps its cookie, and the app needs the return code from the landing', async () => {
    const m = seedMember('Sindhu');
    await reserveIdentity('google', 'google-sub-1', m.id);
    const id = createHandoffId();
    const ref = handoffRef(id);
    const state = createState();
    await beginHandoff(ref, { state, codeVerifier: 'v', native: true });

    const res = await callback({ code: 'abc', state: `${state}~${ref}` }, oauthCookies(state, 'cookie-verifier'));

    const loc = locOf(res);
    expect(loc.searchParams.get('native')).toBe('1');
    // In the FRAGMENT — a query string would reach the server's logs.
    expect(loc.search).not.toContain('hc=');
    const code = /hc=([0-9a-f]{64})/.exec(loc.hash)?.[1];
    expect(code).toBeTruthy();

    expect(await claimHandoff(id)).toEqual({ status: 'pending' });
    expect(await claimHandoff(id, Date.now(), { returnCode: code! })).toEqual({ status: 'ready', memberId: m.id });
  });
});
