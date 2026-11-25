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
