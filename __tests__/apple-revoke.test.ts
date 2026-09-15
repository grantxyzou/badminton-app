import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { verify, type KeyObject } from 'node:crypto';
import { configureAppleForTest } from './appleTestEnv';
import { resetMockStore, getStore } from './helpers';
import { appleClientSecret, revokeAppleToken, revokeAppleIdentity } from '../lib/appleRevoke';
import { reserveIdentity, storeAppleRefreshToken, readAppleRefreshToken } from '../lib/authIdentity';
import { configuredProviders, appleClient } from '../lib/oauthProviders';

/**
 * Revoking Sign in with Apple tokens — Apple's rule for any app that offers it
 * and lets people delete their account.
 *
 * The client-secret JWT here is hand-signed (arctic keeps its own private), so
 * this file is the only thing standing between a subtly wrong JWT and a revoke
 * that 400s in production on a path that only logs. It verifies the signature
 * with a real P-256 key rather than trusting the shape.
 */
const KEYS = ['APPLE_CLIENT_ID', 'APPLE_TEAM_ID', 'APPLE_KEY_ID', 'APPLE_PRIVATE_KEY', 'APP_ORIGIN'] as const;
const saved: Record<string, string | undefined> = {};
let publicKey: KeyObject;

function configureApple() {
  // The afterEach below restores every APPLE_* key, so the helper's own restore is not needed.
  publicKey = configureAppleForTest().publicKey;
}

function decodePart(part: string) {
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
}

beforeEach(() => {
  resetMockStore();
  for (const k of KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('appleClientSecret', () => {
  it('is null until every Apple credential is set', () => {
    expect(appleClientSecret()).toBeNull();
    configureApple();
    delete process.env.APPLE_KEY_ID;
    expect(appleClientSecret()).toBeNull();
  });

  it('carries the claims Apple checks', () => {
    configureApple();
    const now = new Date('2026-09-15T00:00:00Z');
    const [h, p] = appleClientSecret(now)!.split('.');
    expect(decodePart(h)).toEqual({ alg: 'ES256', kid: 'KEY1234567', typ: 'JWT' });
    const claims = decodePart(p);
    expect(claims.iss).toBe('ABCDE12345');
    expect(claims.sub).toBe('com.motioncraft.bpm.web');
    expect(claims.aud).toBe('https://appleid.apple.com');
    expect(claims.exp - claims.iat).toBe(300);
    expect(claims.iat).toBe(Math.floor(now.getTime() / 1000));
  });

  it('is signed ES256 as a raw 64-byte r||s, which is what a JWS verifier accepts', () => {
    // Node signs ECDSA as DER by default. A DER signature is ~70–72 bytes and
    // verifies nowhere as a JWT — Apple would answer 400 on a best-effort path.
    configureApple();
    const [h, p, s] = appleClientSecret()!.split('.');
    const sig = Buffer.from(s, 'base64url');
    expect(sig.length).toBe(64);
    const ok = verify('sha256', Buffer.from(`${h}.${p}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, sig);
    expect(ok).toBe(true);
  });
});

describe('revokeAppleToken', () => {
  it('posts the token to Apple with the client secret', async () => {
    configureApple();
    const fetchMock = vi.fn(async () => new Response('', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await revokeAppleToken('refresh-xyz')).toBe('revoked');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://appleid.apple.com/auth/revoke');
    const body = new URLSearchParams(String(init.body));
    expect(body.get('client_id')).toBe('com.motioncraft.bpm.web');
    expect(body.get('token')).toBe('refresh-xyz');
    expect(body.get('token_type_hint')).toBe('refresh_token');
    expect(body.get('client_secret')?.split('.')).toHaveLength(3);
  });

  it('reports a rejection without throwing, and never logs the token', async () => {
    configureApple();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":"invalid_client"}', { status: 400 })));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await revokeAppleToken('refresh-secret')).toBe('failed');
    expect(JSON.stringify(log.mock.calls)).not.toContain('refresh-secret');
  });

  it('survives the network throwing', async () => {
    configureApple();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await revokeAppleToken('t')).toBe('failed');
  });

  it('does nothing when Apple is not configured', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(await revokeAppleToken('t')).toBe('not_configured');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('revokeAppleIdentity', () => {
  it('revokes the stored token for that Apple user and forgets it', async () => {
    configureApple();
    const fetchMock = vi.fn(async () => new Response('', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const reserved = await reserveIdentity('apple', 'apple-sub-9', 'member-wei');
    await storeAppleRefreshToken('apple-sub-9', 'refresh-9');
    if (!reserved.ok) throw new Error('reserve failed');

    expect(await revokeAppleIdentity(reserved.identity)).toBe('revoked');
    expect(new URLSearchParams(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body)).get('token')).toBe('refresh-9');
    expect(await readAppleRefreshToken('apple-sub-9')).toBeNull();
  });

  it('forgets the token even when Apple refuses — nothing is kept for a person who asked to go', async () => {
    configureApple();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 500 })));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const reserved = await reserveIdentity('apple', 'apple-sub-10', 'member-wei');
    await storeAppleRefreshToken('apple-sub-10', 'refresh-10');
    if (!reserved.ok) throw new Error('reserve failed');

    expect(await revokeAppleIdentity(reserved.identity)).toBe('failed');
    expect(await readAppleRefreshToken('apple-sub-10')).toBeNull();
  });

  it('is a no-op for a non-Apple identity or an Apple one with no stored token', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const google = await reserveIdentity('google', 'g-sub', 'member-wei');
    const apple = await reserveIdentity('apple', 'apple-sub-11', 'member-wei');
    if (!google.ok || !apple.ok) throw new Error('reserve failed');
    expect(await revokeAppleIdentity(google.identity)).toBe('no_token');
    expect(await revokeAppleIdentity(apple.identity)).toBe('no_token');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('the stored token is not an identity', () => {
  it('is never listed as one of the member’s sign-in methods', async () => {
    // No memberId on the doc, so the by-member query (and the purge loop)
    // cannot mistake it for an identity row.
    await storeAppleRefreshToken('apple-sub-12', 'refresh-12');
    const row = (getStore()['identities'] as Array<Record<string, unknown>>).find((r) => r.id === 'apple-refresh:apple-sub-12');
    expect(row).toBeDefined();
    expect(row).not.toHaveProperty('memberId');
  });
});

describe('Apple as a configured provider', () => {
  it('is offered only with all four credentials and a key that decodes', () => {
    process.env.APP_ORIGIN = 'http://localhost:3000';
    expect(configuredProviders()).not.toContain('apple');
    expect(appleClient('http://localhost:3000')).toBeNull();
    configureApple();
    expect(configuredProviders()).toContain('apple');
    expect(appleClient('http://localhost:3000')).not.toBeNull();
  });

  it('treats a placeholder key as unset', () => {
    configureApple();
    process.env.APPLE_PRIVATE_KEY = 'paste-your-p8-here';
    expect(configuredProviders()).not.toContain('apple');
  });
});
