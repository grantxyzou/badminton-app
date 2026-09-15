import { describe, it, expect, beforeEach, vi } from 'vitest';

/* A seam for the concurrency test: runs once, just before the next CONDITIONAL
   write to the hand-off store — i.e. between a claim's read and its count. */
const seam = vi.hoisted(() => ({ beforeCount: null as null | (() => Promise<void>) }));
vi.mock('@/lib/cosmos', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/cosmos')>();
  return {
    ...actual,
    getContainer: (name: string) => {
      const container = actual.getContainer(name);
      if (name !== 'authhandoff') return container;
      const upsert = container.items.upsert.bind(container.items);
      return {
        ...container,
        item: container.item.bind(container),
        items: {
          ...container.items,
          upsert: async (item: never, options?: { accessCondition?: unknown }) => {
            if (options?.accessCondition && seam.beforeCount) {
              const run = seam.beforeCount;
              seam.beforeCount = null;
              await run();
            }
            return upsert(item, options as never);
          },
        },
      } as unknown as typeof container;
    },
  };
});
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
  TYPED_CODE_MAX_ATTEMPTS,
  type CompletedHandoff,
} from '@/lib/authHandoff';
import { getContainer } from '@/lib/cosmos';

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

/** The code a web completion showed, as the app would send it after it was typed. */
const typed = (done: CompletedHandoff | null) => ({ typedCode: done!.typedCode });

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

    const done = await completeHandoff(ref, 'member-1');
    expect(done).toEqual({ returnCode: null, typedCode: expect.stringMatching(/^[0-9]{6}$/), openerOrigin: null });

    const claim = await claimHandoff(id, Date.now(), typed(done));
    expect(claim).toEqual({ status: 'ready', memberId: 'member-1' });
  });

  it('reports pending while the excursion is still in flight, WITHOUT consuming it', async () => {
    await beginHandoff(ref, { state: S, codeVerifier: V });

    expect(await claimHandoff(id)).toEqual({ status: 'pending' });
    // Still claimable afterwards — a poll must not destroy the thing it polls.
    const done = await completeHandoff(ref, 'member-1');
    expect(await claimHandoff(id, Date.now(), typed(done))).toEqual({ status: 'ready', memberId: 'member-1' });
  });

  it('is SINGLE USE — a replayed claim finds nothing', async () => {
    await beginHandoff(ref, { state: S, codeVerifier: V });
    const done = await completeHandoff(ref, 'member-1');

    expect((await claimHandoff(id, Date.now(), typed(done))).status).toBe('ready');
    expect(await claimHandoff(id, Date.now(), typed(done))).toEqual({ status: 'none' });
  });

  it('cannot be claimed with the REF — only the preimage works', async () => {
    await beginHandoff(ref, { state: S, codeVerifier: V });
    const done = await completeHandoff(ref, 'member-1');

    // The value that travels through Google and the URL is useless as a
    // credential...
    expect(await claimHandoff(ref, Date.now(), typed(done))).toEqual({ status: 'none' });
    // ...and the real id still works afterwards, so the failed attempt did not
    // consume it.
    expect((await claimHandoff(id, Date.now(), typed(done))).status).toBe('ready');
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
    expect(await completeHandoff(handoffRef(createHandoffId()), 'member-1')).toBeNull();
  });

  it('rejects a malformed ref everywhere rather than touching the store', async () => {
    expect(await beginHandoff('nope', { state: S, codeVerifier: V })).toBe(false);
    expect(await readHandoff('nope')).toBeNull();
    expect(await completeHandoff('nope', 'm')).toBeNull();
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
    const done = await completeHandoff(ref, 'victim-member');

    const victimClaim = await claimHandoff(id, Date.now(), typed(done));
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
    const done = await completeHandoff(ref, 'brand-new-member');
    expect(await claimHandoff(id, Date.now(), typed(done))).toEqual({ status: 'ready', memberId: 'brand-new-member' });
  });

  it('the stash outlives the name step rather than expiring on the callback', async () => {
    const id = createHandoffId();
    const ref = handoffRef(id);
    const t0 = 1_000_000;
    await beginHandoff(ref, { state: 'state-value-here-ok', codeVerifier: 'v' }, t0);

    // Picking a name takes a moment; still claimable a few minutes later.
    const later = t0 + 5 * 60 * 1000;
    const done = await completeHandoff(ref, 'm', later);
    expect(await claimHandoff(id, later, typed(done))).toEqual({ status: 'ready', memberId: 'm' });
  });
});

describe('the stash carries the GROUP across the cookie-jar split', () => {
  /**
   * The excursion runs in the system browser sheet, a different cookie jar from
   * the PWA. That is the whole reason this stash exists — so the callback and
   * the claim see no `member_session` at all, and `resolveGroupId` answers BPM
   * for everybody. A member of another club signing in with Google would land
   * holding a cookie claiming a group they are not on the roster of. The group
   * has to ride in the stash, because nothing else crosses the split.
   */
  it('hands the claim the group the flow STARTED in, not the one it lands in', async () => {
    const id = createHandoffId();
    const ref = handoffRef(id);
    expect(await beginHandoff(ref, { state: S, codeVerifier: V, groupId: 'club-x' })).toBe(true);
    expect((await readHandoff(ref))?.groupId).toBe('club-x');
    const done = await completeHandoff(ref, 'member-lin');
    expect(await claimHandoff(id, Date.now(), typed(done))).toEqual({ status: 'ready', memberId: 'member-lin', groupId: 'club-x' });
  });

  it('is additive — a stash minted before the claim existed carries none', async () => {
    const id = createHandoffId();
    const ref = handoffRef(id);
    await beginHandoff(ref, { state: S, codeVerifier: V });
    expect((await readHandoff(ref))?.groupId).toBeUndefined();
    const done = await completeHandoff(ref, 'member-lin');
    // No `groupId` key at all, so the claim route falls back to BPM the way
    // every pre-claim device already resolves.
    expect(await claimHandoff(id, Date.now(), typed(done))).toEqual({ status: 'ready', memberId: 'member-lin' });
  });
});

/**
 * GUARANTEE 3 — a NATIVE stash is not claimable with the preimage alone.
 *
 * The preimage proves who STARTED a sign-in (security scan F4). A `&native=1`
 * link handed to someone else still parks their member; what the link's author
 * lacks is the return code, which only the completing browser ever sees.
 */
describe('the native return code', () => {
  let id: string;
  let ref: string;

  beforeEach(async () => {
    id = createHandoffId();
    ref = handoffRef(id);
    await beginHandoff(ref, { state: S, codeVerifier: V, native: true });
  });

  it('mints a code on completion, and stores only its hash', async () => {
    const done = await completeHandoff(ref, 'member-1');
    expect(done?.returnCode).toMatch(/^[0-9a-f]{64}$/);
    const doc = await readHandoff(ref);
    expect(doc?.returnCodeHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(doc)).not.toContain(done!.returnCode!);
  });

  it('holding the preimage WITHOUT the code is pending, and does not burn the stash', async () => {
    const done = await completeHandoff(ref, 'member-1');
    expect(await claimHandoff(id)).toEqual({ status: 'pending' });
    // The app's first poll routinely beats the deep link; the code still works.
    expect(await claimHandoff(id, Date.now(), { returnCode: done!.returnCode })).toEqual({ status: 'ready', memberId: 'member-1' });
  });

  it('a WRONG code is terminal — the stash is gone', async () => {
    const done = await completeHandoff(ref, 'member-1');
    expect(await claimHandoff(id, Date.now(), { returnCode: 'f'.repeat(64) })).toEqual({ status: 'none' });
    expect(await claimHandoff(id, Date.now(), { returnCode: done!.returnCode })).toEqual({ status: 'none' });
  });

  it('never mints a typed code — the shell always has its channel home', async () => {
    const done = await completeHandoff(ref, 'member-1');
    expect(done?.typedCode).toBeNull();
    expect((await readHandoff(ref))?.typedCodeHash).toBeUndefined();
  });
});

/**
 * GUARANTEE 3 for the WEB — the security scan's open Gap 2. An attacker runs
 * `/start?hr=` and sends a victim the provider's link; the victim's browser
 * completes the stash. What the attacker lacks is the code that browser shows.
 */
describe('the typed code', () => {
  let id: string;
  let ref: string;

  beforeEach(async () => {
    id = createHandoffId();
    ref = handoffRef(id);
    await beginHandoff(ref, { state: S, codeVerifier: V });
  });

  it('the preimage alone asks for the code, and does not burn the stash', async () => {
    const done = await completeHandoff(ref, 'member-1');
    expect(await claimHandoff(id)).toEqual({ status: 'code_required', wrong: false });
    expect(await claimHandoff(id, Date.now(), typed(done))).toEqual({ status: 'ready', memberId: 'member-1' });
  });

  it('stores only a salted hash of it', async () => {
    const done = await completeHandoff(ref, 'member-1');
    const doc = await readHandoff(ref);
    expect(doc?.typedCodeHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(doc)).not.toContain(`"${done!.typedCode}"`);
  });

  it('a wrong code says so and leaves the stash for another try', async () => {
    const done = await completeHandoff(ref, 'member-1');
    const wrong = done!.typedCode === '000000' ? '111111' : '000000';
    expect(await claimHandoff(id, Date.now(), { typedCode: wrong })).toEqual({ status: 'code_required', wrong: true });
    expect(await claimHandoff(id, Date.now(), typed(done))).toEqual({ status: 'ready', memberId: 'member-1' });
  });

  it(`burns the stash on the ${TYPED_CODE_MAX_ATTEMPTS}th wrong code, so the right one no longer works`, async () => {
    const done = await completeHandoff(ref, 'member-1');
    const wrong = done!.typedCode === '000000' ? '111111' : '000000';
    for (let i = 1; i < TYPED_CODE_MAX_ATTEMPTS; i++) {
      expect((await claimHandoff(id, Date.now(), { typedCode: wrong })).status).toBe('code_required');
    }
    expect(await claimHandoff(id, Date.now(), { typedCode: wrong })).toEqual({ status: 'none' });
    expect(await claimHandoff(id, Date.now(), typed(done))).toEqual({ status: 'none' });
  });

  /**
   * THE COUNT HAS TO HOLD UNDER CONCURRENCY. A read-compare-write counter lets
   * every parallel guess read the same count; each attempt is counted under
   * the etag BEFORE it is compared, so a lost race compares nothing.
   */
  it('a guess that loses the race to count is not compared at all', async () => {
    const done = await completeHandoff(ref, 'member-1');
    // Another guess lands between this claim's read and its count.
    seam.beforeCount = async () => {
      const current = (await getContainer('authhandoff').item(ref, ref).read()).resource as Record<string, unknown>;
      const { _etag: _e, ...rest } = current;
      await getContainer('authhandoff').items.upsert({ ...rest, typedAttempts: 1 });
    };
    // The RIGHT code, and it still is not accepted on a lost race.
    expect(await claimHandoff(id, Date.now(), typed(done))).toEqual({ status: 'code_required', wrong: false });
    expect((await readHandoff(ref))?.typedAttempts).toBe(1);
    expect(await claimHandoff(id, Date.now(), typed(done))).toEqual({ status: 'ready', memberId: 'member-1' });
  });

  it('a pop-up stash gets BOTH codes, and either one claims', async () => {
    const popupId = createHandoffId();
    const popupRef = handoffRef(popupId);
    await beginHandoff(popupRef, { state: S, codeVerifier: V, popup: true, openerOrigin: 'https://bpm.grantzou.com' });
    const done = await completeHandoff(popupRef, 'member-3');
    expect(done?.returnCode).toMatch(/^[0-9a-f]{64}$/);
    expect(done?.typedCode).toMatch(/^[0-9]{6}$/);
    expect(done?.openerOrigin).toBe('https://bpm.grantzou.com');
    expect(await claimHandoff(popupId, Date.now(), { returnCode: done!.returnCode })).toEqual({ status: 'ready', memberId: 'member-3' });
  });

  it('a pop-up flag on a NATIVE stash is ignored', async () => {
    const nId = createHandoffId();
    const nRef = handoffRef(nId);
    await beginHandoff(nRef, { state: S, codeVerifier: V, native: true, popup: true, openerOrigin: 'https://bpm.grantzou.com' });
    const doc = await readHandoff(nRef);
    expect(doc?.popup).toBeUndefined();
    expect(doc?.openerOrigin).toBeUndefined();
  });

  it('completion restarts the clock, so there is time to type', async () => {
    const t0 = 1_000_000;
    const lateId = createHandoffId();
    const lateRef = handoffRef(lateId);
    await beginHandoff(lateRef, { state: S, codeVerifier: V }, t0);
    const completedAt = t0 + HANDOFF_TTL_MS - 1000;
    const done = await completeHandoff(lateRef, 'member-4', completedAt);
    const typedAt = t0 + HANDOFF_TTL_MS + 60_000;
    expect(await claimHandoff(lateId, typedAt, typed(done))).toEqual({ status: 'ready', memberId: 'member-4' });
  });
});

/**
 * GUARANTEE 4 — a new provider identity is named in the APP. The stash holds
 * the verified facts; only a claim with the code gets them.
 */
describe('a new identity parked for the app to name', () => {
  const facts = { provider: 'google' as const, sub: 'g-sub-1', email: 'new@example.com', emailVerified: true, suggestedName: null };

  it('claims as needs_name with the facts, once, and only with the code', async () => {
    const id = createHandoffId();
    const ref = handoffRef(id);
    await beginHandoff(ref, { state: S, codeVerifier: V, groupId: 'club-x' });
    const done = await completeHandoff(ref, { pending: facts });
    expect(await claimHandoff(id)).toEqual({ status: 'code_required', wrong: false });
    expect(await claimHandoff(id, Date.now(), typed(done))).toEqual({ status: 'needs_name', pending: facts, groupId: 'club-x' });
    expect(await claimHandoff(id, Date.now(), typed(done))).toEqual({ status: 'none' });
  });
});
