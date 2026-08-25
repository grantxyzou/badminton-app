import { getContainer } from './cosmos';

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
async function lookupId(name: string): Promise<string | null> {
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
export async function resolveActiveMemberId(name: string): Promise<string | null> {
  return lookupId(name.trim());
}

/**
 * ACTIVE-ONLY with a `name:` fallback. For `recommend`, which reads gear at
 * `gear-<memberId>` and so must resolve the SAME id the gear write path used,
 * but still wants to serve a non-member a deterministic recommendation.
 */
export async function resolveActiveSubject(name: string): Promise<MemberSubject> {
  const trimmed = name.trim();
  try {
    const id = await lookupId(trimmed);
    if (id) return { memberId: id, name: trimmed, isMember: true };
  } catch {
    /* a failed read must not 500 a read-only surface — fall through */
  }
  return synthetic(trimmed);
}

