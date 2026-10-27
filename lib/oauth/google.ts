/**
 * Google's half of the handshake: the authorization URL (with a PKCE S256
 * challenge) and the code exchange. Same shape and same requests as the
 * `arctic` client it replaces — `__tests__/oauth-in-house.test.ts` holds it
 * to the recorded fixture.
 *
 * The client credentials ride in an HTTP Basic header, not the form body,
 * exactly as arctic sent them (RFC 6749 §2.3.1).
 */
import { createHash } from 'node:crypto';
import { OAuthTokens, sendTokenRequest } from './tokenRequest';

const AUTHORIZATION_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

/** base64url(SHA-256(verifier)), no padding — the S256 challenge (RFC 7636 §4.2). */
export function s256Challenge(codeVerifier: string): string {
  return createHash('sha256').update(codeVerifier).digest('base64url');
}

export class GoogleOAuth {
  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly redirectURI: string,
  ) {}

  createAuthorizationURL(state: string, codeVerifier: string, scopes: string[]): URL {
    const url = new URL(AUTHORIZATION_ENDPOINT);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', this.clientId);
    url.searchParams.set('redirect_uri', this.redirectURI);
    url.searchParams.set('state', state);
    url.searchParams.set('code_challenge_method', 'S256');
    url.searchParams.set('code_challenge', s256Challenge(codeVerifier));
    if (scopes.length > 0) url.searchParams.set('scope', scopes.join(' '));
    return url;
  }

  validateAuthorizationCode(code: string, codeVerifier: string): Promise<OAuthTokens> {
    const body = new URLSearchParams();
    body.set('grant_type', 'authorization_code');
    body.set('code', code);
    body.set('redirect_uri', this.redirectURI);
    body.set('code_verifier', codeVerifier);
    const basic = Buffer.from(`${this.clientId}:${this.clientSecret}`, 'utf8').toString('base64');
    return sendTokenRequest(TOKEN_ENDPOINT, body, `Basic ${basic}`);
  }
}
