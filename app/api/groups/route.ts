/**
 * `POST /api/groups` — create a club.
 *
 * The first of the three onboarding doors ("Create a group"). The caller is
 * already a person: an account exists and a `member_session` proves it, which
 * is what lets the new group's owner be a member id rather than a name. The
 * door that comes BEFORE this one — creating the account — is the existing
 * sign-up path and is not re-implemented here.
 *
 * Three writes, in this order, and the order matters:
 *   1. `createGroup` — the group doc, then the owner's membership, which
 *      reserves their roster name (a fresh group, so it cannot be taken).
 *   2. `mintInvite` — so the group is shareable the moment it exists. A club
 *      that has to go looking for its invite link is a club whose first
 *      session has nobody in it.
 *   3. `completeSignIn` — re-mint both cookies FOR THE NEW GROUP, so the
 *      creator lands inside it as owner without a second round trip. That call
 *      also verifies the membership it is minting for, which is why the group
 *      must already exist at this point.
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyMemberAuth, unauthorized } from '@/lib/auth';
import { completeSignIn } from '@/lib/authSession';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import { getContainer } from '@/lib/cosmos';
import { createGroup, listMembershipsForMember, RosterNameTakenError } from '@/lib/groups';
import { mintInvite } from '@/lib/invites';
import {
  groupsOn,
  featureOff,
  rateLimited,
  cleanString,
  GROUP_NAME_MIN,
  GROUP_NAME_MAX,
  ROSTER_NAME_MIN,
  ROSTER_NAME_MAX,
  MAX_OWNED_GROUPS,
} from '@/lib/groupRoutes';
import type { Member } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  // Rate limit before auth (rule 4).
  const ip = getClientIp(req);
  if (!checkRateLimit(`groups-create:${ip}`, 5, 60 * 60 * 1000)) return rateLimited();
  if (!groupsOn()) return featureOff();

  const session = verifyMemberAuth(req);
  if (!session) return unauthorized();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }
  const input = (body ?? {}) as Record<string, unknown>;

  const name = cleanString(input.name, GROUP_NAME_MIN, GROUP_NAME_MAX);
  if (!name) return NextResponse.json({ error: 'invalid_name' }, { status: 400 });

  try {
    // The cookie proves the session; the doc proves the person is still active.
    const { resource: member } = await getContainer('members')
      .item(session.memberId, session.memberId)
      .read<Member>();
    if (!member || member.active !== true) return unauthorized();

    // Their roster name in the new club defaults to the name they already go by.
    const rosterName =
      cleanString(input.rosterName, ROSTER_NAME_MIN, ROSTER_NAME_MAX) ??
      cleanString(member.name, ROSTER_NAME_MIN, ROSTER_NAME_MAX);
    if (!rosterName) return NextResponse.json({ error: 'invalid_roster_name' }, { status: 400 });

    const owned = (await listMembershipsForMember(member.id)).filter(
      (m) => m.status === 'active' && m.role === 'owner',
    );
    if (owned.length >= MAX_OWNED_GROUPS) {
      return NextResponse.json({ error: 'too_many_groups' }, { status: 409 });
    }

    const { group } = await createGroup({ name, ownerMemberId: member.id, ownerName: rosterName });
    const invite = await mintInvite(group.id, member.id);

    const res = NextResponse.json(
      {
        group: { id: group.id, name: group.name, settings: group.settings },
        role: 'owner',
        rosterName,
        invite,
      },
      { status: 201 },
    );
    await completeSignIn(res, member, group.id);
    return res;
  } catch (error) {
    if (error instanceof RosterNameTakenError) {
      return NextResponse.json({ error: 'roster_name_taken' }, { status: 409 });
    }
    console.error('POST /api/groups:', error);
    return NextResponse.json({ error: 'create_failed' }, { status: 500 });
  }
}
