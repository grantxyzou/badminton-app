import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative, sep } from 'path';

/**
 * THE SHAPES THE 2026-11-17 SECURITY SCAN FOUND, AS SOURCE SCANS.
 *
 * Each finding has its own behaviour test, which proves the fix for the code
 * that had the bug. These scans catch the same mistake in code that does not
 * exist yet: a new PIN check that compares before it counts, a new admin
 * route that resets someone's PIN without the on-behalf guard, a new tally
 * keyed by member text on a plain `{}`. The rules behind them are in
 * `.claude/rules/security.md`.
 *
 * A scan is a canary, not a proof: it reads the source, so a determined
 * rewrite can slip past it. When one fails, read the rule before reaching
 * for an exemption, and give an exemption its reason.
 */

const ROOT = join(__dirname, '..');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

/** Comments out, so a docblock naming a call is not a call. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const rel = (f: string) => relative(ROOT, f).split(sep).join('/');
const files = (dir: string) => walk(join(ROOT, dir)).map((f) => ({ path: rel(f), src: code(readFileSync(f, 'utf8')) }));
const read = (path: string) => code(readFileSync(join(ROOT, path), 'utf8'));

const APP = files('app');
const LIB = files('lib');
const API = APP.filter((f) => f.path.startsWith('app/api/'));

describe('PIN checks count before they compare (F8, F9)', () => {
  it('the racy lock API (read, then count after) is used nowhere but its definition', () => {
    const users = [...APP, ...LIB]
      .filter((f) => f.path !== 'lib/pinLockout.ts')
      .filter((f) => /\b(isPinLocked|notePinFailure)\(/.test(f.src))
      .map((f) => f.path);
    expect(users, 'Use claimPinAttempt before verifyPin and notePinSuccess after (lib/pinLockout.ts).').toEqual([]);
  });

  it('every route that compares a real PIN hash calls claimPinAttempt', () => {
    const missing = APP.filter((f) => {
      const real = [...f.src.matchAll(/\bverifyPin\(([^,]+),\s*([^)]+)\)/g)].some((m) => !/FAKE_HASH/.test(m[2]));
      return real && !/\bclaimPinAttempt\(/.test(f.src);
    }).map((f) => f.path);
    expect(missing, 'A guess must be counted under IfMatch BEFORE it reaches the real hash (claimPinAttempt).').toEqual([]);
  });
});

describe('an admin acting on someone else’s credentials goes through the on-behalf guard (F1–F4)', () => {
  const ADMIN = /\bisAdminAuthed(WithMember)?\(/;
  const CREDENTIAL =
    /pinHash\s*:|\.pinHash\s*=|delete\s+[\w.()]+\.pinHash|\bclearPin\b|issueRecoveryCode\(|createRecoveryCode\(|passwordHash\s*:|delete\s+[\w.()]+\.passwordHash/;
  /** A route here admits an admin and writes a credential, but never another person's. Say why. */
  const EXEMPT: Record<string, string> = {};

  it('a route that admits an admin and writes a credential calls onBehalfRefusal', () => {
    const missing = API.filter((f) => ADMIN.test(f.src) && CREDENTIAL.test(f.src))
      .filter((f) => !/\bonBehalfRefusal\(/.test(f.src) && !(f.path in EXEMPT))
      .map((f) => f.path);
    expect(missing, 'lib/onBehalfGuard.ts: organiser-only for a rank-holder, nobody on another club’s roster.').toEqual([]);
  });

  it('the doors the scan found keep the guard', () => {
    const doors = [
      'app/api/players/route.ts',
      'app/api/players/reset-access/route.ts',
      'app/api/admin/access-requests/route.ts',
      'app/api/members/route.ts',
      'app/api/members/me/route.ts',
    ];
    expect(doors.filter((p) => !/\bonBehalfRefusal\(/.test(read(p)))).toEqual([]);
  });
});

describe('deployment-wide powers are the operator’s (F22, F26)', () => {
  it('each operator route checks isOperator', () => {
    const routes = [
      'app/api/admin/migrate-memberId/route.ts',
      'app/api/admin/migrate-groups/route.ts',
      'app/api/operator/membership/route.ts',
      'app/api/releases/route.ts',
      'app/api/claude/route.ts',
    ];
    expect(routes.filter((p) => !/\bisOperator\(/.test(read(p)))).toEqual([]);
  });

  it('minting BPM’s reports key (which also reads every club’s problem reports) is the operator’s', () => {
    expect(read('app/api/admin/reports/key/route.ts')).toMatch(/\bisOperatorAdmin\(/);
  });
});

describe('a name nobody holds pays the work a real account’s miss does (F17, gap 3)', () => {
  it('each sign-in miss path pads', () => {
    const sites = [
      'app/api/players/recover/route.ts',
      'app/api/admin/route.ts',
      'app/api/auth/claim-name/route.ts',
      'app/api/members/me/route.ts',
      'app/api/auth/email-code/verify/route.ts',
    ];
    expect(sites.filter((p) => !/\bpadMissingAccount\(/.test(read(p)))).toEqual([]);
  });

  it('a recovery-code miss pays the scrypt on every path', () => {
    expect(read('lib/memberRecoveryCode.ts')).toMatch(/verifyPin\(candidate, FAKE_HASH\)/);
  });
});

describe('only a sign-in through an address proves it (gap 2)', () => {
  /** The confirmation link, the one writer of `emailVerified` that is NOT proof. */
  const LINK = 'app/api/auth/verify-email/route.ts';

  it('every other writer of emailVerified: true writes mailboxProven too', () => {
    const missing = [...APP, ...LIB]
      .filter((f) => f.path !== LINK)
      // The pending-signup cookie carries the provider's claim, not a Member write.
      .filter((f) => f.src.split('\n').some((line) => /emailVerified:\s*true/.test(line) && !/setPendingSignup/.test(line)))
      .filter((f) => !/mailboxProven/.test(f.src))
      .map((f) => f.path);
    expect(missing, 'lib/emailProof.ts: a sign-in through the address sets mailboxProven; the link does not.').toEqual([]);
  });

  it('the confirmation link does not set it', () => {
    expect(read(LINK)).not.toMatch(/mailboxProven/);
  });
});

describe('a map keyed by member-supplied text is null-prototype (F21)', () => {
  it('every `x[key] ??= {` builds on Object.create(null)', () => {
    const bad: string[] = [];
    for (const f of [...APP, ...LIB]) {
      for (const m of f.src.matchAll(/([\w$]+)\[[^\]\n]+\]\s*\?\?=\s*\{/g)) {
        const base = m[1];
        const nullProto = new RegExp(`\\b${base}\\b[^\\n]*Object\\.create\\(null\\)`).test(f.src);
        if (!nullProto) bad.push(`${f.path}: ${base}`);
      }
    }
    expect(bad, 'On a plain {}, the key "__proto__" writes onto Object.prototype for the whole server. Use Object.create(null) or a Map.').toEqual([]);
  });
});
