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
 * Mint a handoff and return the REF to put on the start URL.
 *
 * Returns null when the platform cannot support it — `crypto.subtle` is absent
 * on insecure origins, and localStorage throws in some privacy modes. Both are
 * non-fatal by design: the caller simply omits `?hr=` and the flow degrades to
 * the cookie path, which is what every single-jar browser uses anyway.
 */
export async function beginHandoff(): Promise<string | null> {
  try {
    if (!crypto?.subtle) return null;
    const id = hex(crypto.getRandomValues(new Uint8Array(32)));
    const ref = await sha256Hex(id);
    localStorage.setItem(KEY, id);
    return ref;
  } catch {
    return null;
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
  } catch {
    /* nothing to do — a stash we cannot clear expires server-side anyway */
  }
}

export type ClaimOutcome =
  | { status: 'ready'; name: string }
  | { status: 'pending' }
  | { status: 'none' };

/**
 * Redeem a completed sign-in into THIS context.
 *
 * `pending` means the excursion has not finished — keep the id and try again.
 * Anything else is terminal and clears the id, so a dead handoff cannot make
 * the app poll forever.
 */
export async function claimPendingHandoff(): Promise<ClaimOutcome> {
  const handoffId = pendingHandoffId();
  if (!handoffId) return { status: 'none' };
  try {
    const res = await fetch(`${BASE}/api/auth/handoff/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ handoffId }),
      cache: 'no-store',
    });
    if (!res.ok) {
      // A 4xx/5xx is not proof the handoff is dead (it could be a rate limit or
      // a cold start), so KEEP the id and let the next attempt decide.
      return { status: 'pending' };
    }
    const data = (await res.json()) as { status?: string; name?: string };
    if (data.status === 'ready' && typeof data.name === 'string') {
      clearHandoff();
      return { status: 'ready', name: data.name };
    }
    if (data.status === 'pending') return { status: 'pending' };
    clearHandoff();
    return { status: 'none' };
  } catch {
    // Offline or interrupted. Same reasoning as a non-OK response.
    return { status: 'pending' };
  }
}
