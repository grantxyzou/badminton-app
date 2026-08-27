/**
 * Transient CSRF-state and PKCE cookies for the provider handshakes.
 *
 * These are NOT sessions. They live ~10 minutes, carry a random value and
 * nothing else, and are deleted the moment the callback runs.
 *
 * THE SAMESITE SPLIT IS THE WHOLE POINT OF THIS MODULE
 * ----------------------------------------------------
 * Google's callback is a top-level GET navigation from accounts.google.com, so
 * `Lax` is sent and is the right choice.
 *
 * Apple's callback uses `response_mode=form_post` — a cross-site POST — and a
 * cross-site POST strips even `Lax`. Apple therefore requires
 * `SameSite=None`, which the spec requires to be paired with `Secure`.
 *
 * The consequence is operational, not theoretical: **the Apple flow cannot be
 * exercised over `http://localhost`.** A Secure cookie is not stored on a plain
 * HTTP origin, so the state cookie never comes back and every attempt dies as
 * a state mismatch. Apple also refuses to register a localhost Return URL, so
 * this is consistent with the provider's own rules. Test Apple against an https
 * tunnel or in production behind the flag. Google is testable locally.
 *
 * WHY STATE IS A COOKIE AND NOT SERVER STATE
 * ------------------------------------------
 * The `state` parameter defends against login CSRF: an attacker completing an
 * authorization flow in YOUR browser so you end up signed into THEIR account.
 * That defence works by binding the value to the browser that started the flow.
 * Storing it server-side keyed by a random id and skipping the cookie would
 * make the value unbindable — anyone holding the id could complete the flow —
 * so the cookie is load-bearing, not incidental.
 */
import { NextRequest, NextResponse } from 'next/server';
import { randomBytes, timingSafeEqual } from 'crypto';

export const STATE_COOKIE = 'bpm_oauth_state';
export const VERIFIER_COOKIE = 'bpm_oauth_verifier';

const TTL_S = 10 * 60;
const COOKIE_PATH = '/bpm';

export type CallbackMode = 'redirect' | 'form_post';

export function createState(): string {
  return randomBytes(32).toString('hex');
}

/** RFC 7636 code_verifier: 43-128 chars from the unreserved set. */
export function createCodeVerifier(): string {
  return randomBytes(32).toString('base64url');
}

function options(mode: CallbackMode) {
  const crossSitePost = mode === 'form_post';
  return {
    httpOnly: true as const,
    // See the module docblock: a form_post callback strips Lax, so Apple needs
    // None — and None is only honoured alongside Secure.
    sameSite: crossSitePost ? ('none' as const) : ('lax' as const),
    secure: crossSitePost || process.env.NODE_ENV === 'production',
    maxAge: TTL_S,
    path: COOKIE_PATH,
  };
}

export function setOAuthCookies(
  res: NextResponse,
  mode: CallbackMode,
  values: { state: string; codeVerifier?: string },
): void {
  const opts = options(mode);
  res.cookies.set(STATE_COOKIE, values.state, opts);
  if (values.codeVerifier) res.cookies.set(VERIFIER_COOKIE, values.codeVerifier, opts);
}

export function readOAuthCookies(req: NextRequest): {
  state: string | null;
  codeVerifier: string | null;
} {
  return {
    state: req.cookies.get(STATE_COOKIE)?.value ?? null,
    codeVerifier: req.cookies.get(VERIFIER_COOKIE)?.value ?? null,
  };
}

/** Delete both. Called on every callback, success or failure. */
export function clearOAuthCookies(res: NextResponse): void {
  for (const name of [STATE_COOKIE, VERIFIER_COOKIE]) {
    res.cookies.set(name, '', { httpOnly: true, path: COOKIE_PATH, maxAge: 0 });
  }
}

/**
 * Constant-time state comparison. Returns false for any absent or
 * length-mismatched pair rather than throwing, so a malformed callback is a
 * clean rejection.
 */
export function verifyState(cookieState: string | null, callbackState: string | null): boolean {
  if (!cookieState || !callbackState) return false;
  const a = Buffer.from(cookieState, 'utf8');
  const b = Buffer.from(callbackState, 'utf8');
  if (a.length !== b.length || a.length === 0) return false;
  return timingSafeEqual(a, b);
}
