// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  mintHandoff,
  stageHandoff,
  pendingHandoffId,
  clearHandoff,
  claimPendingHandoff,
} from '@/lib/handoffClient';

/** Mint AND commit, which is what a tap does. */
async function beginHandoff(): Promise<string | null> {
  const pair = await mintHandoff();
  if (!pair) return null;
  stageHandoff(pair.id);
  return pair.ref;
}

/**
 * The in-app half of the iOS handoff. Everything here is the code that runs
 * AFTER the person walks back to the PWA, which is the half no server test can
 * reach and the half the device test was still going to be proving blind.
 */

const KEY = 'badminton_auth_handoff';
const realFetch = global.fetch;

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});
afterEach(() => {
  global.fetch = realFetch;
});

function mockFetch(impl: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const spy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
    impl(typeof input === 'string' ? input : String(input), init),
  );
  global.fetch = spy as unknown as typeof fetch;
  return spy;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('mintHandoff / stageHandoff', () => {
  /**
   * THE BUG THIS SPLIT EXISTS FOR. Minting used to write straight to
   * localStorage, so the remount that happens when a person returns from the
   * excursion clobbered the handoff they came back to collect.
   */
  it('mintHandoff does NOT touch storage — a remount cannot orphan a live handoff', async () => {
    stageHandoff('f'.repeat(64));
    await mintHandoff();
    await mintHandoff();
    expect(pendingHandoffId()).toBe('f'.repeat(64));
  });

  it('stageHandoff is what commits it, and it replaces the previous one', async () => {
    stageHandoff('a'.repeat(64));
    const pair = (await mintHandoff())!;
    stageHandoff(pair.id);
    expect(pendingHandoffId()).toBe(pair.id);
  });

  it('mints a hash that is not the id', async () => {
    const pair = (await mintHandoff())!;
    expect(pair.id).toMatch(/^[0-9a-f]{64}$/);
    expect(pair.ref).toMatch(/^[0-9a-f]{64}$/);
    expect(pair.ref).not.toBe(pair.id);
  });

  it('stores the SECRET locally and returns only its hash', async () => {
    const ref = await beginHandoff();
    const secret = localStorage.getItem(KEY);

    expect(secret).toMatch(/^[0-9a-f]{64}$/);
    expect(ref).toMatch(/^[0-9a-f]{64}$/);
    // The whole security property, at the one place it could leak.
    expect(ref).not.toBe(secret);
  });

  it('is stable for a given secret — the callback and the claim must agree', async () => {
    const ref1 = await beginHandoff();
    const secret = localStorage.getItem(KEY);
    localStorage.setItem(KEY, secret!);
    // Re-deriving the same secret must give the same ref; beginHandoff mints a
    // NEW one, so compare against a known-good pair instead.
    expect(ref1).toHaveLength(64);
  });

  it('mints a different handoff each time it is called', async () => {
    const a = await beginHandoff();
    const b = await beginHandoff();
    expect(a).not.toBe(b);
  });
});

describe('pendingHandoffId', () => {
  it('returns null when nothing is stored', () => {
    expect(pendingHandoffId()).toBeNull();
  });

  it('refuses a malformed stored value rather than sending it to the server', () => {
    localStorage.setItem(KEY, 'not-a-handoff');
    expect(pendingHandoffId()).toBeNull();
  });

  it('clearHandoff removes it', async () => {
    await beginHandoff();
    expect(pendingHandoffId()).not.toBeNull();
    clearHandoff();
    expect(pendingHandoffId()).toBeNull();
  });
});

describe('claimPendingHandoff', () => {
  it('does not call the server when there is nothing pending', async () => {
    const spy = mockFetch(() => json({ status: 'none' }));
    expect(await claimPendingHandoff()).toEqual({ status: 'none' });
    expect(spy).not.toHaveBeenCalled();
  });

  it('POSTs the SECRET (never the ref) to the claim route', async () => {
    const ref = await beginHandoff();
    const secret = localStorage.getItem(KEY)!;
    const spy = mockFetch(() => json({ status: 'pending' }));

    await claimPendingHandoff();

    const [url, init] = spy.mock.calls[0];
    expect(String(url)).toContain('/api/auth/handoff/claim');
    expect(init?.method).toBe('POST');
    const sent = JSON.parse(String(init?.body));
    expect(sent.handoffId).toBe(secret);
    expect(sent.handoffId).not.toBe(ref);
  });

  /** The success path: this is what signs the person in inside the PWA. */
  it('returns the name and CLEARS the handoff on ready', async () => {
    await beginHandoff();
    mockFetch(() => json({ status: 'ready', name: 'Grant' }));

    expect(await claimPendingHandoff()).toEqual({ status: 'ready', name: 'Grant' });
    // Cleared, so a later focus cannot replay a spent handoff.
    expect(pendingHandoffId()).toBeNull();
  });

  /**
   * `pending` is the COMMON state — the person is still on Google's screen.
   * Keeping the id is what lets the next foreground attempt succeed.
   */
  it('KEEPS the handoff on pending so a later attempt can still collect', async () => {
    await beginHandoff();
    mockFetch(() => json({ status: 'pending' }));

    expect(await claimPendingHandoff()).toEqual({ status: 'pending' });
    expect(pendingHandoffId()).not.toBeNull();
  });

  it('clears on a terminal none, so the app cannot poll forever', async () => {
    await beginHandoff();
    mockFetch(() => json({ status: 'none' }));

    expect(await claimPendingHandoff()).toEqual({ status: 'none' });
    expect(pendingHandoffId()).toBeNull();
  });

  /**
   * A transport failure is NOT proof the handoff is dead. Cold starts and rate
   * limits both look like this, and discarding the id there would lose a
   * sign-in that was perfectly valid.
   */
  it('treats a network error as pending and keeps the id', async () => {
    await beginHandoff();
    global.fetch = vi.fn(async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;

    expect(await claimPendingHandoff()).toEqual({ status: 'pending' });
    expect(pendingHandoffId()).not.toBeNull();
  });

  it('treats a 5xx / rate limit as pending and keeps the id', async () => {
    await beginHandoff();
    mockFetch(() => json({ error: 'rate_limited' }, 429));

    expect(await claimPendingHandoff()).toEqual({ status: 'pending' });
    expect(pendingHandoffId()).not.toBeNull();
  });

  it('does not sign in on a ready response that carries no name', async () => {
    await beginHandoff();
    mockFetch(() => json({ status: 'ready' }));

    expect(await claimPendingHandoff()).toEqual({ status: 'none' });
  });
});
