/**
 * Group scoping — which containers belong to a GROUP, which to a PERSON, and
 * which are one copy for the whole deployment.
 *
 * Phase 0 of `docs/plans/multi-group.md`. Nothing here changes behaviour yet;
 * it is the classification every later phase leans on, written as DATA so a
 * wrong decision is visible in a diff, in the same shape as `lib/memberPurge.ts`
 * and for the same reason: a table is only as good as the day it was written,
 * and `__tests__/group-scope-coverage.test.ts` fails the build when a container
 * appears in none of the three tables (or in two).
 *
 * THE RULE THAT MAKES ROLLBACK SAFE: BPM's existing ids are NEVER rewritten.
 * Group #1 (`'bpm'`) keeps `session-YYYY-MM-DD`, `active-session-pointer` and
 * the `stringing*` settings ids exactly as production holds them today; only a
 * NEW group gets a `${groupId}:` prefix (`groupDocId`). `groupId` itself is an
 * additive optional FIELD — Cosmos partition keys are immutable, so it is
 * filtered in queries, never made a key. Older code redeployed against the
 * migrated database reads it as an unknown field and carries on.
 *
 * THE MOCK-STORE TRAP, closed here rather than discovered later: the mock
 * (`lib/cosmos.ts`) filters by PARAMETER NAME from a closed allowlist, and an
 * unrecognised name means NO filter — every row comes back. An isolation test
 * written before the mock knew `@groupId` would pass because the fixture only
 * held one group. The mock now calls `matchesGroup`, and its tolerance for
 * unstamped rows is the SAME constant the real clause reads, so the two flip
 * together.
 */

/** Group #1. Every row in production today belongs to it. */
export const BPM_GROUP_ID = 'bpm';

/**
 * Transition tolerance. While `true`, a row with NO `groupId` is read as BPM's
 * — production data predates the field, and the backfill
 * (`POST /api/admin/migrate-groups`, Phase 2) stamps it in place. Flip to
 * `false` in Phase 5, only after that route's status read has shown zero
 * unstamped rows in every group-scoped container for a week.
 */
export const TOLERATE_UNSTAMPED = true;

/**
 * Filtered by `groupId` on every read, stamped on every write. Once the scoped
 * accessor lands (Phase 1) raw `getContainer` on one of these is a build error
 * outside an allowlist.
 */
export const GROUP_SCOPED = {
  sessions: 'a session is one club\'s night; the pointer doc is per group too',
  players: 'a roster line of one session; the cost split lives here',
  announcements: 'written by one club\'s admin to that club',
  skills: 'per-session skill scores, keyed by roster name within that session',
  gameResults: 'four roster names from one session',
  birds: 'shuttle purchases and stock adjustments — one club\'s inventory',
  aliases: 'e-transfer names read against one club\'s payments (security rule 10)',
  kudos: 'eligibility is co-play on one roster, and raterName is a roster name',
  stringingJobs: 'the bench is a club service; a job carries that club\'s rate card',
  clubSettings: 'shop sign, stocked strings, rate card — per club, per-group ids',
  events: 'an engagement happens inside one group\'s tabs; slice0 is a per-group readout',
  insights: 'narrates group play (partners, kudos); one cache doc per group per member',
} as const satisfies Readonly<Record<string, string>>;

/**
 * Keyed by the person; never filtered by group. Raw `getContainer` stays
 * allowed — but any club AGGREGATE over one of these (`stats/club/*`, the
 * level calibration, the sign-ups-open push broadcast) must be narrowed to the
 * group's roster first, or "the club" silently means "the database".
 */
export const PERSON_SCOPED = {
  members: 'the person: one account, one PIN, one email — many groups',
  identities: 'one email maps to one member DB-wide, atomically; that fits one-account-many-groups',
  playerGear: 'one gear bag per person, whichever club they play at',
  assessments: 'one skill self-assessment history per person',
  drillCompletions: 'a drill done is done, regardless of club',
  pushSubscriptions: 'one device row per person; the SENDER narrows by roster',
  authhandoff: 'ten-minute OAuth stash keyed by a hashed ref, no group context',
  authmigration: 'five-minute PWA-to-native stash, no group context',
} as const satisfies Readonly<Record<string, string>>;

/** One copy for the whole deployment. */
export const GLOBAL = {
  equipmentCatalog: 'the racket/string catalog; seeded, not user data',
  releases: 'the app\'s own changelog',
  feedback: 'reports go to the operator, not to a group admin; groupId is context only',
} as const satisfies Readonly<Record<string, string>>;

export type GroupContainer = keyof typeof GROUP_SCOPED;

/**
 * Document id for a group-scoped singleton or date-keyed doc. BPM keeps the
 * legacy id; any other group is prefixed. `sessions` has `id === sessionId ===
 * PK`, so without this two groups playing the same date would 409 on create.
 */
export function groupDocId(groupId: string, id: string): string {
  return groupId === BPM_GROUP_ID ? id : `${groupId}:${id}`;
}

/** The prefix every session id in a group starts with — replaces `startsWith('session-')`. */
export function sessionPrefix(groupId: string): string {
  return groupDocId(groupId, 'session-');
}

/**
 * Does this row belong to `groupId`? The single predicate the mock store uses
 * for `@groupId`, and that the scoped accessor will re-check in JS on every
 * returned row (belt and braces against a query that forgot the clause).
 */
export function matchesGroup(
  row: { groupId?: unknown },
  groupId: string,
  tolerate: boolean = TOLERATE_UNSTAMPED,
): boolean {
  if (row.groupId === groupId) return true;
  return tolerate && row.groupId === undefined && groupId === BPM_GROUP_ID;
}
