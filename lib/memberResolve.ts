import { getContainer } from './cosmos';

/**
 * Name → member id. THE single owner of that lookup.
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
 * WHY THREE NAMED ENTRY POINTS AND NOT ONE WITH A FLAG
 * ----------------------------------------------------
 * A `resolveMember(name, { activeOnly })` would make the CALL greppable while
 * moving the drift into the ARGUMENT — a reviewer scanning ten sites for a
 * boolean is the failure mode being fixed, not a fix for it. The differences
 * are encoded in the signatures instead, so picking the wrong one is a type
 * error or an obviously different return shape.
 *
 * Three real differences these signatures protect, all present in the copies:
 *   1. FALLBACK. Eight callers want a synthetic `name:<lower>` id for a
 *      non-member; `equipment/gear` wants `null` and must NOT get one, or it
 *      starts writing bag documents at `gear-name:foo`.
 *   2. ERRORS. The `name:`-fallback callers swallow a failed read and continue;
 *      `resolveActiveMemberId` propagates, so the caller can 500 rather than
 *      silently address a different partition.
 *   3. THE ACTIVE FILTER. See `resolveAnyMemberSubject` below.
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

/** Shared core. `activeOnly` is deliberately not exported — see the header. */
async function lookupId(name: string, activeOnly: boolean): Promise<string | null> {
  const { resources } = await getContainer('members')
    .items.query({
      query: activeOnly
        ? 'SELECT c.id FROM c WHERE LOWER(c.name) = LOWER(@name) AND c.active = true'
        : 'SELECT c.id FROM c WHERE LOWER(c.name) = LOWER(@name)',
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
  return lookupId(name.trim(), true);
}

/**
 * ACTIVE-ONLY with a `name:` fallback. For `recommend`, which reads gear at
 * `gear-<memberId>` and so must resolve the SAME id the gear write path used,
 * but still wants to serve a non-member a deterministic recommendation.
 */
export async function resolveActiveSubject(name: string): Promise<MemberSubject> {
  const trimmed = name.trim();
  try {
    const id = await lookupId(trimmed, true);
    if (id) return { memberId: id, name: trimmed, isMember: true };
  } catch {
    /* a failed read must not 500 a read-only surface — fall through */
  }
  return synthetic(trimmed);
}

/**
 * UNFILTERED — first row matching the name, active or not.
 *
 * This is the historical behaviour of the six stats/assessment/kudos routes and
 * is preserved EXACTLY here so the consolidation is provably behaviour-neutral.
 * It is not the desired end state: a name whose only row is soft-deleted
 * resolves here to that row's real id while the active-only variants fall
 * through to `name:<lower>`, so the two disagree for exactly that set.
 *
 * Unifying is gated on a production audit (2026-08-25: 68 rows, 0 duplicate
 * names, 0 rows with `active` undefined, 15 inactive of which 9 are test
 * fixtures and the remaining 6 hold no assessments and no level). Do not flip
 * these callers to the active-only variant without re-running that audit — the
 * risk is silent orphaning, not an error.
 */
export async function resolveAnyMemberSubject(name: string): Promise<MemberSubject> {
  const trimmed = name.trim();
  try {
    const id = await lookupId(trimmed, false);
    if (id) return { memberId: id, name: trimmed, isMember: true };
  } catch {
    /* fall through to the name-derived id */
  }
  return synthetic(trimmed);
}
