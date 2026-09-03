import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { proxy } from '../proxy';

/**
 * Serving the three `.well-known` association files from the DOMAIN ROOT.
 *
 * Apple (Sign in with Apple, universal links) and Google (App Links) verify
 * domain ownership by fetching from `/.well-known/...` at the root — but
 * `basePath: '/bpm'` puts everything in `public/` under `/bpm/...`, so Next
 * 404s those paths.
 *
 * TWO MECHANISMS ARE NEEDED, AND NEITHER WORKS ALONE. Both were established
 * empirically against a running server:
 *
 *  1. `proxy.ts` does NOT run outside the basePath — Next auto-prefixes the
 *     matcher, so a request to `/.well-known/...` never reaches it (verified:
 *     the locale cookie is not set at `/` either). The proxy can only answer
 *     the path once it is INSIDE `/bpm`.
 *  2. A `rewrites()` entry with `basePath: false` gets the request there — but
 *     only with an ABSOLUTE destination. A relative one is rejected at boot
 *     ("use a destination that starts with http:// or https://"), because
 *     escaping the basePath makes the destination external too.
 *
 * This file covers half 1. Half 2 lives in next.config.js and is exercised by
 * booting the server, since a config rewrite has no unit-testable surface.
 */
// The paths AS THE PROXY SEES THEM. Next strips the basePath from
// `nextUrl.pathname` before the proxy runs, so a live request to
// `/bpm/.well-known/...` arrives here as `/.well-known/...`. Writing `/bpm/...`
// in this test would pass against the raw-URL fallback while testing a shape
// production never produces.
const APPLE_TXT = '/.well-known/apple-developer-domain-association.txt';
const AASA = '/.well-known/apple-app-site-association';
const ASSETLINKS = '/.well-known/assetlinks.json';

const TOKEN = 'apple-domain-association-token-value';
const AASA_BODY = JSON.stringify({
  applinks: { details: [{ appIDs: ['TEAM.com.motioncraft.bpm'], components: [{ '/': '/bpm/migrate' }] }] },
});
const ASSETLINKS_BODY = JSON.stringify([
  {
    relation: ['delegate_permission/common.handle_all_urls'],
    target: { namespace: 'android_app', package_name: 'com.motioncraft.bpm', sha256_cert_fingerprints: ['AA:BB'] },
  },
]);

const ENV = ['APPLE_DOMAIN_ASSOCIATION', 'APPLE_APP_SITE_ASSOCIATION', 'ANDROID_ASSET_LINKS'] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV) saved[k] = process.env[k];
  process.env.APPLE_DOMAIN_ASSOCIATION = TOKEN;
  process.env.APPLE_APP_SITE_ASSOCIATION = AASA_BODY;
  process.env.ANDROID_ASSET_LINKS = ASSETLINKS_BODY;
});

afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.restoreAllMocks();
});

function req(path: string): NextRequest {
  return new NextRequest(`http://localhost:3000${path}`);
}

describe('well-known: apple-developer-domain-association.txt', () => {
  it('serves the token as plain text', async () => {
    const res = proxy(req(APPLE_TXT));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/plain/);
    expect(await res.text()).toBe(TOKEN);
  });

  it('falls through when the token is not configured', async () => {
    // Serving an empty file would be worse than falling through: Apple rejects
    // it anyway, and a 200 would hide the misconfiguration.
    delete process.env.APPLE_DOMAIN_ASSOCIATION;
    const res = proxy(req(APPLE_TXT));
    expect(await res.text()).not.toBe(TOKEN);
    expect(res.headers.get('content-type') ?? '').not.toMatch(/text\/plain/);
  });
});

describe('well-known: apple-app-site-association (universal links)', () => {
  it('serves the body as application/json with no redirect', async () => {
    // Apple's CDN requires JSON content-type on an extensionless path and
    // refuses to follow redirects; both are silent failures if wrong.
    const res = proxy(req(AASA));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/json');
    expect(res.headers.get('location')).toBeNull();
    expect(JSON.parse(await res.text())).toEqual(JSON.parse(AASA_BODY));
  });

  it('falls through to 404 when the body is not valid JSON', async () => {
    // A malformed AASA served as 200 verifies nothing and tells nobody. A 404
    // shows up in `curl -sI` in one line.
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    process.env.APPLE_APP_SITE_ASSOCIATION = '{ not json';
    const res = proxy(req(AASA));
    expect(res.headers.get('content-type')).not.toBe('application/json');
    expect(await res.text()).not.toContain('not json');
    expect(err).toHaveBeenCalledOnce();
  });

  it('falls through when unset', async () => {
    delete process.env.APPLE_APP_SITE_ASSOCIATION;
    const res = proxy(req(AASA));
    expect(res.headers.get('content-type')).not.toBe('application/json');
  });
});

describe('well-known: assetlinks.json (Android App Links)', () => {
  it('serves the body as application/json', async () => {
    const res = proxy(req(ASSETLINKS));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/json');
    expect(JSON.parse(await res.text())).toEqual(JSON.parse(ASSETLINKS_BODY));
  });

  it('falls through to 404 when the body is not valid JSON', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    process.env.ANDROID_ASSET_LINKS = '[';
    const res = proxy(req(ASSETLINKS));
    expect(res.headers.get('content-type')).not.toBe('application/json');
  });
});

describe('well-known: isolation', () => {
  it('does not hijack any other path', async () => {
    for (const p of ['/', '/.well-known/other.txt', '/.well-known/', '/players', '/legal/privacy']) {
      const res = proxy(req(p));
      const body = await res.text();
      expect(body).not.toBe(TOKEN);
      expect(body).not.toBe(AASA_BODY);
      expect(body).not.toBe(ASSETLINKS_BODY);
    }
  });

  it('still sets the locale cookie on ordinary paths', () => {
    // Regression guard: the association branch runs FIRST, so a bug there
    // would silently disable i18n for every request in the app.
    const res = proxy(req('/'));
    expect(res.headers.getSetCookie().join()).toMatch(/NEXT_LOCALE=/);
  });

  it('does not set the locale cookie on an association response', () => {
    // A verifier bot is not a user; handing it a cookie is harmless but the
    // response should be exactly the file and nothing else.
    const res = proxy(req(AASA));
    expect(res.headers.getSetCookie()).toEqual([]);
  });
});
