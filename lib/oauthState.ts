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
  return classifyState(cookieState, callbackState) === 'ok';
}

/**
 * WHY a state check failed — the two cases are different bugs and
 * `state_mismatch` alone cannot tell them apart.
 *
 *   `cookie_absent`   the callback carried no state cookie. On an installed
 *                     iOS PWA this is the signature of the COOKIE-JAR SPLIT:
 *                     the excursion to the provider leaves the app's WKWebView,
 *                     so the callback is issued by Safari, which never saw the
 *                     cookie `/start` set inside the PWA. Architectural — no
 *                     amount of cookie-attribute tuning fixes it.
 *   `param_absent`    the provider sent no `state` back at all. Provider-side
 *                     or a hand-crafted URL.
 *   `differs`         both present, different values. Same jar, wrong value —
 *                     a stale cookie, two flows raced, or a genuine CSRF
 *                     attempt. Needs nothing architectural.
 *
 * The distinction is the whole diagnostic: it decides whether the fix is a
 * bridge across storage contexts or a one-line cookie change.
 */
export type StateFailure = 'cookie_absent' | 'param_absent' | 'differs';

export function classifyState(
  cookieState: string | null,
  callbackState: string | null,
): 'ok' | StateFailure {
  // Order matters: report the MISSING COOKIE even when the param is also
  // absent, because that is the signal that discriminates the jar split.
  if (!cookieState) return 'cookie_absent';
  if (!callbackState) return 'param_absent';
  const a = Buffer.from(cookieState, 'utf8');
  const b = Buffer.from(callbackState, 'utf8');
  if (a.length !== b.length || a.length === 0) return 'differs';
  return timingSafeEqual(a, b) ? 'ok' : 'differs';
}

/**
 * A one-line, secret-free description of what actually reached the callback.
 *
 * NAMES ONLY, never values — a state or session cookie value in a log is a
 * credential in a log. `Sec-Fetch-Site` is the decider alongside the cookie
 * list: `cross-site` with ZERO cookies from our own origin proves the request
 * came from a storage context that has never talked to us, which is exactly
 * the jar split. Some cookies but no state is a different story entirely.
 */
export function describeCallbackContext(req: NextRequest): string {
  const names = req.cookies.getAll().map((c) => c.name).sort();
  const h = (k: string) => req.headers.get(k) ?? '-';
  // Truncated: a full iOS UA is ~140 chars of version noise and the useful
  // part (platform, Safari/WebKit build) is at the front.
  const ua = (req.headers.get('user-agent') ?? '-').slice(0, 120);
  return [
    `cookies=[${names.join(',') || 'NONE'}]`,
    `count=${names.length}`,
    `sec-fetch-site=${h('sec-fetch-site')}`,
    `sec-fetch-mode=${h('sec-fetch-mode')}`,
    `sec-fetch-dest=${h('sec-fetch-dest')}`,
    `referer=${h('referer').slice(0, 60)}`,
    `ua=${ua}`,
  ].join(' ');
}
