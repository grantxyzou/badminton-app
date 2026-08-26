import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { execSync } from 'child_process';

/**
 * `passwordHash`, `emailVerification` and `passwordReset` are strip-canaries in
 * the same family as `pinHash` and `recoveryCode`: they must never reach a
 * client, from any endpoint, ever.
 *
 * WHY THIS TEST IS STRUCTURAL AND NOT BEHAVIOURAL
 * ----------------------------------------------
 * The failure mode is not "an existing route regressed" — it is "a NEW route
 * returns a member record and nobody remembered to strip". No behavioural test
 * of today's routes can catch tomorrow's endpoint. Same reasoning as
 * `ownsNameOrAdmin()` in lib/auth.ts: a forgotten *call* is at least greppable,
 * and a forgotten *field* in a destructure is not.
 *
 * `recoveryCode: _rc` is the marker for a member-record strip site.
 * `recoveryCode` exists only on `Member`, never on `Player`, so a destructure
 * that drops it is by construction handling a member document. Player-record
 * sites (which strip `deleteToken` + `pinHash`) are correctly out of scope:
 * players never carry an email or a password hash.
 */
describe('auth strip canary', () => {
  const files = execSync('grep -rl "recoveryCode: _rc" app lib', { encoding: 'utf8' })
    .trim()
    .split('\n')
    .filter(Boolean);

  it('finds the member-record strip sites', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)('%s strips every member secret wherever it strips recoveryCode', (file) => {
    const src = readFileSync(file, 'utf8');
    const blocks = src.split('recoveryCode: _rc').slice(1);
    expect(blocks.length).toBeGreaterThan(0);
    for (const block of blocks) {
      // The rest of a destructure pattern always closes well within 400 chars.
      const head = block.slice(0, 400);
      expect(head, `${file}: must also drop passwordHash`).toContain('passwordHash: _pw');
      expect(head, `${file}: must also drop emailVerification`).toContain(
        'emailVerification: _ev',
      );
      expect(head, `${file}: must also drop passwordReset`).toContain('passwordReset: _pr');
    }
  });

  it('strips email from cross-member responses but NOT from members/me', () => {
    // email is a NARROW canary: the caller must be able to read their own
    // address back on Profile, exactly as statsPrivacy already works. Any
    // OTHER member-record response must drop it.
    const listSrc = readFileSync('app/api/members/route.ts', 'utf8');
    for (const block of listSrc.split('recoveryCode: _rc').slice(1)) {
      expect(block.slice(0, 400)).toContain('email: _em');
    }
    const meSrc = readFileSync('app/api/members/me/route.ts', 'utf8');
    expect(meSrc).not.toContain('email: _em');
  });
});
