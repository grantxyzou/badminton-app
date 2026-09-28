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

  it('never projects a member secret in a SELECT, where no strip site can exist', () => {
    // The inverse hazard to the destructure rule above, and the reason this
    // second check exists: a PROJECTED select (`SELECT c.role, c.pinHash, ...`)
    // has no destructure at all, so `recoveryCode: _rc` never appears and the
    // canary above can never fire on it. `app/api/members/me/route.ts` is
    // currently the only projection that returns member fields to a client.
    // If a secret is ever added to a projection, it reaches the client with
    // nothing standing in the way.
    const src = execSync('grep -rn "SELECT c\\." app lib', { encoding: 'utf8' });
    for (const secret of ['c.passwordHash', 'c.emailVerification', 'c.passwordReset']) {
      const offenders = src.split('\n').filter((line) => line.includes(secret));
      expect(offenders, `${secret} must never appear in a projection`).toEqual([]);
    }
    // c.email is allowed, but only where the caller reads their own record.
    const emailProjections = src
      .split('\n')
      .filter((line) => line.includes('c.email') && !line.includes('c.emailVerif'));
    for (const line of emailProjections) {
      expect(line, 'c.email may only be projected by members/me').toContain(
        'app/api/members/me/route.ts',
      );
    }
  });

  it('strips email from cross-member responses but NOT from members/me', () => {
    // email is a NARROW canary: the caller must be able to read their own
    // address back on Profile, exactly as statsPrivacy already works. Any
    // OTHER member-record response must drop it. Since 2026-09-28 the
    // member-record responses all go through `publicMember`, so the rule is
    // checked on the helper and the routes are checked to USE it.
    const helperSrc = readFileSync('lib/publicShapes.ts', 'utf8');
    const blocks = helperSrc.split('recoveryCode: _rc').slice(1);
    expect(blocks.length).toBeGreaterThan(0);
    for (const block of blocks) {
      expect(block.slice(0, 400)).toContain('email: _em');
    }
    for (const route of ['app/api/members/route.ts', 'app/api/admin/settings/route.ts']) {
      const src = readFileSync(route, 'utf8');
      expect(src, `${route} must strip through publicMember`).toContain('publicMember(');
      expect(src, `${route} must not grow a hand-written strip beside the helper`).not.toContain('recoveryCode: _rc');
    }
    const meSrc = readFileSync('app/api/members/me/route.ts', 'utf8');
    expect(meSrc).not.toContain('email: _em');
  });

  it('player responses strip through publicPlayer', () => {
    const src = readFileSync('app/api/players/route.ts', 'utf8');
    expect(src).toContain('publicPlayer(');
    expect(src).not.toContain('deleteToken: _dt');
    expect(src).not.toContain('pinHash: _ph');
  });
});
