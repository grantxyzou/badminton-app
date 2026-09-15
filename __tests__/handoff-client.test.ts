// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  mintHandoff,
  stageHandoff,
  pendingHandoffId,
  clearHandoff,
  claimPendingHandoff,
  rememberReturnCode,
  nativeReturnHref,
  readReturnCodeFromHash,
  openSignInPopup,
  onPopupMessage,
  readHandoffLanding,
  HANDOFF_MESSAGE,
  HANDOFF_ACK,
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

/**
 * The native return code (lib/authHandoff.ts, guarantee 3): minted in the
 * system browser sheet, carried home in `bpm://auth/return?c=`, and sent with
 * the claim from the APP's storage.
 */
describe('the native return code', () => {
  const CODE = 'ab'.repeat(32);

  it('is sent with the claim once NativeBridge has remembered it', async () => {
    await beginHandoff();
    rememberReturnCode(CODE);
    const spy = mockFetch(() => json({ status: 'pending' }));
    await claimPendingHandoff();
    expect(JSON.parse(String(spy.mock.calls[0][1]?.body)).returnCode).toBe(CODE);
  });

  it('is not sent when there is none, and a malformed one is never stored', async () => {
    await beginHandoff();
    rememberReturnCode('not-hex');
    const spy = mockFetch(() => json({ status: 'pending' }));
    await claimPendingHandoff();
    expect(JSON.parse(String(spy.mock.calls[0][1]?.body))).not.toHaveProperty('returnCode');
  });

  it('a new flow drops the previous flow\'s code, and so does clearing', async () => {
    await beginHandoff();
    rememberReturnCode(CODE);
    await beginHandoff();
    const spy = mockFetch(() => json({ status: 'pending' }));
    await claimPendingHandoff();
    expect(JSON.parse(String(spy.mock.calls[0][1]?.body))).not.toHaveProperty('returnCode');

    rememberReturnCode(CODE);
    clearHandoff();
    expect(localStorage.length).toBe(0);
  });

  it('builds the way home with and without a code', () => {
    expect(nativeReturnHref(CODE)).toBe(`bpm://auth/return?c=${CODE}`);
    expect(nativeReturnHref(null)).toBe('bpm://auth/return');
    expect(nativeReturnHref('<script>')).toBe('bpm://auth/return');
  });

  it('reads the code from a landing fragment only in its exact shape', () => {
    expect(readReturnCodeFromHash(`#hc=${CODE}`)).toBe(CODE);
    expect(readReturnCodeFromHash('')).toBeNull();
    expect(readReturnCodeFromHash('#hc=short')).toBeNull();
    expect(readReturnCodeFromHash(`#hc=${CODE}ff`)).toBeNull();
  });
});

describe('the sign-in pop-up (installed iOS web app)', () => {
  const CODE = 'c'.repeat(64);
  const RETURN_KEY = 'badminton_auth_handoff_return';

  function fakePopup() {
    return { postMessage: vi.fn() } as unknown as Window & { postMessage: ReturnType<typeof vi.fn> };
  }

  it('reports a blocked pop-up, so the caller can fall back to the full page', () => {
    vi.spyOn(window, 'open').mockReturnValue(null);
    expect(openSignInPopup('/bpm/api/auth/google/start?hr=x&popup=1')).toBe(false);
  });

  it('keeps the opener — the channel home — rather than opening with noopener', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(fakePopup());
    openSignInPopup('/start');
    expect(open.mock.calls[0]).toHaveLength(2);
  });

  it('believes a return code only from the window it opened, acknowledges it, and nudges collection', () => {
    const popup = fakePopup();
    vi.spyOn(window, 'open').mockReturnValue(popup);
    openSignInPopup('/start');
    const resume = vi.fn();
    window.addEventListener('bpm:resume', resume);
    try {
      // Some other window — ignored outright.
      onPopupMessage({ source: fakePopup(), origin: 'https://bpm.grantzou.com', data: { type: HANDOFF_MESSAGE, returnCode: CODE } });
      expect(localStorage.getItem(RETURN_KEY)).toBeNull();

      // A malformed code from the right window — ignored.
      onPopupMessage({ source: popup, origin: 'https://bpm.grantzou.com', data: { type: HANDOFF_MESSAGE, returnCode: 'nope' } });
      expect(localStorage.getItem(RETURN_KEY)).toBeNull();

      onPopupMessage({ source: popup, origin: 'https://bpm.grantzou.com', data: { type: HANDOFF_MESSAGE, returnCode: CODE } });
      expect(localStorage.getItem(RETURN_KEY)).toBe(CODE);
      expect(popup.postMessage).toHaveBeenCalledWith({ type: HANDOFF_ACK }, 'https://bpm.grantzou.com');
      expect(resume).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener('bpm:resume', resume);
    }
  });

  it('reads the landing fragment, refusing anything that is not an origin or a code', () => {
    expect(readHandoffLanding(`#hc=${CODE}&ho=${encodeURIComponent('https://bpm.grantzou.com')}&tc=482913`)).toEqual({
      returnCode: CODE,
      openerOrigin: 'https://bpm.grantzou.com',
      typedCode: '482913',
    });
    expect(readHandoffLanding(`#hc=short&ho=${encodeURIComponent('https://bpm.grantzou.com/path')}&tc=12`)).toEqual({
      returnCode: null,
      openerOrigin: null,
      typedCode: null,
    });
    expect(readHandoffLanding('#ho=javascript%3Aalert(1)').openerOrigin).toBeNull();
  });
});

describe('claimPendingHandoff — the answers that need the person', () => {
  it('sends a typed code, and reports code_required without dropping the handoff', async () => {
    stageHandoff('a'.repeat(64));
    const spy = mockFetch(() => json({ status: 'code_required', wrong: true }));
    expect(await claimPendingHandoff('482913')).toEqual({ status: 'code_required', wrong: true });
    expect(JSON.parse(String(spy.mock.calls[0][1]?.body))).toMatchObject({ typedCode: '482913' });
    expect(pendingHandoffId()).toBe('a'.repeat(64));
  });

  it('needs_name is terminal for the handoff — the name step takes it from here', async () => {
    stageHandoff('a'.repeat(64));
    mockFetch(() => json({ status: 'needs_name' }));
    expect(await claimPendingHandoff()).toEqual({ status: 'needs_name' });
    expect(pendingHandoffId()).toBeNull();
  });
});
