'use client';

/**
 * The in-app half of the iOS-PWA sign-in handoff. See lib/authHandoff.ts for
 * the measurement and the security argument; this file only moves the secret.
 *
 * THE ONE RULE: the id NEVER leaves this device except in the claim body.
 * Only its sha256 goes into the URL, because the URL travels through Google,
 * the address bar, referer headers and our own logs.
 *
 * localStorage — not sessionStorage — because the excursion may evict the PWA
 * entirely (the same iOS behaviour `lib/excursion.ts` exists for). A session
 * store would be gone by the time the person walks back to the app, which is
 * precisely when we need to read it.
 */
const KEY = 'badminton_auth_handoff';
/** The native return code, written by NativeBridge when `bpm://auth/return?c=` opens the app. */
const RETURN_KEY = 'badminton_auth_handoff_return';
const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/** Mirrors the server's regex — a malformed value should never reach a fetch. */
const HEX64 = /^[0-9a-f]{64}$/;

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return hex(new Uint8Array(digest));
}

/**
 * Mint a handoff pair WITHOUT storing it.
 *
 * Deliberately does not touch localStorage. The ref is needed at render time to
 * build the `href`, but writing the id then would clobber a handoff that is
 * still in flight: the component remounts when the person returns from the
 * excursion, and a fresh mint would orphan the very stash they came back to
 * collect. Found in a browser, not in a unit test — the remount only happens
 * on a real return.
 *
 * Returns null when the platform cannot support it — `crypto.subtle` is absent
 * on insecure origins. Non-fatal by design: the caller omits `?hr=` and the
 * flow degrades to the cookie path, which every single-jar browser uses anyway.
 */
export async function mintHandoff(): Promise<{ id: string; ref: string } | null> {
  try {
    if (!crypto?.subtle) return null;
    const id = hex(crypto.getRandomValues(new Uint8Array(32)));
    return { id, ref: await sha256Hex(id) };
  } catch {
    return null;
  }
}

/**
 * Commit a minted id as THE pending handoff. Call this at the moment of the
 * tap — that is the only point at which we know a flow is actually starting,
 * and therefore the only point at which overwriting the previous one is right.
 */
export function stageHandoff(id: string): void {
  try {
    localStorage.setItem(KEY, id);
    // A code belongs to the flow that minted it; a new flow must not send it.
    localStorage.removeItem(RETURN_KEY);
  } catch {
    /* privacy mode — the flow degrades to the cookie path */
  }
}

export function pendingHandoffId(): string | null {
  try {
    const v = localStorage.getItem(KEY);
    return v && HEX64.test(v) ? v : null;
  } catch {
    return null;
  }
}

export function clearHandoff(): void {
  try {
    localStorage.removeItem(KEY);
    localStorage.removeItem(RETURN_KEY);
  } catch {
    /* nothing to do — a stash we cannot clear expires server-side anyway */
  }
}

/**
 * THE NATIVE RETURN CODE. A stash the native shell started cannot be claimed
 * with the preimage alone (lib/authHandoff.ts, guarantee 3); the code is minted
 * in the system browser sheet that completed the sign-in and travels home in
 * `bpm://auth/return?c=`. NativeBridge hands it here, in the APP's storage.
 */
export function rememberReturnCode(code: string): void {
  if (!HEX64.test(code)) return;
  try {
    localStorage.setItem(RETURN_KEY, code);
  } catch {
    /* the claim stays pending and the stash expires */
  }
}

function pendingReturnCode(): string | null {
  try {
    const v = localStorage.getItem(RETURN_KEY);
    return v && HEX64.test(v) ? v : null;
  } catch {
    return null;
  }
}

/**
 * The link from the sheet's landing back into the app, carrying the return
 * code when this sign-in minted one. Both signed-in and signed-out shells, and
 * the name step, build it here so the three cannot disagree on the shape.
 */
export function nativeReturnHref(code: string | null): string {
  return code && HEX64.test(code) ? `bpm://auth/return?c=${code}` : 'bpm://auth/return';
}

/**
 * The return code a landing carries in its fragment (`#hc=`). Fragment, not
 * query, because a query reaches the server's logs. PURE on purpose: both
 * landing effects rebuild the URL from a copy taken at their start, so the
 * caller strips it (`cleaned.hash = ''`) in that same single `replaceState` —
 * stripping here would be undone by theirs.
 */
export function readReturnCodeFromHash(hash: string): string | null {
  const match = /(?:^#|&)hc=([0-9a-f]{64})(?:&|$)/.exec(hash);
  return match ? match[1] : null;
}

// ── The pop-up (installed iOS web app) ──────────────────────────────────────

/** `postMessage` types between the sign-in pop-up and the app that opened it. */
export const HANDOFF_MESSAGE = 'bpm-handoff';
export const HANDOFF_ACK = 'bpm-handoff-ack';

/** The window `openSignInPopup` opened. Its messages are the only ones heard. */
let popup: Window | null = null;
let listening = false;

/**
 * Open a Google/Apple sign-in in a POP-UP, from the installed iOS web app.
 *
 * Why: a full-page trip leaves the home-screen app for Safari, and iOS gives
 * Safari no way back in, so the only thing that can carry the sign-in home is
 * a person typing a code. A pop-up keeps `window.opener`, so its landing
 * (`/bpm/auth/done`) can post the return code straight back — measured on an
 * iPhone before this was built (spike #428).
 *
 * MUST run synchronously inside the tap, or the pop-up is blocked. `false`
 * means it was blocked; the caller falls back to the full-page trip, which
 * ends in a typed code. A window that opened is NOT proof it will report back
 * either — the claim asks for the typed code whenever no message arrived.
 */
export function openSignInPopup(url: string): boolean {
  let opened: Window | null = null;
  try {
    // NOT `noopener`: the opener is the whole channel.
    opened = window.open(url, 'bpm-signin');
  } catch {
    opened = null;
  }
  if (!opened) return false;
  popup = opened;
  if (!listening) {
    window.addEventListener('message', onPopupMessage);
    listening = true;
  }
  return true;
}

/**
 * The pop-up's report. Believed only from the WINDOW WE OPENED — its origin
 * is ours but may not be this page's (the Azure host vs APP_ORIGIN), so the
 * source is the check that means something. Exported for tests.
 */
export function onPopupMessage(event: Pick<MessageEvent, 'source' | 'origin' | 'data'>): void {
  if (!popup || event.source !== popup) return;
  const data = event.data as { type?: unknown; returnCode?: unknown } | null;
  if (!data || data.type !== HANDOFF_MESSAGE || typeof data.returnCode !== 'string') return;
  if (!HEX64.test(data.returnCode)) return;
  rememberReturnCode(data.returnCode);
  try {
    (event.source as Window).postMessage({ type: HANDOFF_ACK }, event.origin);
  } catch {
    /* the pop-up shows its typed code instead; the claim below still works */
  }
  popup = null;
  // The same nudge the native shell uses: collect now, not on the next focus.
  window.dispatchEvent(new Event('bpm:resume'));
}

/** What `/bpm/auth/done` finds in its fragment. */
export interface HandoffLanding {
  returnCode: string | null;
  /** Where to post `returnCode`; always an http(s) origin, never a URL. */
  openerOrigin: string | null;
  typedCode: string | null;
}

/** PURE. The page strips the fragment itself, in one `replaceState`. */
export function readHandoffLanding(hash: string): HandoffLanding {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const hc = params.get('hc');
  const ho = params.get('ho');
  const tc = params.get('tc');
  let openerOrigin: string | null = null;
  if (ho) {
    try {
      const url = new URL(ho);
      if ((url.protocol === 'https:' || url.protocol === 'http:') && url.origin === ho) openerOrigin = ho;
    } catch {
      /* not an origin */
    }
  }
  return {
    returnCode: hc && HEX64.test(hc) ? hc : null,
    openerOrigin,
    typedCode: tc && /^[0-9]{6}$/.test(tc) ? tc : null,
  };
}

export type ClaimOutcome =
  | { status: 'ready'; name: string }
  /** A new Google/Apple identity; the app's pending-signup cookie is now set. */
  | { status: 'needs_name' }
  | { status: 'code_required'; wrong: boolean }
  /** Too many tries on this sign-in for now — not a cold start, and worth saying so. */
  | { status: 'rate_limited' }
  | { status: 'pending' }
  | { status: 'none' };

/**
 * Redeem a completed sign-in into THIS context.
 *
 * `pending` means the excursion has not finished — keep the id and try again.
 * Anything else is terminal and clears the id, so a dead handoff cannot make
 * the app poll forever.
 */
export async function claimPendingHandoff(typedCode?: string): Promise<ClaimOutcome> {
  const handoffId = pendingHandoffId();
  if (!handoffId) return { status: 'none' };
  const returnCode = pendingReturnCode();
  try {
    const res = await fetch(`${BASE}/api/auth/handoff/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        handoffId,
        ...(returnCode ? { returnCode } : {}),
        ...(typedCode ? { typedCode } : {}),
      }),
      cache: 'no-store',
    });
    if (res.status === 429) return { status: 'rate_limited' };
    if (!res.ok) {
      // A 4xx/5xx is not proof the handoff is dead (it could be a rate limit or
      // a cold start), so KEEP the id and let the next attempt decide.
      return { status: 'pending' };
    }
    const data = (await res.json()) as { status?: string; name?: string; wrong?: boolean };
    if (data.status === 'ready' && typeof data.name === 'string') {
      clearHandoff();
      return { status: 'ready', name: data.name };
    }
    if (data.status === 'needs_name') {
      clearHandoff();
      return { status: 'needs_name' };
    }
    if (data.status === 'code_required') return { status: 'code_required', wrong: data.wrong === true };
    if (data.status === 'pending') return { status: 'pending' };
    clearHandoff();
    return { status: 'none' };
  } catch {
    // Offline or interrupted. Same reasoning as a non-OK response.
    return { status: 'pending' };
  }
}
