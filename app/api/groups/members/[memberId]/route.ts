/**
 * `PATCH /api/groups/members/[memberId]` — make someone an admin, or stop.
 * `DELETE /api/groups/members/[memberId]` — take them off the roster.
 *
 * The group's own membership admin. It acts on the roster of the group the
 * ADMIN COOKIE names — there is no `?groupId=`, because a parameter would let
 * an admin of one club rewrite the roster of another, and rule 7's lesson
 * (an id override is admin-only) does not help when every caller here is an
 * admin of somewhere.
 *
 * THE OWNER IS UNTOUCHABLE from this route, both verbs. `setMembershipRole`
 * refuses to assign or overwrite `owner` and `removeFromRoster` refuses to
 * remove one, so ownership moves only through `reassignOwnership` and a group
 * can never end up with two owners or none. Those refusals resolve `undefined`
 * rather than throwing; this route turns that into a 403 with a reason instead
 * of a 404, because "that person is the owner" is actionable and "not found"
 * is not.
 *
 * AN ADMIN CANNOT ACT ON THEMSELVES here. Demoting or removing yourself is
 * leaving, which is a different intent with a different confirmation, and
 * conflating them means one mis-tap on a roster row costs an admin their
 * standing in their own club.
 */
import { NextRequest, NextResponse } from 'next/server';
import { isAdminAuthedWithMember, unauthorized } from '@/lib/auth';
import { readGroup, readMembership, removeFromRoster, setMembershipRole } from '@/lib/groups';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import { groupsOn, featureOff, rateLimited } from '@/lib/groupRoutes';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ memberId: string }> };

/**
 * The shared gate: rate limit, then admin of this group, acting on someone who
 * is not them and not the owner. The limit comes FIRST (rule 4) — admin-gated
 * or not, a replayed cookie should not be able to churn membership rows and
 * name reservations at volume.
 */
async function gate(req: NextRequest, memberId: string) {
  if (!checkRateLimit(`groups-roster:${getClientIp(req)}`, 60, 15 * 60 * 1000)) {
    return { error: rateLimited() };
  }
  const auth = await isAdminAuthedWithMember(req);
  if (!auth.authed) return { error: unauthorized() };
  if (memberId === auth.memberId) {
    return { error: NextResponse.json({ error: 'cannot_target_self' }, { status: 403 }) };
  }
  const group = await readGroup(auth.groupId);
  if (!group || group.closedAt) return { error: NextResponse.json({ error: 'not_found' }, { status: 404 }) };
  if (group.ownerMemberId === memberId) {
    return { error: NextResponse.json({ error: 'owner_immutable' }, { status: 403 }) };
  }
  const membership = await readMembership(auth.groupId, memberId);
  if (!membership || membership.status !== 'active') {
    return { error: NextResponse.json({ error: 'not_on_roster' }, { status: 404 }) };
  }
  return { groupId: auth.groupId };
}

export async function PATCH(req: NextRequest, { params }: Params) {
  if (!groupsOn()) return featureOff();
  const { memberId } = await params;

  try {
    // Auth BEFORE body parsing (rule 3). Not only the convention: validating
    // first would answer 400 for a malformed role and 401 for a well-formed
    // one, which tells an anonymous caller what this route accepts.
    const checked = await gate(req, memberId);
    if (checked.error) return checked.error;

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
    }
    const role = (body as Record<string, unknown>)?.role;
    if (role !== 'admin' && role !== 'member') {
      return NextResponse.json({ error: 'invalid_role' }, { status: 400 });
    }

    const updated = await setMembershipRole(checked.groupId!, memberId, role);
    if (!updated) return NextResponse.json({ error: 'not_on_roster' }, { status: 404 });
    return NextResponse.json({ memberId, role: updated.role, rosterName: updated.name });
  } catch (error) {
    console.error('PATCH /api/groups/members/[memberId]:', error);
    return NextResponse.json({ error: 'update_failed' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  if (!groupsOn()) return featureOff();
  const { memberId } = await params;

  try {
    const checked = await gate(req, memberId);
    if (checked.error) return checked.error;
    const removed = await removeFromRoster(checked.groupId!, memberId);
    if (!removed) return NextResponse.json({ error: 'not_on_roster' }, { status: 404 });
    return NextResponse.json({ memberId, status: removed.status });
  } catch (error) {
    console.error('DELETE /api/groups/members/[memberId]:', error);
    return NextResponse.json({ error: 'remove_failed' }, { status: 500 });
  }
}
