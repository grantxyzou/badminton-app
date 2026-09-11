/**
 * `GET /api/groups/mine` — every club this person belongs to.
 *
 * The person-side view, and the data behind "Your groups" on Profile. It is
 * the one place in the group API that deliberately crosses groups, which is
 * why it goes through `listMembershipsForMember` (the sanctioned cross-group
 * read in `lib/groups.ts`) rather than the scoped accessor — an accessor whose
 * entire job is to pin a query to one group cannot answer "which groups?".
 *
 * Scoped to the CALLER's own member id, taken from the cookie and never from a
 * parameter. A `?memberId=` here would be an enumeration of everyone's club
 * memberships, and member ids are not secret.
 *
 * A closed group is dropped: `reassignOwnership` closes a group whose last
 * member left, and nothing lists or joins one.
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyMemberAuth, unauthorized } from '@/lib/auth';
import { listMembershipsForMember, readGroup } from '@/lib/groups';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import { groupsOn, featureOff, rateLimited } from '@/lib/groupRoutes';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  // Rule 4: the limit comes before the auth check, so a replayed cookie cannot
  // get past it. This is the costliest read in the group API and the only one
  // whose cost the CALLER sets — `listMembershipsForMember` is a cross-partition
  // query on `memberships`, and it is followed by one `readGroup` point read
  // per club the caller belongs to, on a B1 tier.
  if (!checkRateLimit(`groups-mine:${getClientIp(req)}`, 60, 15 * 60 * 1000)) return rateLimited();
  if (!groupsOn()) return featureOff();
  const session = verifyMemberAuth(req);
  if (!session) return unauthorized();

  try {
    const memberships = (await listMembershipsForMember(session.memberId)).filter((m) => m.status === 'active');
    const groups = await Promise.all(
      memberships.map(async (m) => {
        const group = await readGroup(m.groupId);
        if (!group || group.closedAt) return null;
        return {
          id: group.id,
          name: group.name,
          role: m.role,
          rosterName: m.name,
          joinedAt: m.joinedAt,
          current: group.id === session.groupId,
        };
      }),
    );
    const list = groups.filter((g): g is NonNullable<typeof g> => g !== null);
    list.sort((a, b) => (a.joinedAt ?? '').localeCompare(b.joinedAt ?? '') || a.id.localeCompare(b.id));
    return NextResponse.json({ groups: list, currentGroupId: session.groupId });
  } catch (error) {
    console.error('GET /api/groups/mine:', error);
    return NextResponse.json({ error: 'list_failed' }, { status: 500 });
  }
}
