import { getContainer } from './cosmos';
import { isFlagOn } from './flags';
import { readMembership, nameReservationId, findMembershipsByRosterName } from './groups';
import { groupScope, BPM_GROUP_ID } from './groupScope';
import type { NameReservation } from './types';

/**
 * Name → member id. THE single owner of that lookup, and it resolves the
 * ACTIVE row only.
 *
 * This existed as ten hand-copied variants across the API (stats/level,
 * stats/drills, stats/drills/done, stats/club/bands, assessments, kudos,
 * recommend, equipment/gear, stats/insight, plus lib/playerIdentity's
 * different-shaped `resolveIdentity`). They had drifted on the thing that
 * decides identity: six omitted `AND c.active = true` and three included it —
 * and `recommend`'s copy carried a comment demanding parity with
 * `equipment/gear` while saying nothing about the other six.
 *
 * Why it matters: `members` is partitioned on `/id`, so a `LOWER(c.name)`
 * lookup is CROSS-PARTITION and `resources[0]` with no `ORDER BY` is not a
 * stable pick. Yet that id is the storage key for drill completions
 * (`drillDocId(memberId, weekKey)`, PK `/memberId`), assessments (PK
 * `/memberId`), kudos and gear (`gear-<memberId>`).
 *
 * WHY TWO NAMED ENTRY POINTS AND NOT ONE WITH A FLAG
 * --------------------------------------------------
 * A `resolveMember(name, { activeOnly })` would make the CALL greppable while
 * moving the drift into the ARGUMENT — a reviewer scanning ten sites for a
 * boolean is the failure mode being fixed, not a fix for it. The differences
 * are encoded in the signatures instead, so picking the wrong one is a type
 * error or an obviously different return shape.
 *
 * Two real differences these signatures protect, both present in the copies:
 *   1. FALLBACK. Eight callers want a synthetic `name:<lower>` id for a
 *      non-member; `equipment/gear` wants `null` and must NOT get one, or it
 *      starts writing bag documents at `gear-name:foo`.
 *   2. ERRORS. The `name:`-fallback callers swallow a failed read and continue;
 *      `resolveActiveMemberId` propagates, so the caller can 500 rather than
 *      silently address a different partition.
 *
 * Projection is `SELECT c.id` everywhere: seven of the copies did `SELECT *`,
 * pulling `pinHash` and `recoveryCode` into scope to read one field.
 *
 * BOTH ENTRY POINTS TAKE THE GROUP FIRST (multi-group Phase 2). A route cannot
 * resolve a name unscoped, because with groups on the same name is a
 * different person in a different club. Flag off, the group is ignored and
 * the lookup is the `members` scan it always was.
 */

/** What every name-keyed route needs to address a member's data. */
export interface MemberSubject {
  /** Real `members.id`, or a synthetic `name:<lowercased>` for a non-member. */
  memberId: string;
  /** The trimmed name as given — what gets displayed and re-queried. */
  name: string;
  /** False when `memberId` is the synthetic fallback. */
  isMember: boolean;
}

const synthetic = (trimmed: string): MemberSubject => ({
  memberId: `name:${trimmed.toLowerCase()}`,
  name: trimmed,
  isMember: false,
});

/**
 * Shared core. ACTIVE-ONLY, with no way to ask for anything else.
 *
 * There was briefly a `resolveAnyMemberSubject` here preserving the six stats
 * routes' historical unfiltered behaviour, so the consolidation could land
 * without changing anything. Those routes were flipped once the production
 * audit came back clean, which left it with zero consumers — so it is gone
 * rather than sitting here as unreachable code that reads like an option.
 * Re-adding an unfiltered path means re-running that audit first.
 */
/**
 * WITH GROUPS ON a name means something only inside a group, and the group's
 * name-reservation doc is a POINT READ that names the member — no
 * cross-partition scan at all. The membership must still be ACTIVE: a
 * reservation outlives a removal only until the name is released, and a
 * removed person's data must not be addressable through their old name.
 */
async function lookupIdInGroup(groupId: string, name: string): Promise<string | null> {
  const held = await groupScope(groupId).read<NameReservation>('memberships', nameReservationId(groupId, name), groupId);
  if (!held || held.kind !== 'name') return null;
  const m = await readMembership(groupId, held.memberId);
  if (!m || m.status !== 'active') return null;
  // ACTIVE-ONLY holds for the person too: a soft-deleted Member (`active:
  // false`) must not resolve through a membership nobody updated, exactly as
  // the flag-off scan filters `c.active = true`.
  const { resource } = await getContainer('members').item(m.memberId, m.memberId).read<{ active?: boolean }>();
  return resource?.active === true ? m.memberId : null;
}

async function lookupId(groupId: string, name: string): Promise<string | null> {
  if (isFlagOn('NEXT_PUBLIC_FLAG_MULTI_GROUP')) return lookupIdInGroup(groupId, name);
  const { resources } = await getContainer('members')
    .items.query({
      query: 'SELECT c.id FROM c WHERE LOWER(c.name) = LOWER(@name) AND c.active = true',
      parameters: [{ name: '@name', value: name }],
    })
    .fetchAll();
  return (resources[0] as { id?: string } | undefined)?.id ?? null;
}

/**
 * ACTIVE-ONLY, no fallback, errors propagate. For callers that own a WRITE
 * keyed on the id and must never invent one — `equipment/gear` (bag documents
 * live at `gear-<id>`) and `stats/insight` (which returns an empty payload for
 * a non-member rather than narrating one).
 */
export async function resolveActiveMemberId(groupId: string, name: string): Promise<string | null> {
  return lookupId(groupId, name.trim());
}

/**
 * ACTIVE-ONLY with a `name:` fallback. For `recommend`, which reads gear at
 * `gear-<memberId>` and so must resolve the SAME id the gear write path used,
 * but still wants to serve a non-member a deterministic recommendation.
 */
export async function resolveActiveSubject(groupId: string, name: string): Promise<MemberSubject> {
  const trimmed = name.trim();
  try {
    const id = await lookupId(groupId, trimmed);
    if (id) return { memberId: id, name: trimmed, isMember: true };
  } catch {
    /* a failed read must not 500 a read-only surface — fall through */
  }
  return synthetic(trimmed);
}



// ---------------------------------------------------------------------------
// SIGNING IN BY NAME
// ---------------------------------------------------------------------------

/**
 * The most candidates a sign-in will verify a PIN against.
 *
 * This is a COST ceiling, not a tidiness one. Every candidate costs one scrypt
 * verification, which is deliberately slow, and this app runs on a B1 tier —
 * an unbounded candidate list would turn a common first name into a way to
 * spend the box's CPU from an unauthenticated endpoint. Five is the spec's
 * number. Past it the attempt fails generically and logs the count, rather
 * than truncating to five and quietly deciding among an arbitrary subset.
 */
export const MAX_SIGNIN_CANDIDATES = 5;

/** A member a name+PIN attempt might be, and the group its session would name. */
export interface SignInCandidate {
  /** The whole `members` document: the caller needs `pinHash` / `recoveryCode`. */
  member: Record<string, unknown> & { id: string; name: string };
  groupId: string;
}

export interface SignInCandidates {
  candidates: SignInCandidate[];
  /** Number found when that exceeded the cap; 0 otherwise. Never partially filled. */
  overCap: number;
}

async function readMemberDoc(id: string): Promise<SignInCandidate['member'] | null> {
  const { resource } = await getContainer('members').item(id, id).read<Record<string, unknown>>();
  if (!resource || resource.active !== true) return null;
  if (typeof resource.id !== 'string' || typeof resource.name !== 'string') return null;
  return resource as unknown as SignInCandidate['member'];
}

/**
 * WHO COULD THIS BE? — the candidate set a name+PIN sign-in must choose from.
 *
 * Three branches, and the flag-off one is the query this route has always run,
 * unchanged, so nothing observable moves until groups are on:
 *
 *   1. FLAG OFF — the `members` scan by name. One club, so `[0]` was never
 *      ambiguous; kept exactly as it was.
 *   2. FLAG ON, WITH CONTEXT (`groupId` from a cookie claim, or a join link in
 *      flight) — `resolveActiveMemberId`, which is the reservation point read
 *      plus the active-membership check. Not a fourth copy of that walk: this
 *      file exists because ten hand-rolled resolvers drifted apart on exactly
 *      that question.
 *   3. FLAG ON, NO CONTEXT — every ACTIVE membership holding the name, in any
 *      group. THIS is where a name stops identifying a person: two clubs can
 *      each have a Lin, and the PIN is what tells them apart.
 *
 * Deduped by MEMBER, not by membership: one person carrying the same roster
 * name in two clubs is two rows and one PIN match, and treating that as
 * ambiguous would lock them out of their own account. Which group their
 * session then names is the OLDEST `joinedAt` — the club they have been in
 * longest is the least surprising place to land, and Phase 3's group switcher
 * is how they go somewhere else. Sorted before the cap so the choice does not
 * depend on the order Cosmos happened to return rows in.
 */
export async function signInCandidates(name: string, groupId: string | null): Promise<SignInCandidates> {
  const trimmed = name.trim();

  if (!isFlagOn('NEXT_PUBLIC_FLAG_MULTI_GROUP')) {
    const { resources } = await getContainer('members')
      .items.query({
        query: 'SELECT * FROM c WHERE LOWER(c.name) = LOWER(@name) AND c.active = true',
        parameters: [{ name: '@name', value: trimmed }],
      })
      .fetchAll();
    const member = (resources ?? [])[0] as SignInCandidate['member'] | undefined;
    return { candidates: member ? [{ member, groupId: BPM_GROUP_ID }] : [], overCap: 0 };
  }

  if (groupId) {
    const id = await resolveActiveMemberId(groupId, trimmed);
    const member = id ? await readMemberDoc(id) : null;
    return { candidates: member ? [{ member, groupId }] : [], overCap: 0 };
  }

  const memberships = await findMembershipsByRosterName(trimmed);
  const oldestPerMember = new Map<string, string>();
  for (const m of memberships) {
    const held = oldestPerMember.get(m.memberId);
    if (held === undefined || String(m.joinedAt ?? '') < held) oldestPerMember.set(m.memberId, String(m.joinedAt ?? ''));
  }
  // `groupId` breaks the tie, and it has to: `String(m.joinedAt ?? '')`
  // collapses every missing value to the same key, and the backfill stamps
  // memberships from one `Member.createdAt`, so equal `joinedAt` across two
  // clubs is ordinary rather than exotic. Without this the group a person's
  // session names would depend on the order Cosmos returned rows in — a cookie
  // that differs between two identical sign-ins.
  const groupOf = new Map<string, string>();
  for (const m of memberships) {
    if (String(m.joinedAt ?? '') !== oldestPerMember.get(m.memberId)) continue;
    const held = groupOf.get(m.memberId);
    if (held === undefined || m.groupId < held) groupOf.set(m.memberId, m.groupId);
  }
  const ids = [...groupOf.keys()].sort();
  if (ids.length > MAX_SIGNIN_CANDIDATES) return { candidates: [], overCap: ids.length };

  const candidates: SignInCandidate[] = [];
  for (const id of ids) {
    const member = await readMemberDoc(id);
    if (member) candidates.push({ member, groupId: groupOf.get(id)! });
  }
  return { candidates, overCap: 0 };
}
