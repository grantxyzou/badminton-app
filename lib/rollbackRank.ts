/**
 * THE ROLLBACK COPY OF A BPM ADMIN'S RANK (2026-11-25).
 *
 * With groups on, nothing reads `Member.role`: a rank lives on the club's
 * membership. A flag-off rollback reads it again (`isAdminAuthedWithMember`,
 * `activeMemberFor`, the `payTo` fallback), alongside `Member.active`. Since a
 * removal no longer switches the account off (leaving a club is not leaving
 * the app), a BPM admin taken off BPM Core's list must lose this copy instead,
 * or the rollback would make them an admin again.
 */
import { getContainer } from './cosmos';
import { readMembership } from './groups';
import { BPM_GROUP_ID } from './groupScope';
import type { Member } from './types';

/**
 * Accounts whose rollback copy says `admin` while BPM Core's list does not
 * (no active BPM membership ranked admin or organiser): a demotion or removal
 * that wrote only the membership, from before 2026-11-25 or a `followRankDown`
 * that failed. A flag-off rollback would make each of them BPM's admin. The
 * migration counts them (`staleAdminCopies`) and its run drops them.
 */
export function staleAdminCopies<M extends { id: string; role?: string }>(
  members: M[],
  bpmMembershipOf: (memberId: string) => { status: string; role: string } | undefined,
): M[] {
  return members.filter((m) => {
    if (m.role !== 'admin') return false;
    const ms = bpmMembershipOf(m.id);
    return !(ms?.status === 'active' && (ms.role === 'admin' || ms.role === 'owner'));
  });
}

/** `Member.role = 'member'`, under `IfMatch` on a fresh read. A no-op for anyone not `admin`. */
export async function demoteRollbackRank(memberId: string): Promise<void> {
  const item = getContainer('members').item(memberId, memberId);
  for (let attempt = 0; attempt < 3; attempt++) {
    const { resource } = await item.read<Member & { _etag?: string }>();
    if (!resource || resource.role !== 'admin') return;
    try {
      await item.replace(
        { ...resource, role: 'member' },
        resource._etag ? { accessCondition: { type: 'IfMatch', condition: resource._etag } } : undefined,
      );
      return;
    } catch (err) {
      if ((err as { code?: number }).code === 412) continue;
      throw err;
    }
  }
  throw new Error('demoteRollbackRank kept conflicting');
}

/**
 * MAY THIS SWITCHED-OFF ACCOUNT BE TURNED BACK ON, from a club's admin action?
 * The one rule for every path that does it (Restore, an admin adding the name,
 * the migration's repair), so none of them carries a copy (third security
 * review, 2026-11-25).
 *
 * - Never one MERGED into another: that is what merging means.
 * - An account off while still ACTIVE on BPM Core's list was removed during a
 *   flag-off rollback (which writes only `Member.active`): only BPM's own
 *   admin may undo that. Any other club turning it on would undo a removal
 *   someone chose, and put a removed BPM admin back in charge.
 * - Everyone else off was locked out by the old removal and comes back.
 *
 * Returns the fields to write, or `null` to leave it off. The account keeps an
 * `admin` rollback rank only while it is BPM's admin.
 */
export async function revivalFor(callerGroupId: string, member: Member): Promise<{ active: true; role?: 'member' } | null> {
  if (member.active === true || member.mergedInto) return null;
  const bpm = await readMembership(BPM_GROUP_ID, member.id);
  const onBpm = bpm?.status === 'active';
  if (onBpm && callerGroupId !== BPM_GROUP_ID) return null;
  const bpmAdmin = onBpm && (bpm.role === 'admin' || bpm.role === 'owner');
  return { active: true, ...(member.role === 'admin' && !bpmAdmin ? { role: 'member' as const } : {}) };
}

/**
 * A BPM Core rank lowered to MEMBER takes the rollback copy with it: the
 * organiser's rank change (`PATCH /api/groups/members/[id]`), stepping down,
 * and the operator's override all write only the membership, so `Member.role`
 * kept saying `admin` and a flag-off rollback would make the person an admin
 * again (security review, 2026-11-25). A rank raised writes nothing here:
 * a rollback then reads them as a member, the safe direction. Another club's
 * ranks never touch the Member: flag-off IS BPM.
 */
export async function followRankDown(groupId: string, memberId: string, role: string): Promise<void> {
  if (groupId !== BPM_GROUP_ID || role !== 'member') return;
  // Best effort, and it never throws: it runs AFTER the rank change, which
  // has happened. A throw would answer "failed" for a step-down that took
  // effect (the person retries and is refused, being a member now) and skip
  // the operator's audit record. A copy it could not drop is counted by the
  // migration's status as `staleAdminCopies` and dropped by its run.
  try {
    await demoteRollbackRank(memberId);
  } catch (err) {
    console.error('[rollback-rank] could not drop the rollback copy for', memberId, err);
  }
}
