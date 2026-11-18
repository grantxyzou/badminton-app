import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative, sep } from 'path';

/**
 * WHO MAY ACT FOR SOMEONE IN NO CLUB? (Claude Security, gap 1 of the
 * 2026-11-17 scan.)
 *
 * `verifyLiveMemberAuth` / `readLiveMemberSession` deny by default: the
 * cookie's person must hold an ACTIVE place on the roster of the club it
 * names. The ACCOUNT check (`verifyLiveAccountAuth`, `readLiveAccountSession`,
 * and `liveCallerMemberId` built on it) drops that requirement, for the few
 * things a person in no club, or removed from their club, must still do.
 *
 * Every file that calls one is listed here with why. A new caller fails the
 * build: reaching for the account check is a decision, never a default, and
 * the default lets nobody act inside a club they are not on.
 */

const ROOT = join(__dirname, '..');
const ACCOUNT_CHECK = /\b(verifyLiveAccountAuth|readLiveAccountSession|liveCallerMemberId)\(/;

const ALLOWED: Record<string, string> = {
  'app/api/auth/handoff/claim/route.ts': 'finishing a sign-in that crossed a cookie jar: a person in no club signs in too',
  'app/api/auth/identity/route.ts': 'linking Apple or Google to the account: the person, not a club',
  'app/api/auth/me/route.ts': 'is this phone signed in at all: Create a club reads it before the club exists',
  'app/api/auth/nudge/route.ts': 'remembers on the person that "Keep your account" was shown (via liveCallerMemberId)',
  'app/api/auth/password/route.ts': 'setting the account’s email and password',
  'app/api/groups/route.ts': 'creating a club: the creator is in no club until it exists',
  'app/api/groups/ask/route.ts': 'asking to join a club, and reading one’s own asks, from no club',
  'app/api/groups/switch/route.ts': 'picking one of the person’s clubs from the no-club screen',
  'app/api/members/me/name/route.ts': 'the account’s own display name',
  'app/api/members/me/route.ts': 'DELETE: anyone may delete their own account, in a club or not',
  'app/api/push/subscribe/route.ts': 'a person waiting to be let in gets a push when they are; the device is their own',
  'lib/oauthCallback.ts': 'the browser’s session, to link a provider to the account signed in on it',
  'lib/pageGate.ts': 'the no-club screen itself: decides who is signed in but on no roster',
  'lib/auth.ts': 'the definitions (liveCallerMemberId is built on readLiveAccountSession)',
};

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

/** Comments out, so a docblock naming the check is not a call. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function callers(): string[] {
  return [...walk(join(ROOT, 'app')), ...walk(join(ROOT, 'lib'))]
    .filter((f) => ACCOUNT_CHECK.test(code(readFileSync(f, 'utf8'))))
    .map((f) => relative(ROOT, f).split(sep).join('/'))
    .sort();
}

describe('the no-roster account check is a listed decision', () => {
  it('every caller is listed with its reason', () => {
    const unlisted = callers().filter((f) => !(f in ALLOWED));
    expect(
      unlisted,
      'These call the ACCOUNT check, which lets someone in no club act. A route that acts inside a club uses ' +
        'verifyLiveMemberAuth or requireGroupMember; only a no-club route goes in ALLOWED, with why.',
    ).toEqual([]);
  });

  it('no listed entry is stale', () => {
    const found = new Set(callers());
    expect(Object.keys(ALLOWED).filter((f) => !found.has(f))).toEqual([]);
  });
});
