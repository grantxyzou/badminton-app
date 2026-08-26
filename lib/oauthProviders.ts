/**
 * Lazily-constructed `arctic` clients for Google and Apple.
 *
 * `arctic` is used for the HANDSHAKE ONLY — it builds the authorization URL and
 * exchanges the code. It has no opinion about sessions, storage or users, which
 * is exactly why it was chosen: `member_session` stays the session of record,
 * so `isAdminAuthedWithMember`'s live Cosmos role re-check keeps working and
 * the mock-store test harness is untouched. A library that wanted to own the
 * session (Auth.js) would have to run alongside that, not replace it.
 *
 * CONFIGURED-OR-NOT IS A FIRST-CLASS STATE. Both providers return `null` when
 * their environment variables are absent, so a deployment with Google set up
 * but not Apple shows one button instead of failing when the second is tapped.
 * That is the legible-fail posture applied to configuration.
 */
import { Google, Apple } from 'arctic';
import { requireRedirectOrigin } from '@/lib/appOrigin';

export type ProviderName = 'google' | 'apple';

/** Absolute callback URL. Must match the provider console byte for byte. */
export function redirectUri(provider: ProviderName, origin: string): string {
  return `${origin}/bpm/api/auth/${provider}/callback`;
}

/**
 * Origin for building a `redirect_uri`. Delegates to the strict helper — see
 * lib/appOrigin.ts for why the request is never consulted. The `fallbackUrl`
 * parameter is retained so call sites read the same, but is deliberately
 * unused.
 */
export function appOrigin(_fallbackUrl: string): string {
  return requireRedirectOrigin();
}

export function googleClient(origin: string): Google | null {
  const id = process.env.GOOGLE_CLIENT_ID;
  const secret = process.env.GOOGLE_CLIENT_SECRET;
  if (!id || !secret) return null;
  return new Google(id, secret, redirectUri('google', origin));
}

/**
 * Apple's `client_secret` is an ES256 JWT signed with a `.p8` key, with a
 * 6-month maximum lifetime. `arctic` generates it internally per request from
 * the key, so there is nothing to rotate on a schedule — the reason to take
 * this dependency at all, since hand-rolling that JWT is the most error-prone
 * part of Sign in with Apple.
 *
 * `APPLE_PRIVATE_KEY` holds the PEM with literal `\n` escapes (env vars cannot
 * carry real newlines), so they are converted back before parsing.
 */
export function appleClient(origin: string): Apple | null {
  const clientId = process.env.APPLE_CLIENT_ID;
  const teamId = process.env.APPLE_TEAM_ID;
  const keyId = process.env.APPLE_KEY_ID;
  const pem = process.env.APPLE_PRIVATE_KEY;
  if (!clientId || !teamId || !keyId || !pem) return null;

  const der = pkcs8FromPem(pem);
  if (!der) return null;
  return new Apple(clientId, teamId, keyId, der, redirectUri('apple', origin));
}

/** Strips the PEM armour and base64-decodes to the DER bytes arctic expects. */
function pkcs8FromPem(pem: string): Uint8Array | null {
  const body = pem
    .replace(/\\n/g, '\n')
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s+/g, '');
  if (!body) return null;
  try {
    return new Uint8Array(Buffer.from(body, 'base64'));
  } catch {
    return null;
  }
}

/** Which providers this deployment can actually offer. Drives the UI buttons. */
export function configuredProviders(): ProviderName[] {
  const out: ProviderName[] = [];
  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) out.push('google');
  if (
    process.env.APPLE_CLIENT_ID &&
    process.env.APPLE_TEAM_ID &&
    process.env.APPLE_KEY_ID &&
    process.env.APPLE_PRIVATE_KEY
  ) {
    out.push('apple');
  }
  return out;
}

/**
 * Reads the `sub` / `email` / `email_verified` claims out of an id_token.
 *
 * DELIBERATELY DOES NOT VERIFY THE SIGNATURE, and that is safe here for one
 * specific reason: this token was just obtained by a direct server-to-server
 * TLS call to the provider's own token endpoint, so TLS already authenticates
 * the issuer. OIDC Core §3.1.3.7 note 2 permits skipping verification in
 * exactly this case.
 *
 * If a flow is ever added that receives an id_token from the BROWSER, it must
 * verify against the provider JWKS instead. Do not reuse this function there.
 */
export function decodeIdTokenClaims(idToken: string): {
  sub: string | null;
  email: string | null;
  emailVerified: boolean;
} {
  const empty = { sub: null, email: null, emailVerified: false };
  const parts = idToken.split('.');
  if (parts.length !== 3) return empty;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as {
      sub?: unknown;
      email?: unknown;
      email_verified?: unknown;
    };
    const sub = typeof payload.sub === 'string' && payload.sub ? payload.sub : null;
    const email = typeof payload.email === 'string' && payload.email ? payload.email : null;
    // Apple sends this as the STRING "true"; Google sends a real boolean.
    const emailVerified =
      payload.email_verified === true || payload.email_verified === 'true';
    return { sub, email, emailVerified };
  } catch {
    return empty;
  }
}
