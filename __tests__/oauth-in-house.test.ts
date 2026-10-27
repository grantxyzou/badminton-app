/**
 * The in-house Google and Apple handshake (`lib/oauth/`) against the requests
 * `arctic` 3.7.0 sent on every production sign-in until it was replaced,
 * recorded in `fixtures/oauth-arctic-requests.json` while it was still
 * installed (docs/plans/oauth-library-replacement.md: proven against a
 * recorded exchange, not against mocks of our own).
 *
 * The Apple client secret is a fresh signature each time, so it is compared
 * by its decoded header and payload under a frozen clock, and its signature is
 * VERIFIED with the test key's public half: a DER-encoded signature (the
 * `dsaEncoding` trap) would fail that, where a length check alone might not.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generateKeyPairSync, verify } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { GoogleOAuth, s256Challenge } from '@/lib/oauth/google';
import { AppleOAuth } from '@/lib/oauth/apple';
import { OAuthRequestError } from '@/lib/oauth/tokenRequest';

const F = JSON.parse(readFileSync(path.join(__dirname, 'fixtures/oauth-arctic-requests.json'), 'utf8'));

interface Captured { url: string; method: string; headers: Record<string, string>; body: string }
let captured: Captured[] = [];
let reply: () => Response;

beforeEach(() => {
  captured = [];
  reply = () => new Response(JSON.stringify({ access_token: 'a', token_type: 'Bearer', expires_in: 3600, id_token: 'h.p.s', refresh_token: 'r' }), { status: 200 });
  vi.stubGlobal('fetch', async (req: Request) => {
    captured.push({ url: req.url, method: req.method, headers: Object.fromEntries([...req.headers.entries()].sort()), body: await req.text() });
    return reply();
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Google', () => {
  const g = F.google.inputs;
  const client = () => new GoogleOAuth(g.clientId, g.clientSecret, g.redirectURI);

  it('builds the same authorization URL, PKCE challenge included', () => {
    expect(client().createAuthorizationURL(g.state, g.codeVerifier, g.scopes).toString()).toBe(F.google.authorizationURL);
  });

  it('sends the same token request, byte for byte', async () => {
    await client().validateAuthorizationCode(g.code, g.codeVerifier);
    expect(captured).toEqual([F.google.tokenRequest]);
  });

  it('writes the S256 challenge as unpadded base64url (RFC 7636 appendix B)', () => {
    expect(s256Challenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });
});

describe('Apple', () => {
  const a = F.apple.inputs;
  const keys = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const der = new Uint8Array(keys.privateKey.export({ format: 'der', type: 'pkcs8' }));
  const client = () => new AppleOAuth(a.clientId, a.teamId, a.keyId, der, a.redirectURI);

  it('builds the same authorization URL', () => {
    expect(client().createAuthorizationURL(a.state, a.scopes).toString()).toBe(F.apple.authorizationURL);
  });

  it('sends the same token request, with a client secret Apple accepted', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(a.nowMs);
    await client().validateAuthorizationCode(a.code);
    const [req] = captured;
    const want = F.apple.tokenRequest;
    expect({ url: req.url, method: req.method, headers: req.headers }).toEqual({ url: want.url, method: want.method, headers: want.headers });

    const params = new URLSearchParams(req.body);
    const secret = params.get('client_secret')!;
    params.delete('client_secret');
    expect([...params.entries()]).toEqual(want.bodyWithoutClientSecret);

    const [h, p, s] = secret.split('.');
    const dec = (x: string) => JSON.parse(Buffer.from(x, 'base64url').toString('utf8'));
    expect(dec(h)).toEqual(want.clientSecretHeader);
    expect(dec(p)).toEqual(want.clientSecretPayload);
    // Same key ORDER as arctic, or Content-Length (pinned above) would differ.
    expect(Buffer.from(h, 'base64url').toString()).toBe(JSON.stringify(want.clientSecretHeader));
    expect(Buffer.from(p, 'base64url').toString()).toBe(JSON.stringify(want.clientSecretPayload));

    const sig = Buffer.from(s, 'base64url');
    expect(sig.length).toBe(want.signatureBytes);
    expect(verify('sha256', Buffer.from(`${h}.${p}`), { key: keys.publicKey, dsaEncoding: 'ieee-p1363' }, sig)).toBe(true);
  });
});

describe('the token response contract the callbacks were written against', () => {
  const g = F.google.inputs;
  const exchange = () => new GoogleOAuth(g.clientId, g.clientSecret, g.redirectURI).validateAuthorizationCode(g.code, g.codeVerifier);

  it('hands back the id token and the refresh token', async () => {
    const t = await exchange();
    expect(t.idToken()).toBe('h.p.s');
    expect(t.hasRefreshToken()).toBe(true);
    expect(t.refreshToken()).toBe('r');
  });

  it('throws on a missing id token, so the callback lands in its catch', async () => {
    reply = () => new Response(JSON.stringify({ access_token: 'a' }), { status: 200 });
    const t = await exchange();
    expect(t.hasRefreshToken()).toBe(false);
    expect(() => t.idToken()).toThrow();
  });

  it('throws the provider error code on a 400', async () => {
    reply = () => new Response(JSON.stringify({ error: 'invalid_grant', error_description: 'Bad Request' }), { status: 400 });
    await expect(exchange()).rejects.toMatchObject({ code: 'invalid_grant' });
    await expect(exchange()).rejects.toBeInstanceOf(OAuthRequestError);
  });

  it('throws on a 400 that is not an OAuth error, a 500, and a non-JSON 200', async () => {
    for (const r of [
      () => new Response('<html>', { status: 400 }),
      () => new Response('down', { status: 500 }),
      () => new Response('not json', { status: 200 }),
    ]) {
      reply = r;
      await expect(exchange()).rejects.toThrow();
    }
  });
});

describe('arctic is gone', () => {
  it('nothing in app/ or lib/ imports it, and package.json does not list it', async () => {
    const { execSync } = await import('node:child_process');
    const hits = execSync(`grep -rlE "from ['\\"]arctic['\\"]|require\\(['\\"]arctic['\\"]\\)" app lib || true`, { cwd: path.join(__dirname, '..') }).toString().trim();
    expect(hits).toBe('');
    const pkg = JSON.parse(readFileSync(path.join(__dirname, '../package.json'), 'utf8'));
    expect({ ...pkg.dependencies, ...pkg.devDependencies }).not.toHaveProperty('arctic');
  });
});
