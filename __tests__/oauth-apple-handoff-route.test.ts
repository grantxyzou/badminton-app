import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { resetMockStore, setupAdminPin, seedMember, memberCookieValue, getStore } from './helpers';
import { setOAuthCookies, STATE_COOKIE, createState } from '../lib/oauthState';
import { createHandoffId, handoffRef, beginHandoff, readHandoff, claimHandoff } from '../lib/authHandoff';
import { reserveIdentity, lookupIdentity } from '../lib/authIdentity';
import { PENDING_COOKIE, readPendingSignup } from '../lib/pendingSignup';

/**
 * THE DEVICE CONDITION, AS A TEST — for Apple.
 *
 * `oauth-google-handoff-route.test.ts` proves the Google callback recovers a
 * cookie-less callback from the parked handoff. Apple's routes did NOT do
 * this for their first two weeks: `/start` never read `?hr=` and the callback
 * never split the state, so an installed iOS PWA that picked Apple signed
 * Safari in and returned to the app signed out. This file is the Apple twin,
 * with the one difference Apple has: a form-post body and no PKCE verifier.
 */

vi.mock('@/lib/oauthProviders', async (orig) => {
  const actual = await orig<typeof import('@/lib/oauthProviders')>();
  return {
    ...actual,
    appleClient: () => ({
      createAuthorizationURL: (state: string) =>
        new URL(`https://appleid.apple.com/auth/authorize?state=${encodeURIComponent(state)}`),
      validateAuthorizationCode: async (_code: string) => ({ idToken: () => 'fake.apple' }),
    }),
    decodeIdTokenClaims: () => ({
      sub: 'apple-sub-1',
      email: 'someone@privaterelay.appleid.com',
      emailVerified: true,
    }),
  };
});

const CALLBACK = 'https://bpm.grantzou.com/bpm/api/auth/apple/callback';
const CALLBACK_URL = CALLBACK;
const START = 'https://bpm.grantzou.com/bpm/api/auth/apple/start';
let ipSeq = 0;
const nextIp = () => `10.8.${Math.floor(ipSeq / 250)}.${ipSeq++ % 250}`;

async function callback(fields: Record<string, string>, cookie?: string) {
  const { POST } = await import('../app/api/auth/apple/callback/route');
  const headers: Record<string, string> = {
    'X-Client-IP': nextIp(),
    'Content-Type': 'application/x-www-form-urlencoded',
  };
  if (cookie) headers.Cookie = cookie;
  return POST(
    new NextRequest(CALLBACK, { method: 'POST', headers, body: new URLSearchParams(fields).toString() }),
  );
}

async function start(qs: Record<string, string>) {
  const { GET } = await import('../app/api/auth/apple/start/route');
  const url = `${START}?${new URLSearchParams(qs).toString()}`;
  return GET(new NextRequest(url, { headers: { 'X-Client-IP': nextIp() } }));
}

/** Serialize the state cookie the way /start would in form_post mode. */
function stateCookie(state: string): string {
  const res = NextResponse.json({});
  setOAuthCookies(res, 'form_post', { state });
  return res.headers
    .getSetCookie()
    .filter((c) => c.startsWith(`${STATE_COOKIE}=`))
    .map((c) => c.split(';')[0])
    .join('; ');
}

const locOf = (res: Response) => new URL(res.headers.get('location') ?? 'https://x/');
const errorOf = (res: Response) => locOf(res).searchParams.get('authError');
/** New account → "pick a name" proves state was recovered, code exchanged, claims decoded. */
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

describe('apple start — parks the handoff like google', () => {
  it('records the state against the ref and rides it in the outbound state', async () => {
    const ref = handoffRef(createHandoffId());
    const res = await start({ hr: ref });
    expect(res.status).toBeGreaterThanOrEqual(300);
    const outbound = new URL(res.headers.get('location')!).searchParams.get('state')!;
    expect(outbound.endsWith(`~${ref}`)).toBe(true);

    const parked = await readHandoff(ref);
    expect(parked).not.toBeNull();
    expect(parked!.state).toBe(outbound.slice(0, outbound.indexOf('~')));
    expect(parked!.codeVerifier).toBe('');
    expect(parked!.native).toBeUndefined();
  });

  it('records native=1 on the stash and never trusts it from anywhere else', async () => {
    const ref = handoffRef(createHandoffId());
    await start({ hr: ref, native: '1' });
    expect((await readHandoff(ref))!.native).toBe(true);
  });

  it('ignores a malformed ref and parks nothing', async () => {
    const res = await start({ hr: 'not-a-ref' });
    const outbound = new URL(res.headers.get('location')!).searchParams.get('state')!;
    expect(outbound).not.toContain('~');
  });
});

describe('apple callback — the jar split', () => {
  it('recovers a cookie-less callback when a handoff was parked', async () => {
    const ref = handoffRef(createHandoffId());
    const state = createState();
    await beginHandoff(ref, { state, codeVerifier: '' });

    // No cookie at all — the Safari jar / the native browser sheet.
    const res = await callback({ code: 'abc', state: `${state}~${ref}` });
    expect(errorOf(res)).toBeNull();
    expect(reachedResolution(res)).toBe(true);
  });

  it('adds native=1 to the landing when the stash says the shell started it', async () => {
    const ref = handoffRef(createHandoffId());
    const state = createState();
    await beginHandoff(ref, { state, codeVerifier: '', native: true });

    const res = await callback({ code: 'abc', state: `${state}~${ref}` });
    expect(reachedResolution(res)).toBe(true);
    expect(locOf(res).searchParams.get('native')).toBe('1');
  });

  it('a cookie-less NATIVE landing says only "back to the app" — never the Home Screen copy', async () => {
    const m = seedMember('Viktor');
    await reserveIdentity('apple', 'apple-sub-1', m.id);
    const ref = handoffRef(createHandoffId());
    const state = createState();
    await beginHandoff(ref, { state, codeVerifier: '', native: true });

    const res = await callback({ code: 'abc', state: `${state}~${ref}` });
    const loc = locOf(res);
    expect(loc.searchParams.get('native')).toBe('1');
    expect(loc.searchParams.get('handedOff')).toBeNull();
    // The sheet holds no session on this path, so it must not claim one.
    expect(loc.searchParams.get('signedIn')).toBeNull();
    expect(res.headers.getSetCookie().some((c) => /^member_session=[^;]+;/.test(c))).toBe(false);
    expect(loc.hash).toMatch(/^#hc=[0-9a-f]{64}$/);
  });

  it('does not add native=1 for a PWA handoff', async () => {
    const ref = handoffRef(createHandoffId());
    const state = createState();
    await beginHandoff(ref, { state, codeVerifier: '' });
    const res = await callback({ code: 'abc', state: `${state}~${ref}` });
    expect(locOf(res).searchParams.get('native')).toBeNull();
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

  it('refuses when the parked state does not match the callback state', async () => {
    const ref = handoffRef(createHandoffId());
    await beginHandoff(ref, { state: createState(), codeVerifier: '' });
    const res = await callback({ code: 'abc', state: `${createState()}~${ref}` });
    expect(errorOf(res)).toBe('state_mismatch');
  });

  it('does NOT let a handoff rescue a genuine state mismatch', async () => {
    const ref = handoffRef(createHandoffId());
    const state = createState();
    await beginHandoff(ref, { state, codeVerifier: '' });
    // Cookie present but holding a DIFFERENT state: the jars match and the
    // value is wrong — the case the check exists for.
    const res = await callback({ code: 'abc', state: `${state}~${ref}` }, stateCookie(createState()));
    expect(errorOf(res)).toBe('state_mismatch');
  });

  it('leaves the ordinary cookie path untouched', async () => {
    const state = createState();
    const res = await callback({ code: 'abc', state }, stateCookie(state));
    expect(errorOf(res)).toBeNull();
    expect(reachedResolution(res)).toBe(true);
  });

  it('prefers the cookie even when a handoff ref is also present', async () => {
    const ref = handoffRef(createHandoffId());
    const state = createState();
    await beginHandoff(ref, { state, codeVerifier: '' });
    const res = await callback({ code: 'abc', state: `${state}~${ref}` }, stateCookie(state));
    expect(reachedResolution(res)).toBe(true);
    // The stash is still sitting there — the cookie path never consumed it.
    expect(await readHandoff(ref)).not.toBeNull();
  });

  it('still captures the one-shot name alongside a handoff', async () => {
    const ref = handoffRef(createHandoffId());
    const state = createState();
    await beginHandoff(ref, { state, codeVerifier: '' });
    const res = await callback({
      code: 'abc',
      state: `${state}~${ref}`,
      user: JSON.stringify({ name: { firstName: 'Viktor', lastName: 'A' } }),
    });
    expect(reachedResolution(res)).toBe(true);
  });
});

/**
 * SECURITY SCAN F3 / F4 / F13 — through the real apple callback.
 *
 * The handoff ref is chosen by whoever calls `/start`, so it proves who STARTED
 * a sign-in, never who finished it. These pin the three rules that follow from
 * that (lib/authHandoff.ts): no parking on the cookie path unless the native
 * shell started it; a parked-state callback is non-authenticating; a native
 * park needs a return code.
 */
describe('apple callback — the handoff cannot be turned against the person who finishes it', () => {
  const sessionCookie = (res: Response) =>
    res.headers.getSetCookie().find((c) => /^member_session=[^;]+;/.test(c));

  it('F4: a single-jar browser that carries someone else\'s ref parks NOTHING claimable', async () => {
    const victim = seedMember('Carolina');
    await reserveIdentity('apple', 'apple-sub-1', victim.id);
    // The attacker minted this pair and sent the victim `/start?hr=<ref>`.
    const attackerId = createHandoffId();
    const ref = handoffRef(attackerId);
    const state = createState();
    await beginHandoff(ref, { state, codeVerifier: 'v' });

    const res = await callback({ code: 'abc', state: `${state}~${ref}` }, stateCookie(state));

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

    const res = await callback({ code: 'abc', state: `${state}~${ref}` }, stateCookie(state));
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
    await reserveIdentity('apple', 'apple-sub-1', m.id);
    const id = createHandoffId();
    const ref = handoffRef(id);
    const state = createState();
    await beginHandoff(ref, { state, codeVerifier: 'v' });

    const res = await callback({ code: 'abc', state: `${state}~${ref}` });

    expect(sessionCookie(res)).toBeUndefined();
    expect(locOf(res).searchParams.get('handedOff')).toBe('1');
    expect(await claimHandoff(id)).toEqual({ status: 'ready', memberId: m.id });
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

    expect(await lookupIdentity('apple', 'apple-sub-1')).toBeNull();
    const stored = (getStore()['members'] as Array<Record<string, unknown>>).find((x) => x.id === victim.id)!;
    expect(stored.linkedProviders).toBeUndefined();
  });

  it('native: the sheet keeps its cookie, and the app needs the return code from the landing', async () => {
    const m = seedMember('Sindhu');
    await reserveIdentity('apple', 'apple-sub-1', m.id);
    const id = createHandoffId();
    const ref = handoffRef(id);
    const state = createState();
    await beginHandoff(ref, { state, codeVerifier: 'v', native: true });

    const res = await callback({ code: 'abc', state: `${state}~${ref}` }, stateCookie(state));

    const loc = locOf(res);
    expect(loc.searchParams.get('native')).toBe('1');
    // In the FRAGMENT — a query string would reach the server's logs.
    expect(loc.search).not.toContain('hc=');
    const code = /hc=([0-9a-f]{64})/.exec(loc.hash)?.[1];
    expect(code).toBeTruthy();

    expect(await claimHandoff(id)).toEqual({ status: 'pending' });
    expect(await claimHandoff(id, Date.now(), code!)).toEqual({ status: 'ready', memberId: m.id });
  });
});
