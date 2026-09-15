import { createPrivateKey, sign } from 'node:crypto';
import { pkcs8FromPem, isRealCredential } from '@/lib/oauthProviders';
import {
  identityKeyOf,
  readAppleRefreshToken,
  forgetAppleRefreshToken,
  type AuthIdentity,
} from '@/lib/authIdentity';

/**
 * Revoking a member's Sign in with Apple tokens — Apple's requirement for any
 * app that offers it and lets people delete their account. Called when an
 * account is deleted and when Apple is disconnected from one.
 *
 * WHY THE CLIENT SECRET IS SIGNED HERE AND NOT BY `arctic`
 * --------------------------------------------------------
 * `arctic` signs Apple's client-secret JWT for the code exchange, but its
 * `Apple` class has no revoke method and keeps `createClientSecret` private.
 * So this file signs the same ES256 JWT with `node:crypto`, from the same
 * `.p8` key and the same `pkcs8FromPem` decoding.
 *
 * `dsaEncoding: 'ieee-p1363'` IS LOAD-BEARING. Node's default ECDSA signature
 * is DER-encoded (~70–72 bytes); a JWS ES256 signature is the raw 64-byte
 * r||s. A DER signature makes a JWT that verifies nowhere, and Apple's only
 * feedback is a 400 on a best-effort path that logs and moves on — so the test
 * asserts the 64 bytes.
 *
 * NEVER THROWS. Every caller is deleting or disconnecting something the member
 * asked to be rid of, and a revoke failure must not stand in the way of that.
 */

const REVOKE_URL = 'https://appleid.apple.com/auth/revoke';
const AUDIENCE = 'https://appleid.apple.com';

export type RevokeOutcome = 'revoked' | 'failed' | 'not_configured' | 'no_token';

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

/** The ES256 client-secret JWT Apple's token endpoints require. Null when unconfigured. */
export function appleClientSecret(now: Date = new Date()): string | null {
  const clientId = process.env.APPLE_CLIENT_ID;
  const teamId = process.env.APPLE_TEAM_ID;
  const keyId = process.env.APPLE_KEY_ID;
  const pem = process.env.APPLE_PRIVATE_KEY;
  if (!isRealCredential(clientId) || !isRealCredential(teamId) || !isRealCredential(keyId) || !isRealCredential(pem)) {
    return null;
  }
  const der = pkcs8FromPem(pem!);
  if (!der) return null;

  const iat = Math.floor(now.getTime() / 1000);
  const header = b64url(JSON.stringify({ alg: 'ES256', kid: keyId, typ: 'JWT' }));
  const payload = b64url(
    JSON.stringify({ iss: teamId, iat, exp: iat + 5 * 60, aud: AUDIENCE, sub: clientId }),
  );
  const signingInput = `${header}.${payload}`;
  try {
    const key = createPrivateKey({ key: Buffer.from(der), format: 'der', type: 'pkcs8' });
    const signature = sign('sha256', Buffer.from(signingInput), { key, dsaEncoding: 'ieee-p1363' });
    return `${signingInput}.${b64url(signature)}`;
  } catch {
    return null;
  }
}

/** POST one refresh token to Apple's revoke endpoint. */
export async function revokeAppleToken(refreshToken: string): Promise<RevokeOutcome> {
  const clientSecret = appleClientSecret();
  if (!clientSecret) return 'not_configured';
  try {
    const body = new URLSearchParams({
      client_id: process.env.APPLE_CLIENT_ID!,
      client_secret: clientSecret,
      token: refreshToken,
      token_type_hint: 'refresh_token',
    });
    const res = await fetch(REVOKE_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (res.ok) return 'revoked';
    // A constant message with the status in the payload — never the token.
    console.error('[apple-revoke] rejected', { status: res.status });
    return 'failed';
  } catch (err) {
    console.error('[apple-revoke] request failed', { message: (err as Error)?.message });
    return 'failed';
  }
}

/**
 * Revoke the tokens behind an `apple:<sub>` identity, then forget the stored
 * token. Anything that is not an Apple identity is a no-op.
 *
 * The stored token is forgotten after EVERY attempt, failed ones included.
 * Both callers are about to delete the identity that points at it, so a kept
 * token would be a credential for a person — or a connection — that no longer
 * exists, reachable by nothing. Holding on to someone's data after they asked
 * to delete their account is the worse failure; a failed revoke is logged.
 */
export async function revokeAppleIdentity(identity: AuthIdentity): Promise<RevokeOutcome> {
  if (identity.provider !== 'apple') return 'no_token';
  try {
    const sub = identityKeyOf(identity);
    const token = await readAppleRefreshToken(sub);
    if (!token) return 'no_token';
    const outcome = await revokeAppleToken(token);
    await forgetAppleRefreshToken(sub);
    return outcome;
  } catch (err) {
    console.error('[apple-revoke] identity revoke failed', { message: (err as Error)?.message });
    return 'failed';
  }
}
