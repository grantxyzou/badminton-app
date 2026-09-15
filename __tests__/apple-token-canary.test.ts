import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

/**
 * THE APPLE REFRESH TOKEN STAYS WHERE IT IS PUT.
 *
 * Sign in with Apple's refresh token is kept for exactly one reason: to be
 * revoked when a member deletes their account or disconnects Apple. It is a
 * server-side credential — useless without our client-secret JWT, but not
 * something to hand out, log, or grow new readers for.
 *
 * `identities` rows are not returned by any route today, so there is nothing to
 * strip; the risk is a FUTURE reader. So, like the other strip canaries, this
 * pins the token to the files allowed to touch it and fails the build on a new
 * one. Adding a reader is a decision to make here, in writing, not by accident.
 */
const ROOT = join(__dirname, '..');

/** Which file may mention which part of the token path. */
const ALLOWED: Record<string, string[]> = {
  // The doc id encoding, and the token field itself.
  'apple-refresh:': ['lib/authIdentity.ts'],
  // The only writer: the one moment a token exists.
  storeAppleRefreshToken: ['lib/authIdentity.ts', 'app/api/auth/apple/callback/route.ts'],
  // The only reader: to send it to Apple's revoke endpoint.
  readAppleRefreshToken: ['lib/authIdentity.ts', 'lib/appleRevoke.ts'],
  refreshToken: ['lib/authIdentity.ts', 'lib/appleRevoke.ts', 'app/api/auth/apple/callback/route.ts'],
};

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

describe('the Apple refresh token has a fixed set of homes', () => {
  const files = ['app', 'lib', 'components'].flatMap((d) => sourceFiles(join(ROOT, d)));

  it('scans real source (not an empty tree)', () => {
    expect(files.length).toBeGreaterThan(100);
  });

  for (const [needle, allowed] of Object.entries(ALLOWED)) {
    it(`"${needle}" appears only in ${allowed.join(', ')}`, () => {
      const offenders = files
        .filter((f) => readFileSync(f, 'utf8').includes(needle))
        .map((f) => relative(ROOT, f))
        .filter((f) => !allowed.includes(f))
        .sort();
      expect(offenders, `new file touching the Apple refresh token — decide here whether it may`).toEqual([]);
    });
  }

  it('every allowed file actually still uses what it is allowed (the list cannot rot into permission for nothing)', () => {
    for (const [needle, allowed] of Object.entries(ALLOWED)) {
      for (const f of allowed) {
        expect(readFileSync(join(ROOT, f), 'utf8').includes(needle), `${f} no longer mentions ${needle}`).toBe(true);
      }
    }
  });
});
