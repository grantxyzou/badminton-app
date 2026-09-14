import { getContainer } from '@/lib/cosmos';
import { openRequests, type StoredAccessRequest } from '@/lib/accessRequest';
import type { Member } from '@/lib/types';

/**
 * Read-modify-write of a member's access requests, under `IfMatch`.
 *
 * The list is only safe if nobody's entry can vanish, and a plain upsert lets
 * two asks that land together each write back a list missing the other's —
 * the displaced one polls into `none`, which is the F2 symptom arrived at by a
 * race instead of on purpose. So the write is conditioned on the etag it read
 * and retried from a fresh read on a 412.
 *
 * `change` receives the member's OPEN requests (expired ones already pruned,
 * the legacy single field folded in) and returns the list to store, or `null`
 * to write nothing. The result is what was stored, or `null` when the member is
 * gone or `change` declined.
 */
export async function updateAccessRequests(
  memberId: string,
  change: (open: Array<StoredAccessRequest & { id: string }>, member: Member) =>
    StoredAccessRequest[] | null,
): Promise<{ member: Member; stored: StoredAccessRequest[] } | null> {
  const container = getContainer('members');
  for (let attempt = 0; attempt < 3; attempt++) {
    const { resource } = await container.item(memberId, memberId).read<Member & { _etag?: string }>();
    if (!resource) return null;
    const next = change(openRequests(resource), resource);
    if (next === null) return null;

    // The legacy field is dropped on every write, so a doc is promoted the
    // first time anything touches it.
    const { accessRequest: _legacy, ...rest } = resource;
    const doc = { ...rest, accessRequests: next };
    try {
      await container.items.upsert(
        doc,
        resource._etag ? { accessCondition: { type: 'IfMatch', condition: resource._etag } } : undefined,
      );
      return { member: resource, stored: next };
    } catch (err) {
      if ((err as { code?: number }).code === 412) continue;
      throw err;
    }
  }
  throw new Error('access request write kept conflicting');
}
