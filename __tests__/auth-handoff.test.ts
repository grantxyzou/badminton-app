import { describe, it, expect, beforeEach } from 'vitest';
import {
  createHandoffId,
  handoffRef,
  isHandoffRef,
  beginHandoff,
  readHandoff,
  completeHandoff,
  claimHandoff,
  handoffStateMatches,
  HANDOFF_TTL_MS,
} from '@/lib/authHandoff';

/**
 * The iOS-PWA sign-in bridge.
 *
 * This is the one part of the fix that CAN be proven without a phone, and that
 * is not a coincidence — the whole design exists because cookie continuity is
 * unavailable, so every step is deliberately independent of it. A test that
 * never sends a cookie is therefore an accurate model of the failing device,
 * not a weaker one.
 */

const S = 'state-'.repeat(4);
const V = 'verifier-'.repeat(4);

describe('handoff ids and refs', () => {
  it('a ref is a sha256 of the id, and the id is not recoverable from it', () => {
    const id = createHandoffId();
    const ref = handoffRef(id);
    expect(isHandoffRef(ref)).toBe(true);
    expect(ref).not.toBe(id);
    expect(ref).not.toContain(id);
  });

  it('is deterministic, so the callback and the claim agree', () => {
    const id = createHandoffId();
    expect(handoffRef(id)).toBe(handoffRef(id));
  });

  it('mints a fresh id every time', () => {
    expect(createHandoffId()).not.toBe(createHandoffId());
  });

  it('rejects anything that is not a hex sha256', () => {
    expect(isHandoffRef(null)).toBe(false);
    expect(isHandoffRef('')).toBe(false);
    expect(isHandoffRef('nope')).toBe(false);
    expect(isHandoffRef('A'.repeat(64))).toBe(false); // uppercase
    expect(isHandoffRef('a'.repeat(63))).toBe(false);
    expect(isHandoffRef(`${'a'.repeat(64)}x`)).toBe(false);
  });
});

describe('handoffStateMatches', () => {
  it('matches an identical parked state', () => {
    expect(handoffStateMatches(S, S)).toBe(true);
  });
  it('refuses a different or absent state', () => {
    expect(handoffStateMatches(S, 'other-state-value-here!!')).toBe(false);
    expect(handoffStateMatches(S, null)).toBe(false);
    expect(handoffStateMatches(S, '')).toBe(false);
  });
  it('refuses a length mismatch rather than throwing', () => {
    expect(handoffStateMatches(S, 'short')).toBe(false);
  });
});

describe('the full bridge — start in one context, finish in another', () => {
  let id: string;
  let ref: string;

  beforeEach(() => {
    id = createHandoffId();
    ref = handoffRef(id);
  });

  /**
   * The end-to-end path the PWA takes. Note that no cookie appears anywhere:
   * that IS the device condition.
   */
  it('parks state+verifier, completes with a member, and claims once', async () => {
    expect(await beginHandoff(ref, { state: S, codeVerifier: V })).toBe(true);

    // The callback, arriving in a different jar, recovers what the cookies held.
    const parked = await readHandoff(ref);
    expect(parked?.state).toBe(S);
    expect(parked?.codeVerifier).toBe(V);
    expect(handoffStateMatches(parked!.state, S)).toBe(true);

    expect(await completeHandoff(ref, 'member-1')).toBe(true);

    const claim = await claimHandoff(id);
    expect(claim).toEqual({ status: 'ready', memberId: 'member-1' });
  });

  it('reports pending while the excursion is still in flight, WITHOUT consuming it', async () => {
    await beginHandoff(ref, { state: S, codeVerifier: V });

    expect(await claimHandoff(id)).toEqual({ status: 'pending' });
    // Still claimable afterwards — a poll must not destroy the thing it polls.
    await completeHandoff(ref, 'member-1');
    expect(await claimHandoff(id)).toEqual({ status: 'ready', memberId: 'member-1' });
  });

  it('is SINGLE USE — a replayed claim finds nothing', async () => {
    await beginHandoff(ref, { state: S, codeVerifier: V });
    await completeHandoff(ref, 'member-1');

    expect((await claimHandoff(id)).status).toBe('ready');
    expect(await claimHandoff(id)).toEqual({ status: 'none' });
  });

  it('cannot be claimed with the REF — only the preimage works', async () => {
    await beginHandoff(ref, { state: S, codeVerifier: V });
    await completeHandoff(ref, 'member-1');

    // This is the whole security argument: the value that travels through
    // Google and the URL is useless as a credential.
    expect(await claimHandoff(ref)).toEqual({ status: 'none' });
    // ...and the real id still works afterwards, so the failed attempt did not
    // consume it.
    expect((await claimHandoff(id)).status).toBe('ready');
  });

  it('expires, and an expired stash claims as nothing', async () => {
    const t0 = 1_000_000;
    await beginHandoff(ref, { state: S, codeVerifier: V }, t0);
    await completeHandoff(ref, 'member-1', t0);

    const after = t0 + HANDOFF_TTL_MS + 1;
    expect(await readHandoff(ref, after)).toBeNull();
    expect(await claimHandoff(id, after)).toEqual({ status: 'none' });
  });

  /** First write wins — the race half of the login-CSRF argument. */
  it('refuses to overwrite a LIVE stash', async () => {
    expect(await beginHandoff(ref, { state: S, codeVerifier: V })).toBe(true);
    expect(await beginHandoff(ref, { state: 'attacker-state-value!', codeVerifier: 'x' })).toBe(false);

    const parked = await readHandoff(ref);
    expect(parked?.state).toBe(S); // the original survived
  });

  it('DOES replace an expired stash, so one abandoned attempt cannot burn a ref', async () => {
    const t0 = 1_000_000;
    await beginHandoff(ref, { state: S, codeVerifier: V }, t0);
    const later = t0 + HANDOFF_TTL_MS + 1;
    expect(await beginHandoff(ref, { state: 'fresh-state-value!!!', codeVerifier: V }, later)).toBe(true);
  });

  it('will not complete a ref that was never begun', async () => {
    expect(await completeHandoff(handoffRef(createHandoffId()), 'member-1')).toBe(false);
  });

  it('rejects a malformed ref everywhere rather than touching the store', async () => {
    expect(await beginHandoff('nope', { state: S, codeVerifier: V })).toBe(false);
    expect(await readHandoff('nope')).toBeNull();
    expect(await completeHandoff('nope', 'm')).toBe(false);
  });

  /**
   * The attack the design is built against: an attacker completes their own
   * authorization and parks THEIR account. The victim's app claims with its own
   * id, which hashes to a different ref, and is signed into nobody.
   */
  it('an attacker-controlled stash is never collected by the victim', async () => {
    const attackerId = createHandoffId();
    const attackerRef = handoffRef(attackerId);
    await beginHandoff(attackerRef, { state: S, codeVerifier: V });
    await completeHandoff(attackerRef, 'attacker-member');

    // Victim's own flow, untouched by the above.
    await beginHandoff(ref, { state: S, codeVerifier: V });
    await completeHandoff(ref, 'victim-member');

    const victimClaim = await claimHandoff(id);
    expect(victimClaim).toEqual({ status: 'ready', memberId: 'victim-member' });
  });
});

/**
 * THE NEW-ACCOUNT PATH, which the sign-in path does not cover.
 *
 * A brand-new provider identity has no member at callback time, so the
 * callback parks nothing and hands off to the name step instead. If the ref
 * did not ride along on the pending-signup cookie, a first-time Google user
 * would sign in everywhere EXCEPT the app that started the flow — the same jar
 * split as before, one step later, and invisible to anyone who already has an
 * account.
 */
describe('handoff through the name step', () => {
  it('a ref parked at /start is still completable later, by complete-signup', async () => {
    const id = createHandoffId();
    const ref = handoffRef(id);

    // /start parks it; the callback resolves to "new account" and completes
    // NOTHING, so the stash is still pending after the handshake.
    await beginHandoff(ref, { state: 'state-value-here-ok', codeVerifier: 'v' });
    expect(await claimHandoff(id)).toEqual({ status: 'pending' });

    // The name step creates the member and completes it.
    expect(await completeHandoff(ref, 'brand-new-member')).toBe(true);
    expect(await claimHandoff(id)).toEqual({ status: 'ready', memberId: 'brand-new-member' });
  });

  it('the stash outlives the name step rather than expiring on the callback', async () => {
    const id = createHandoffId();
    const ref = handoffRef(id);
    const t0 = 1_000_000;
    await beginHandoff(ref, { state: 'state-value-here-ok', codeVerifier: 'v' }, t0);

    // Picking a name takes a moment; still claimable a few minutes later.
    const later = t0 + 5 * 60 * 1000;
    expect(await completeHandoff(ref, 'm', later)).toBe(true);
    expect(await claimHandoff(id, later)).toEqual({ status: 'ready', memberId: 'm' });
  });
});
