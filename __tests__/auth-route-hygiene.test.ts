import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Structural guard over every `/api/auth/*` route.
 *
 * These three properties are stated in CLAUDE.md and are each invisible by
 * omission: a route that forgets one behaves normally in every test until the
 * day it matters. A behavioural test of today's routes cannot catch tomorrow's
 * route forgetting them, so this pins the shape instead — the same reasoning as
 * the member-resolve and strip canaries.
 *
 * The ordering check in particular caught two of these routes at review time.
 * `signin` and `claim-name` both key their rate limit per-identifier, which
 * needs the identifier out of the body — so both had drifted into parsing
 * first, exactly as `/api/players/recover` does. The fix is a coarse IP-only
 * guard before the parse and the precise limit after, not abandoning either.
 */
function routeFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) routeFiles(full, out);
    else if (entry === 'route.ts') out.push(full);
  }
  return out;
}

const AUTH_ROUTES = routeFiles(join(process.cwd(), 'app', 'api', 'auth')).map((f) =>
  f.replace(process.cwd() + '/', ''),
);

describe('auth route hygiene', () => {
  it('finds the auth routes', () => {
    expect(AUTH_ROUTES.length).toBeGreaterThanOrEqual(10);
  });

  it.each(AUTH_ROUTES)('%s is gated on the feature flag', (file) => {
    const src = readFileSync(file, 'utf8');
    const handlers = (src.match(/export async function (GET|POST|DELETE|PATCH|PUT)/g) ?? []).length;
    const gates = (src.match(/isFlagOn\('NEXT_PUBLIC_FLAG_AUTH_PROVIDERS'\)/g) ?? []).length;
    // Read SERVER-side: a client flag cannot protect the database.
    expect(gates, `${file}: ${handlers} handler(s) but ${gates} flag gate(s)`).toBe(handlers);
  });

  it.each(AUTH_ROUTES)('%s rate limits', (file) => {
    const src = readFileSync(file, 'utf8');
    expect(src, `${file} has no checkRateLimit call`).toContain('if (!checkRateLimit');
  });

  it.each(AUTH_ROUTES)('%s rate limits BEFORE parsing the body', (file) => {
    // Security rule 4. A limiter that runs after the parse can be bypassed by
    // anything that fails to parse, and makes the server do unbounded work on
    // an unauthenticated request first.
    const lines = readFileSync(file, 'utf8').split('\n');
    const firstLimit = lines.findIndex((l) => l.includes('if (!checkRateLimit'));
    const firstParse = lines.findIndex(
      (l) => l.includes('await req.json()') || l.includes('await req.formData()'),
    );
    if (firstParse === -1) return; // no body to parse
    expect(
      firstLimit,
      `${file}: body parsed at line ${firstParse + 1} but rate limit is at ${firstLimit + 1}`,
    ).toBeGreaterThan(-1);
    expect(firstLimit).toBeLessThan(firstParse);
  });

  it.each(AUTH_ROUTES)('%s never derives an outbound origin from the request', (file) => {
    // Host-header injection: req.url follows a client-controlled header, and a
    // reset link built from an attacker's host is account takeover.
    const src = readFileSync(file, 'utf8');
    expect(src, `${file} builds an origin from req.url`).not.toMatch(
      /new URL\(req\.url\)\.origin/,
    );
  });
});
