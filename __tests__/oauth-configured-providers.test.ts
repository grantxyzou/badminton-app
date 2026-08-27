import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { configuredProviders, googleClient, isRealCredential } from '../lib/oauthProviders';

/**
 * A placeholder must not count as a configured provider.
 *
 * The original check was "is the env var non-empty", so
 * `GOOGLE_CLIENT_ID=YOUR_ID_HERE` passed: the app offered the button,
 * redirected to Google, and Google answered `invalid_client`. The problem was
 * local and obvious, but the failure surfaced at the provider — which is the
 * worst place to learn about your own misconfiguration.
 */
const GOOGLE_KEYS = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of GOOGLE_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  process.env.APP_ORIGIN = 'http://localhost:3000';
});

afterEach(() => {
  for (const k of GOOGLE_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  delete process.env.APP_ORIGIN;
});

describe('isRealCredential', () => {
  it('rejects the placeholders people actually leave behind', () => {
    for (const junk of [
      'YOUR_ID_HERE',
      'YOUR_SECRET_HERE',
      'your-client-id',
      'paste-client-id-here',
      'replace-me',
      'changeme',
      'TODO',
      'xxxxxxxxxx',
      '<client-id>',
      'example-secret',
    ]) {
      expect(isRealCredential(junk), `${junk} should be rejected`).toBe(false);
    }
  });

  it('rejects empty, whitespace and implausibly short values', () => {
    expect(isRealCredential(undefined)).toBe(false);
    expect(isRealCredential('')).toBe(false);
    expect(isRealCredential('   ')).toBe(false);
    expect(isRealCredential('abc')).toBe(false);
  });

  it('accepts credentials that look real', () => {
    expect(isRealCredential('123456789012-a1b2c3d4.apps.googleusercontent.com')).toBe(true);
    expect(isRealCredential('GOCSPX-AbCdEfGhIjKlMnOp')).toBe(true);
    // Deliberately NOT asserting Google's format: requiring
    // `.apps.googleusercontent.com` would make the button silently vanish if
    // Google ever changed it, which is the worse direction to be wrong in.
    expect(isRealCredential('some-other-provider-format-9182')).toBe(true);
  });
});

describe('configuredProviders', () => {
  it('does not report google when the vars are placeholders', () => {
    process.env.GOOGLE_CLIENT_ID = 'YOUR_ID_HERE';
    process.env.GOOGLE_CLIENT_SECRET = 'YOUR_SECRET_HERE';
    expect(configuredProviders()).toEqual([]);
  });

  it('reports google for real-looking credentials', () => {
    process.env.GOOGLE_CLIENT_ID = '123456789012-a1b2c3d4.apps.googleusercontent.com';
    process.env.GOOGLE_CLIENT_SECRET = 'GOCSPX-AbCdEfGhIjKlMnOp';
    expect(configuredProviders()).toEqual(['google']);
  });
});

describe('googleClient', () => {
  it('refuses to build a client from placeholders', () => {
    // Otherwise /start would 307 to Google carrying junk and fail THERE.
    process.env.GOOGLE_CLIENT_ID = 'YOUR_ID_HERE';
    process.env.GOOGLE_CLIENT_SECRET = 'YOUR_SECRET_HERE';
    expect(googleClient('http://localhost:3000')).toBeNull();
  });

  it('builds a client from real-looking credentials', () => {
    process.env.GOOGLE_CLIENT_ID = '123456789012-a1b2c3d4.apps.googleusercontent.com';
    process.env.GOOGLE_CLIENT_SECRET = 'GOCSPX-AbCdEfGhIjKlMnOp';
    expect(googleClient('http://localhost:3000')).not.toBeNull();
  });
});
