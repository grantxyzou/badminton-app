import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * The service worker exists ONLY to receive pushes. This suite is the
 * executable form of that policy.
 *
 * The app's offline posture is "legible-fail" (CLAUDE.md): a broken backend
 * must look broken rather than be masked by stale cached bytes. A `fetch`
 * handler in the service worker is exactly the mechanism that would silently
 * reverse that guarantee — and it would do so invisibly, since the app would
 * still appear to work. So the absence of a fetch handler is asserted here
 * rather than left to code review.
 */
const SW_PATH = join(__dirname, '..', 'public', 'sw.js');
const source = readFileSync(SW_PATH, 'utf8');

describe('public/sw.js — push-only policy', () => {
  it('registers a push handler', () => {
    expect(source).toMatch(/addEventListener\(\s*['"]push['"]/);
  });

  it('registers a notificationclick handler', () => {
    expect(source).toMatch(/addEventListener\(\s*['"]notificationclick['"]/);
  });

  it('has NO fetch handler (offline posture is legible-fail)', () => {
    expect(source).not.toMatch(/addEventListener\(\s*['"]fetch['"]/);
  });

  it('does not use the Cache Storage API', () => {
    // caches.open / caches.match would let the worker serve stale bytes even
    // without a fetch handler (e.g. from a message handler added later).
    expect(source).not.toMatch(/\bcaches\s*\./);
  });

  it('hand-prefixes asset URLs with the basePath', () => {
    // Next does NOT rewrite paths inside public/ files — same gotcha the
    // manifest documents. An unprefixed icon path 404s in production only.
    expect(source).toContain("const BASE = '/bpm'");
    expect(source).not.toMatch(/['"]\/icons\//);
  });

  it('falls back to a generic notification when the payload is unusable', () => {
    // A push that throws shows nothing at all on some browsers, burning the
    // permission grant for no user-visible result.
    expect(source).toMatch(/catch/);
    expect(source).toMatch(/FALLBACK_TITLE/);
  });

  it('only opens same-app URLs from a push payload', () => {
    // The payload arrives from the server, but a notification that can be
    // steered to an arbitrary origin is a phishing primitive — pin it to BASE.
    expect(source).toMatch(/startsWith\(BASE\)/);
  });
});
