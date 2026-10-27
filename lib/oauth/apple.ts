/**
 * Apple's half of the handshake: the authorization URL and the code exchange,
 * whose `client_secret` is an ES256 JWT signed per request with the `.p8` key.
 * Same shape and same requests as the `arctic` client it replaces —
 * `__tests__/oauth-in-house.test.ts` holds it to the recorded fixture.
 *
 * The JWT is arctic's, claim for claim and in its key order: `aud` is an
 * ARRAY and `exp` is five minutes out. That is the signer Apple accepted on
 * every production sign-in. `lib/appleRevoke.ts` signs its own (with `aud` as
 * a string) and is deliberately left alone here — it is a non-goal of the plan.
 *
 * `dsaEncoding: 'ieee-p1363'` is LOAD-BEARING, as in appleRevoke: Node's
 * default ECDSA output is DER, and a JWS ES256 signature is the raw 64-byte
 * r‖s. A DER signature fails at Apple with nothing useful in the error.
 *
 * The caller adds `response_mode=form_post` (apple/start) — required by Apple
 * whenever a scope is asked for, and arctic never set it either.
 */
import { createPrivateKey, sign } from 'node:crypto';
import { OAuthTokens, sendTokenRequest } from './tokenRequest';

const AUTHORIZATION_ENDPOINT = 'https://appleid.apple.com/auth/authorize';
const TOKEN_ENDPOINT = 'https://appleid.apple.com/auth/token';

export class AppleOAuth {
  constructor(
    private readonly clientId: string,
    private readonly teamId: string,
    private readonly keyId: string,
    private readonly pkcs8PrivateKey: Uint8Array,
    private readonly redirectURI: string,
  ) {}

  createAuthorizationURL(state: string, scopes: string[]): URL {
    const url = new URL(AUTHORIZATION_ENDPOINT);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', this.clientId);
    url.searchParams.set('state', state);
    if (scopes.length > 0) url.searchParams.set('scope', scopes.join(' '));
    url.searchParams.set('redirect_uri', this.redirectURI);
    return url;
  }

  validateAuthorizationCode(code: string): Promise<OAuthTokens> {
    const body = new URLSearchParams();
    body.set('grant_type', 'authorization_code');
    body.set('code', code);
    body.set('redirect_uri', this.redirectURI);
    body.set('client_id', this.clientId);
    body.set('client_secret', this.createClientSecret());
    return sendTokenRequest(TOKEN_ENDPOINT, body);
  }

  createClientSecret(nowMs: number = Date.now()): string {
    const now = Math.floor(nowMs / 1000);
    const header = JSON.stringify({ typ: 'JWT', alg: 'ES256', kid: this.keyId });
    const payload = JSON.stringify({ iss: this.teamId, exp: now + 5 * 60, aud: ['https://appleid.apple.com'], sub: this.clientId, iat: now });
    const signingInput = `${Buffer.from(header).toString('base64url')}.${Buffer.from(payload).toString('base64url')}`;
    const key = createPrivateKey({ key: Buffer.from(this.pkcs8PrivateKey), format: 'der', type: 'pkcs8' });
    const signature = sign('sha256', Buffer.from(signingInput), { key, dsaEncoding: 'ieee-p1363' });
    return `${signingInput}.${signature.toString('base64url')}`;
  }
}
