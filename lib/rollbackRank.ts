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
