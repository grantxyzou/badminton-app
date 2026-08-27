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
