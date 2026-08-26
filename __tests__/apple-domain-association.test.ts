import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { proxy } from '../proxy';

/**
 * Serving Apple's domain-association token from the DOMAIN ROOT.
 *
 * Apple verifies domain ownership by fetching
 * `/.well-known/apple-developer-domain-association.txt` at the root — but
 * `basePath: '/bpm'` puts everything in `public/` under `/bpm/...`, so Next
 * 404s that path.
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
// The path AS THE PROXY SEES IT. Next strips the basePath from
// `nextUrl.pathname` before the proxy runs, so a live request to
// `/bpm/.well-known/...` arrives here as `/.well-known/...`. Writing `/bpm/...`
// in this test would pass against the raw-URL fallback while testing a shape
// production never produces.
const PATH = '/.well-known/apple-developer-domain-association.txt';
const TOKEN = 'apple-domain-association-token-value';

const saved = process.env.APPLE_DOMAIN_ASSOCIATION;

beforeEach(() => {
  process.env.APPLE_DOMAIN_ASSOCIATION = TOKEN;
});

afterEach(() => {
  if (saved === undefined) delete process.env.APPLE_DOMAIN_ASSOCIATION;
  else process.env.APPLE_DOMAIN_ASSOCIATION = saved;
});

function req(path: string): NextRequest {
  return new NextRequest(`http://localhost:3000${path}`);
}

describe('apple domain association', () => {
  it('serves the token as plain text', async () => {
    const res = proxy(req(PATH));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/plain/);
    expect(await res.text()).toBe(TOKEN);
  });

  it('falls through when the token is not configured', async () => {
    // Serving an empty file would be worse than falling through: Apple rejects
    // it anyway, and a 200 would hide the misconfiguration.
    delete process.env.APPLE_DOMAIN_ASSOCIATION;
    const res = proxy(req(PATH));
    expect(await res.text()).not.toBe(TOKEN);
    expect(res.headers.get('content-type') ?? '').not.toMatch(/text\/plain/);
  });

  it('does not hijack any other path', async () => {
    for (const p of ['/', '/.well-known/other.txt', '/players']) {
      const res = proxy(req(p));
      expect(await res.text()).not.toBe(TOKEN);
    }
  });

  it('still sets the locale cookie on ordinary paths', () => {
    // Regression guard: the association branch runs FIRST, so a bug there
    // would silently disable i18n for every request in the app.
    const res = proxy(req('/'));
    expect(res.headers.getSetCookie().join()).toMatch(/NEXT_LOCALE=/);
  });
});
