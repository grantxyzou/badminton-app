import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative, sep } from 'path';

/**
 * WHO SEES "SIGN OUT EVERYWHERE"? (docs/plans/claim-your-name.md, Decisions)
 *
 * The cutoff (`Membership.sessionsNotBefore`, flag-off `Member.sessionsNotBefore`)
 * lives on a doc, so only a caller that READS that doc can honour it. Two
 * checks cannot: `verifyMemberAuth` (the cookie's signature and expiry) and
 * `ownsNameOrAdmin` (which is `verifyMemberAuth` plus a name compare). A session
 * the organiser signed out still passes both for the rest of its 30 days.
 *
 * So this canary classifies every top-level function in `app/` and `lib/` that
 * calls either one. Each is EXEMPT here with the reason it may stay blind, or
 * it fails the build. A write that acts as the member reaches for
 * `verifyLiveMemberAuth` (identity + cutoff) or `requireGroupMember` (identity
 * + cutoff + an ACTIVE membership) instead, and the ones that were moved are
 * pinned in `REREADS` so a revert to the cheap check is caught too.
 *
 * Function-level, not file-level: `members/me` has a gated GET beside three
 * PATCH helpers and a DELETE, and a file-level list would have let one stand
 * in for the others. Comments are stripped first, so a docblock naming the
 * function is not a call.
 */

const ROOT = join(__dirname, '..');
const SIGNATURE_ONLY = /\b(verifyMemberAuth|ownsNameOrAdmin|nameOwnership)\(/;
const REREADING = /\b(verifyLiveMemberAuth|readLiveMemberSession|requireGroupMember|requireMember|activeMemberFor)\(/;
const TOP_LEVEL = /^(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function\*?\s+([A-Za-z0-9_$]+)|(?:const|let)\s+([A-Za-z0-9_$]+))/gm;
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

type Exempt = { reason: string; /** required on a POST/PUT/PATCH/DELETE: exempting a write is a decision */ write?: true };

const read: Exempt = {
  reason: 'read of the caller’s own data (or a gated club read); the page gate already refuses a signed-out session, so the app never asks, and a hand-replayed cookie reads only until it expires — one point read per call is not worth it on a path every tab open hits',
};
const hint = (behind: string): Exempt => ({
  reason: `read behind ${behind}; verifyMemberAuth here is only the self-point-read HINT for resolveActiveSubject / the own-name compare, not the gate`,
});

const EXEMPT: Record<string, Exempt> = {
  // ── lib/auth.ts: the definitions, and the one "what does the caller have" read
  'lib/auth.ts#verifyMemberAuth': { reason: 'the definition' },
  'lib/auth.ts#ownsNameOrAdmin': { reason: 'the definition: the read-only privacy gate for name-keyed Stats reads (a wrapper over nameOwnership)' },
  'lib/auth.ts#nameOwnership': { reason: 'the definition behind ownsNameOrAdmin: who may read a name-keyed Stats read, and whether it is the caller' },
  'app/api/report/route.ts#POST': {
    reason: 'only TAGS a problem report with who sent it (so account deletion can find it by id); grants nothing and writes nothing as the member',
    write: true,
  },
  'lib/auth.ts#callerMemberId': {
    reason: 'answers what the caller HAS for auth/methods and auth/nudge — reads that drive Profile rows; neither mints, links or writes',
  },

  // ── Reads behind requireMember: the gate already re-read the membership
  'app/api/equipment/fit-verdict/route.ts#GET': hint('requireMember'),
  'app/api/equipment/gear/route.ts#GET': hint('requireMember'),
  'app/api/equipment/share-card/route.ts#GET': hint('requireMember'),
  'app/api/games/route.ts#GET': hint('requireMember'),
  'app/api/recommend/route.ts#GET': hint('requireMember'),
  'app/api/stringing/fit/route.ts#GET': hint('requireMember'),
  'app/api/members/me/route.ts#GET': {
    reason: 'read behind requireMember; `authed` is only a hint for the PIN sheet, and the first-PIN PATCH it guards re-reads (handlePatch below)',
  },

  // ── Owner reads (ownsNameOrAdmin): the caller's own stats, balance and kudos
  'app/api/assessments/route.ts#GET': read,
  'app/api/kudos/route.ts#GET': read,
  'app/api/players/unpaid/route.ts#GET': read,
  'app/api/stats/attendance/route.ts#GET': read,
  'app/api/stats/club/bands/route.ts#GET': read,
  'app/api/stats/drills/route.ts#GET': read,
  'app/api/stats/level/route.ts#GET': read,
  'app/api/stats/partners/route.ts#GET': read,
  'app/api/stats/insight/route.ts#GET': {
    reason: 'owner read; a miss generates once per (member, active session) and is cached, so a replayed cookie can spend at most one call per session',
  },
  'app/api/groups/mine/route.ts#GET': read,
  'app/api/stringing/jobs/route.ts#GET': {
    reason: 'read: the caller’s own jobs, or the bench for a stringer; Home’s stringing card on every open. Every write on a job re-reads (REREADS)',
  },

  // ── Writes that may stay blind, each for its own reason
  'app/api/players/route.ts#DELETE': {
    write: true,
    reason: 'an early 401 only; the self-cancel itself matches the row through requireGroupMember below (or the row’s deleteToken)',
  },
  'app/api/push/subscribe/route.ts#DELETE': {
    write: true,
    reason: 'removes the CALLER’S OWN device; Sign out everywhere deliberately keeps push devices (the plan), so a signed-out phone must still be able to stop its own notifications',
  },
};

/** The functions moved off the signature-only check. Each must call a
 *  re-reading helper and no signature-only one. */
const REREADS: string[] = [
  // Act inside the club as the member
  'app/api/stringing/jobs/[id]/route.ts#PATCH',
  'app/api/stringing/jobs/[id]/cancel/route.ts#POST',
  'app/api/stringing/jobs/[id]/accept/route.ts#POST',
  'app/api/stats/drills/done/route.ts#POST',
  'app/api/events/route.ts#POST',
  'app/api/games/route.ts#POST',
  'app/api/assessments/route.ts#POST',
  'app/api/equipment/gear/route.ts#authorizeBagWrite',
  'app/api/equipment/gear/route.ts#PUT',
  'app/api/push/subscribe/route.ts#POST',
  'app/api/players/route.ts#POST',
  'app/api/players/route.ts#PATCH',
  'app/api/members/me/route.ts#handleStatsPrivacyPatch',
  'app/api/members/me/route.ts#handleAvatarPatch',
  // Each of these hands back a credential or a fresh session — the ways a
  // signed-out phone would have signed itself back in.
  'app/api/members/me/route.ts#handlePatch',
  'app/api/members/me/route.ts#DELETE',
  'app/api/auth/identity/route.ts#DELETE',
  'app/api/auth/me/route.ts#GET',
  'app/api/auth/migrate/start/route.ts#POST',
  'app/api/auth/handoff/claim/route.ts#POST',
  'app/api/groups/route.ts#POST',
  'app/api/groups/switch/route.ts#POST',
  'app/api/groups/join/route.ts#POST',
  'lib/oauthCallback.ts#finishOAuthCallback',
  'lib/pageGate.ts#decidePage',
];

/**
 * THE ADMIN COOKIE. `isAdminAuthedWithMember` honours the cutoff (it re-reads
 * the doc the stamp lives on); the sync `isAdminAuthed` reads nothing and is
 * blind to it, exactly as it is blind to a demotion. That is fine for a READ —
 * the page gate already refused the signed-out phone — and it is the contract
 * the whole app leans on for writes. So every POST/PUT/PATCH/DELETE that calls
 * the sync check is listed here with why, and a new one fails the build.
 */
const ADMIN_SIGNATURE_ONLY = /\bisAdminAuthed\(/;
const ADMIN_SYNC_WRITES: Record<string, string> = {
  'app/api/games/route.ts#POST':
    'only the rule-7 sessionId override; the write itself is gated by verifyLiveMemberAuth or isAdminAuthedWithMember above it',
  'app/api/kudos/route.ts#POST':
    'only the rule-7 sessionId override; the rater is requireGroupMember, which already refuses a signed-out session',
  'app/api/players/route.ts#POST':
    'short-circuit only: `isAdminAuthed(req) && (await isAdminAuthedWithMember(req)).authed`, so no admin power rests on the signature',
};

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === 'node_modules' ? [] : files(p);
    return /\.tsx?$/.test(name) ? [p] : [];
  });
}

const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');

/** Every top-level function (or const) in app/ and lib/, keyed `path#name`. */
function topLevelFunctions(): Map<string, string> {
  const out = new Map<string, string>();
  for (const abs of [...files(join(ROOT, 'app')), ...files(join(ROOT, 'lib'))]) {
    const rel = relative(ROOT, abs).split(sep).join('/');
    const src = stripComments(readFileSync(abs, 'utf8'));
    const marks = [...src.matchAll(TOP_LEVEL)];
    marks.forEach((m, i) => {
      const key = `${rel}#${m[1] ?? m[2]}`;
      const body = src.slice(m.index, marks[i + 1]?.index ?? src.length);
      out.set(key, (out.get(key) ?? '') + body);
    });
  }
  return out;
}

const fns = topLevelFunctions();
const blind = [...fns].filter(([, body]) => SIGNATURE_ONLY.test(body)).map(([key]) => key);

describe('every caller of a cutoff-blind check is classified', () => {
  it('finds the callers at all (the scan is not vacuous)', () => {
    expect(blind.length).toBeGreaterThan(10);
    expect(fns.has('lib/auth.ts#verifyLiveMemberAuth')).toBe(true);
  });

  it('every function calling verifyMemberAuth or ownsNameOrAdmin is EXEMPT with a reason', () => {
    const unclassified = blind.filter((key) => !EXEMPT[key]);
    expect(
      unclassified,
      'These read the member cookie without the "Sign out everywhere" cutoff. A write that acts as the member uses ' +
        'verifyLiveMemberAuth (or requireGroupMember) — add it to REREADS; a read that may stay blind goes in EXEMPT with why.',
    ).toEqual([]);
  });

  it('no EXEMPT entry is stale', () => {
    const stale = Object.keys(EXEMPT).filter((key) => !blind.includes(key));
    expect(stale, 'No longer calls a cutoff-blind check — delete the entry.').toEqual([]);
  });

  it('exempting a write is explicit, and every reason says something', () => {
    for (const [key, entry] of Object.entries(EXEMPT)) {
      expect(entry.reason.length, key).toBeGreaterThan(10);
      const name = key.split('#')[1];
      if (MUTATING.has(name)) expect(entry.write, `${key} is a write: mark it write: true`).toBe(true);
    }
  });

  it('every REREADS function re-reads and none slid back to the signature alone', () => {
    for (const key of REREADS) {
      const body = fns.get(key);
      expect(body, `${key} not found — renamed? update REREADS`).toBeDefined();
      expect(REREADING.test(body!), `${key} must call a re-reading helper`).toBe(true);
      expect(SIGNATURE_ONLY.test(body!), `${key} calls a cutoff-blind check`).toBe(false);
    }
  });
});

describe('no write trusts the admin cookie’s signature alone', () => {
  const syncWrites = [...fns]
    .filter(([key, body]) => key.startsWith('app/') && MUTATING.has(key.split('#')[1]) && ADMIN_SIGNATURE_ONLY.test(body))
    .map(([key]) => key);

  it('every write calling the sync isAdminAuthed is listed with why', () => {
    const unlisted = syncWrites.filter((key) => !ADMIN_SYNC_WRITES[key]);
    expect(
      unlisted,
      'These writes check the admin cookie without re-reading it, so a demoted or signed-out-everywhere admin passes. ' +
        'Use isAdminAuthedWithMember, or list the function in ADMIN_SYNC_WRITES with why the sync check grants nothing.',
    ).toEqual([]);
  });

  it('no ADMIN_SYNC_WRITES entry is stale, and each re-reads somewhere', () => {
    for (const [key, reason] of Object.entries(ADMIN_SYNC_WRITES)) {
      expect(syncWrites, `${key} no longer calls the sync check — delete the entry`).toContain(key);
      expect(reason.length, key).toBeGreaterThan(10);
      expect(REREADING.test(fns.get(key)!) || /\bisAdminAuthedWithMember\(/.test(fns.get(key)!), `${key} re-reads nothing`).toBe(true);
    }
  });

  it('isAdminAuthedWithMember itself compares the cutoff', () => {
    expect(fns.get('lib/auth.ts#isAdminAuthedWithMember')).toMatch(/sessionRevoked\(payload\.iat, resource\.sessionsNotBefore\)/);
    expect(fns.get('lib/auth.ts#isAdminAuthedWithMember')).toMatch(/sessionRevoked\(payload\.iat, m\.sessionsNotBefore\)/);
  });
});
