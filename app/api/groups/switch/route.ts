/**
 * `POST /api/groups/switch` — move this device into another of your clubs.
 *
 * A switch is a SIGN-IN, not a preference: it re-mints both cookies for the
 * new group through `completeSignIn`, which is what drops an `admin_session`
 * when you are an admin here and an ordinary member there. Writing the group
 * anywhere else — a third cookie, a localStorage key, a query parameter —
 * would let a client name a group the server never verified, which is the
 * whole reason the claim lives in a signed cookie.
 *
 * `completeSignIn` verifies the membership itself and falls back to BPM when
 * it cannot. This route checks FIRST anyway and refuses, because a silent
 * fallback is the right answer for a claim parked by an OAuth excursion and
 * the wrong one for a deliberate tap: "switch me to that club" must not
 * quietly land somewhere else.
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyMemberAuth, unauthorized } from '@/lib/auth';
import { completeSignIn } from '@/lib/authSession';
import { getContainer } from '@/lib/cosmos';
import { readGroup, readMembership } from '@/lib/groups';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import { groupsOn, featureOff, rateLimited, cleanString } from '@/lib/groupRoutes';
import type { Member } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  if (!checkRateLimit(`groups-switch:${ip}`, 30, 15 * 60 * 1000)) return rateLimited();
  if (!groupsOn()) return featureOff();

  const session = verifyMemberAuth(req);
  if (!session) return unauthorized();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }
  const groupId = cleanString((body as Record<string, unknown>)?.groupId, 1, 64);
  if (!groupId) return NextResponse.json({ error: 'invalid_group' }, { status: 400 });

  try {
    const membership = await readMembership(groupId, session.memberId);
    if (!membership || membership.status !== 'active') {
      return NextResponse.json({ error: 'not_a_member' }, { status: 403 });
    }
    const group = await readGroup(groupId);
    if (!group || group.closedAt) return NextResponse.json({ error: 'not_found' }, { status: 404 });

    const { resource: member } = await getContainer('members')
      .item(session.memberId, session.memberId)
      .read<Member>();
    if (!member || member.active !== true) return unauthorized();

    const res = NextResponse.json({
      id: group.id,
      name: group.name,
      role: membership.role,
      rosterName: membership.name,
    });
    await completeSignIn(res, member, group.id);
    return res;
  } catch (error) {
    console.error('POST /api/groups/switch:', error);
    return NextResponse.json({ error: 'switch_failed' }, { status: 500 });
  }
}
