/**
 * `GET /api/groups/current` — the club this request is in, as its own member
 * sees it. Name, your role, your roster name in it, how many people are on it.
 *
 * `requireGroupMember` is the gate, and it is the reason this is not simply
 * `readGroup(resolveGroupId(req))`: the cookie's claim says which group the
 * request is FOR, and the membership read says whether the caller is still in
 * it. A removed member holding a 30-day cookie gets a 401 here rather than the
 * roster size of a club they were shown the door from.
 *
 * The group doc is returned field by field rather than spread. Its siblings
 * carry invite secrets and its own shape will keep growing; a route that
 * spreads a document is a strip-canary waiting to happen.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireGroupMember, unauthorized } from '@/lib/auth';
import { listMemberships, readGroup } from '@/lib/groups';
import { groupsOn, featureOff } from '@/lib/groupRoutes';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  if (!groupsOn()) return featureOff();
  const session = await requireGroupMember(req);
  if (!session) return unauthorized();

  try {
    const group = await readGroup(session.groupId);
    if (!group || group.closedAt) return NextResponse.json({ error: 'not_found' }, { status: 404 });
    const roster = await listMemberships(group.id);
    return NextResponse.json({
      id: group.id,
      name: group.name,
      role: session.role,
      rosterName: session.name,
      isOwner: group.ownerMemberId === session.memberId,
      memberCount: roster.length,
      settings: group.settings,
    });
  } catch (error) {
    console.error('GET /api/groups/current:', error);
    return NextResponse.json({ error: 'read_failed' }, { status: 500 });
  }
}
