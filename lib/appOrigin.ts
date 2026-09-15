/**
 * The absolute origin used to build links that LEAVE this app.
 *
 * WHY THIS IS NOT `new URL(req.url).origin`
 * -----------------------------------------
 * `req.url` is derived from the incoming `Host` / `X-Forwarded-Host` header,
 * which the client controls. Deriving an emailed link's origin from it is
 * host-header injection, and for the password-reset mail it is a full account
 * takeover:
 *
 *   1. Attacker POSTs /api/auth/forgot-password with the victim's address and
 *      `Host: evil.example`.
 *   2. The victim receives a GENUINE email from BPM — right sender, right
 *      wording, real reset token — whose link points at evil.example.
 *   3. Victim taps it. The attacker now holds a valid single-use reset token
 *      and sets a new password on the victim's account.
 *
 * Nothing in that chain looks wrong to the victim, which is what makes it
 * worth failing closed over.
 *
 * So: `APP_ORIGIN` is REQUIRED for any outbound link. The request is never
 * consulted. The dev fallback is deliberately narrow — only `NODE_ENV` of
 * `development` or `test`, never merely "not production" — mirroring
 * `getSessionSecret()` in lib/auth.ts, which fails closed for exactly the same
 * reason: an internet-facing host booted with an unset or unexpected NODE_ENV
 * must not silently take the insecure branch.
 */

const DEV_FALLBACK = 'http://localhost:3000';

function isLocalEnv(): boolean {
  const env = process.env.NODE_ENV;
  return env === 'development' || env === 'test';
}

/**
 * Origin for an emailed or otherwise externally-delivered link.
 *
 * THROWS when `APP_ORIGIN` is unset outside local development. Callers that
 * must not fail the whole request (e.g. forgot-password, which always answers
 * 200 so it cannot be used to enumerate accounts) should use
 * {@link outboundOriginOrNull} instead and skip sending.
 */
export function requireOutboundOrigin(): string {
  const configured = process.env.APP_ORIGIN?.trim();
  if (configured) return configured.replace(/\/+$/, '');
  if (isLocalEnv()) return DEV_FALLBACK;
  throw new Error(
    'APP_ORIGIN is not set. Refusing to build an outbound link from the ' +
      'request Host header — a client-controlled origin in a password-reset ' +
      'or verification email is an account-takeover vector. ' +
      'Set APP_ORIGIN (e.g. https://bpm.grantzou.com) in the App Settings.',
  );
}

/** Non-throwing variant. Returns null rather than falling back to the request. */
export function outboundOriginOrNull(): string | null {
  try {
    return requireOutboundOrigin();
  } catch {
    return null;
  }
}

/**
 * Origin for an OAuth `redirect_uri`.
 *
 * Same rule, and the same function — but worth noting why this one is not the
 * dangerous case even though it looks identical: a `redirect_uri` must match a
 * value pre-registered in the provider console, so a host-header-derived origin
 * produces `redirect_uri_mismatch` and the flow dies. It fails closed rather
 * than leaking. It shares the strict behaviour anyway, because two rules are
 * harder to keep straight than one.
 */
export function requireRedirectOrigin(): string {
  return requireOutboundOrigin();
}

/**
 * THE ORIGINS THIS APP IS SERVED FROM, for a `postMessage` target.
 *
 * Not the same question as the ones above. A sign-in pop-up posts its return
 * code to the window that opened it, and that window may be on either of two
 * hosts: APP_ORIGIN, or the App Service's own `*.azurewebsites.net` name
 * (`WEBSITE_HOSTNAME`, set by Azure), which a home-screen app installed from
 * that address keeps using. A message aimed at the wrong origin is dropped
 * without a sound, so the opener SAYS where it is and this decides whether to
 * believe it. Anything not ours is refused: the target is what stops a page
 * that opened our pop-up from receiving the code.
 */
export function ownOriginOrNull(candidate: string | null | undefined): string | null {
  if (typeof candidate !== 'string' || !candidate) return null;
  let origin: string;
  try {
    const url = new URL(candidate);
    origin = url.origin;
    // An origin, not a URL that merely starts with one.
    if (origin !== candidate) return null;
  } catch {
    return null;
  }
  const allowed = new Set<string>();
  const app = outboundOriginOrNull();
  if (app) allowed.add(app);
  const host = process.env.WEBSITE_HOSTNAME?.trim().toLowerCase();
  if (host && /^[a-z0-9.-]+$/.test(host)) allowed.add(`https://${host}`);
  if (allowed.has(origin)) return origin;
  // Local dev runs on whatever port it was given.
  if (isLocalEnv() && /^http:\/\/localhost:\d+$/.test(origin)) return origin;
  return null;
}
