import { describe, it, expect, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import {
  resetMockStore,
  seedMember,
  getStore,
  memberCookieValue,
  setupAdminPin,
} from './helpers';
import { finishOAuthCallback } from '../lib/oauthCallback';
import { lookupIdentity, reserveIdentity } from '../lib/authIdentity';
import { PENDING_COOKIE } from '../lib/pendingSignup';
import { createHandoffId, handoffRef, beginHandoff, claimHandoff, readHandoff } from '../lib/authHandoff';

/**
 * Exercises everything a provider callback does AFTER the code exchange, which
 * is the part that decides WHOSE ACCOUNT a sign-in lands in.
 *
 * What this cannot prove: the handshake itself. The mock store never performs a
 * cross-site redirect, so the SameSite behaviour these routes depend on is
 * invisible here. A green run is not evidence that Google sign-in works.
 */
const ORIGIN = 'http://localhost:3000';
let ipSeq = 0;

beforeEach(() => {
  resetMockStore();
  // Aligns SESSION_SECRET with the one memberCookieValue signs with. Without
  // it the app falls back to the dev sentinel, every member_session cookie
  // fails its signature check, and rule 2 silently degrades to rule 4 -- a
  // test that looks like a linking bug but is a key mismatch.
  setupAdminPin();
});

function req(cookie?: string): NextRequest {
  const headers: Record<string, string> = {
    'X-Client-IP': `10.7.${Math.floor(ipSeq / 250)}.${ipSeq++ % 250}`,
  };
  if (cookie) headers.Cookie = cookie;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new NextRequest(`${ORIGIN}/bpm/api/auth/google/callback`, { headers } as any);
}

function claims(over: Record<string, unknown> = {}) {
  return {
    provider: 'google' as const,
    sub: 'sub-1',
    email: 'lin@example.com',
    emailVerified: true,
    suggestedName: null,
    viaParkedState: false,
    ...over,
  };
}

function stored(id: string) {
  return (getStore()['members'] as Array<Record<string, unknown>>).find((m) => m.id === id)!;
}

describe('finishOAuthCallback', () => {
  it('rule 1: signs in a known provider identity', async () => {
    const m = seedMember('Lin');
    await reserveIdentity('google', 'sub-1', m.id);

    const res = await finishOAuthCallback(req(), ORIGIN, claims());
    expect(res.headers.get('location')).toContain('signedIn=1');
    expect(res.headers.getSetCookie().join('\n')).toMatch(/member_session=[^;]+;/);
  });

  it('rule 1 outranks the browser session', async () => {
    // Signing into your own Google account on a friend's phone must sign you in
    // as YOU, not graft your identity onto whoever's session is open there.
    const mine = seedMember('Lin');
    const theirs = seedMember('Viktor');
    await reserveIdentity('google', 'sub-1', mine.id);

    const res = await finishOAuthCallback(
      req(`member_session=${memberCookieValue('Viktor', theirs.id)}`),
      ORIGIN,
      claims(),
    );
    expect(res.headers.get('location')).toContain('signedIn=1');
    // Viktor's record must be untouched — no provider grafted onto it.
    expect(stored(theirs.id).linkedProviders).toBeUndefined();
  });

  it('rule 2: links a new identity to the member signed in on this browser', async () => {
    // The upgrade path: an existing PIN member connects Google to themselves.
    const m = seedMember('Kento', { pinHash: 'x' });
    const res = await finishOAuthCallback(
      req(`member_session=${memberCookieValue('Kento', m.id)}`),
      ORIGIN,
      claims({ sub: 'sub-new' }),
    );
    expect(res.headers.get('location')).toContain('signedIn=1');
    expect((await lookupIdentity('google', 'sub-new'))?.memberId).toBe(m.id);
    expect(stored(m.id).linkedProviders).toEqual(['google']);
  });

  it('rule 3: links on an address verified by BOTH sides', async () => {
    const m = seedMember('Akane', { email: 'akane@example.com', emailVerified: true });
    await reserveIdentity('email', 'akane@example.com', m.id);

    const res = await finishOAuthCallback(
      req(),
      ORIGIN,
      claims({ sub: 'sub-2', email: 'akane@example.com', emailVerified: true }),
    );
    expect(res.headers.get('location')).toContain('signedIn=1');
    expect((await lookupIdentity('google', 'sub-2'))?.memberId).toBe(m.id);
  });

  it('rule 3 refuses when OUR side is unverified', async () => {
    // An unverified email on a member is a claim they typed, not proof.
    const m = seedMember('Akane', { email: 'akane@example.com', emailVerified: false });
    await reserveIdentity('email', 'akane@example.com', m.id);

    const res = await finishOAuthCallback(
      req(),
      ORIGIN,
      claims({ sub: 'sub-3', email: 'akane@example.com', emailVerified: true }),
    );
    expect(res.headers.get('location')).toContain('authFlow=name');
    expect(stored(m.id).linkedProviders).toBeUndefined();
  });

  it('rule 3 refuses when the PROVIDER has not verified', async () => {
    const m = seedMember('Akane', { email: 'akane@example.com', emailVerified: true });
    await reserveIdentity('email', 'akane@example.com', m.id);

    const res = await finishOAuthCallback(
      req(),
      ORIGIN,
      claims({ sub: 'sub-4', email: 'akane@example.com', emailVerified: false }),
    );
    expect(res.headers.get('location')).toContain('authFlow=name');
  });

  it('rule 4: parks a signed pending cookie and asks for a name', async () => {
    const res = await finishOAuthCallback(req(), ORIGIN, claims({ sub: 'sub-fresh' }));
    expect(res.headers.get('location')).toContain('authFlow=name');
    const cookie = res.headers.getSetCookie().find((c) => c.startsWith(PENDING_COOKIE));
    expect(cookie).toBeTruthy();
    // Nothing is created yet — the name step can still be abandoned.
    expect(getStore()['members'] ?? []).toHaveLength(0);
    expect(await lookupIdentity('google', 'sub-fresh')).toBeNull();
  });

  it('never links a provider identity that already belongs to someone else', async () => {
    const owner = seedMember('Owner');
    const browser = seedMember('Browser');
    await reserveIdentity('google', 'sub-owned', owner.id);

    // A browser session for a DIFFERENT member, and rule 1 will match the owner
    // first — so this asserts rule 1's precedence protects the owner.
    const res = await finishOAuthCallback(
      req(`member_session=${memberCookieValue('Browser', browser.id)}`),
      ORIGIN,
      claims({ sub: 'sub-owned' }),
    );
    expect((await lookupIdentity('google', 'sub-owned'))?.memberId).toBe(owner.id);
    expect(res.headers.get('location')).toContain('signedIn=1');
  });

  it('fails legibly when the resolved member has been deactivated', async () => {
    const m = seedMember('Gone', { active: false });
    await reserveIdentity('google', 'sub-gone', m.id);
    const res = await finishOAuthCallback(req(), ORIGIN, claims({ sub: 'sub-gone' }));
    expect(res.headers.get('location')).toContain('authError=account_unavailable');
  });
});

/**
 * A callback validated through the PARKED state (security scan F3; F13 for
 * Apple, which calls this same helper). Nothing proves this browser started the
 * flow, so it must neither receive a session nor be treated as asking to link.
 */
describe('finishOAuthCallback — a parked-state callback is non-authenticating', () => {
  async function parked() {
    const id = createHandoffId();
    const ref = handoffRef(id);
    await beginHandoff(ref, { state: 's'.repeat(64), codeVerifier: 'v' });
    return { id, ref };
  }
  const sessionCookie = (res: Response) =>
    res.headers.getSetCookie().find((c) => /^member_session=[^;]+;/.test(c));

  it('sets NO member_session, says where the session went, and still parks for the app', async () => {
    const m = seedMember('Lin');
    await reserveIdentity('google', 'sub-1', m.id);
    const { id, ref } = await parked();

    const res = await finishOAuthCallback(req(), ORIGIN, claims({ handoff: ref, viaParkedState: true }));

    expect(sessionCookie(res)).toBeUndefined();
    const loc = new URL(res.headers.get('location')!);
    expect(loc.pathname).toBe('/bpm/auth/done');
    expect(loc.search).not.toContain('signedIn=1');
    // The app that holds the preimage collects — with the code this page shows.
    const typedCode = new URLSearchParams(loc.hash.slice(1)).get('tc');
    expect(await claimHandoff(id, Date.now(), { typedCode })).toEqual({ status: 'ready', memberId: m.id });
  });

  it("never links the provider to this browser's signed-in member (the F3 takeover)", async () => {
    const victim = seedMember('Viktor', { pinHash: 'x' });
    const { ref } = await parked();

    const res = await finishOAuthCallback(
      req(`member_session=${memberCookieValue('Viktor', victim.id)}`),
      ORIGIN,
      claims({ sub: 'attacker-sub', email: 'attacker@example.com', handoff: ref, viaParkedState: true }),
    );

    expect(stored(victim.id).linkedProviders).toBeUndefined();
    expect(await lookupIdentity('google', 'attacker-sub')).toBeNull();
    // A new identity, handed to the app — not a name step in this browser.
    expect(new URL(res.headers.get('location')!).pathname).toBe('/bpm/auth/done');
  });

  it('fails rather than signing this browser in when the stash is gone', async () => {
    const m = seedMember('Lin');
    await reserveIdentity('google', 'sub-1', m.id);
    const ref = handoffRef(createHandoffId()); // never begun

    const res = await finishOAuthCallback(req(), ORIGIN, claims({ handoff: ref, viaParkedState: true }));
    expect(res.headers.get('location')).toContain('authError=state_mismatch');
    expect(sessionCookie(res)).toBeUndefined();
  });
});

describe('finishOAuthCallback — a parked flow is named in the app', () => {
  it('parks the new identity on the stash and gives this browser no pending-signup cookie', async () => {
    const ref = handoffRef(createHandoffId());
    await beginHandoff(ref, { state: 's'.repeat(64), codeVerifier: 'v' });

    const res = await finishOAuthCallback(req(), ORIGIN, claims({ sub: 'fresh', handoff: ref, viaParkedState: true }));
    expect(res.headers.getSetCookie().find((c) => c.startsWith(`${PENDING_COOKIE}=`))).toBeUndefined();
    expect((await readHandoff(ref))?.pending?.sub).toBe('fresh');
  });

  it('an ordinary new-account flow is not marked', async () => {
    const { readPendingSignup } = await import('../lib/pendingSignup');
    const res = await finishOAuthCallback(req(), ORIGIN, claims({ sub: 'fresh-2' }));
    const header = res.headers.getSetCookie().find((c) => c.startsWith(`${PENDING_COOKIE}=`))!;
    const parsed = readPendingSignup(
      new NextRequest(`${ORIGIN}/bpm/api/auth/complete-signup`, { headers: { Cookie: header.split(';')[0] } }),
    );
    expect(parsed?.parked).toBeUndefined();
  });
});
