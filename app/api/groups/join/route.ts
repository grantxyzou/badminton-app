/**
 * `POST /api/groups/join` — redeem an invite link or a join code.
 *
 * The second onboarding door. It requires a live `member_session`: an invite
 * admits an IDENTIFIED person to a roster, never an anonymous one, so a leaked
 * link costs a club a known name it can remove rather than a ghost it cannot.
 * The doors put "create an account" in front of this for exactly that reason.
 *
 * What it grants is `role: 'member'`. There is no approval queue by design
 * (the spec's "invite link or code with no approval queue") and no path here
 * that mints an admin — `app/api/groups/members/[memberId]` is where a role
 * moves, and that route is admin-gated.
 *
 * IDEMPOTENT for someone already on the roster: `addMembership` returns their
 * existing row unchanged, so a second tap on the same link re-enters the club
 * without resetting the role or the join date. Someone who LEFT or was removed
 * rejoins under a fresh role — and may find their old roster name taken, which
 * is the 409 below and the reason the name is part of this request.
 *
 * It finishes with `completeSignIn` for the new group: joining a club and then
 * still being in the old one is not what anybody means by tapping an invite.
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyMemberAuth, unauthorized } from '@/lib/auth';
import { completeSignIn } from '@/lib/authSession';
import { getContainer } from '@/lib/cosmos';
import { addMembership, readGroup, readMembership, RosterNameTakenError } from '@/lib/groups';
import { resolveInvite } from '@/lib/invites';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import {
  groupsOn,
  featureOff,
  rateLimited,
  cleanString,
  ROSTER_NAME_MIN,
  ROSTER_NAME_MAX,
} from '@/lib/groupRoutes';
import type { Member } from '@/lib/types';

export const dynamic = 'force-dynamic';

/** One shape for every invite miss, matching `preview` — see its header. */
function noSuchInvite(): NextResponse {
  return NextResponse.json({ error: 'invite_not_found' }, { status: 404 });
}

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  if (!checkRateLimit(`groups-join:${ip}`, 10, 60 * 60 * 1000)) return rateLimited();
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
  const token = cleanString(input.token, 1, 128);
  const code = cleanString(input.code, 1, 64);
  if ((!token && !code) || (token && code)) return noSuchInvite();

  try {
    const groupId = token ? await resolveInvite(token, 'invite') : await resolveInvite(code!, 'code');
    if (!groupId) return noSuchInvite();
    const group = await readGroup(groupId);
    if (!group || group.closedAt) return noSuchInvite();

    const { resource: member } = await getContainer('members')
      .item(session.memberId, session.memberId)
      .read<Member>();
    if (!member || member.active !== true) return unauthorized();

    const rosterName =
      cleanString(input.name, ROSTER_NAME_MIN, ROSTER_NAME_MAX) ??
      cleanString(member.name, ROSTER_NAME_MIN, ROSTER_NAME_MAX);
    if (!rosterName) return NextResponse.json({ error: 'invalid_roster_name' }, { status: 400 });

    // Asked BEFORE the write, because `addMembership` is idempotent and its
    // return value cannot tell "already in" from "just joined".
    const wasMember = (await readMembership(group.id, member.id))?.status === 'active';

    const membership = await addMembership({
      groupId: group.id,
      memberId: member.id,
      name: rosterName,
      role: 'member',
      joinedVia: token ? 'link' : 'code',
    });

    const res = NextResponse.json({
      id: group.id,
      name: group.name,
      role: membership.role,
      rosterName: membership.name,
      /** False when they were already on this roster — the sheet says "welcome back". */
      joined: !wasMember,
    });
    // PAST THE MEMBERSHIP WRITE, NOTHING RECOVERABLE MAY FAIL THE REQUEST —
    // the same rule `POST /api/groups` states at its own `completeSignIn`.
    // Unwrapped, a throw here fell to the catch-all below and answered 500
    // `join_failed` for a join that had already committed. The retry then found
    // `addMembership` idempotent, returned the existing row, and came back
    // `joined: false` — so the sheet said "welcome back" on what was really a
    // first join, and the cookie was never minted, leaving them pointed at
    // their old club. A missing cookie is recoverable on the next sign-in; a
    // lie about which club you are in is not.
    try {
      await completeSignIn(res, member, group.id);
    } catch (err) {
      console.error('POST /api/groups/join: joined, cookie mint failed (recoverable):', err);
    }
    return res;
  } catch (error) {
    if (error instanceof RosterNameTakenError) {
      // Name the constraint and the fix, the way `POST /api/members` does — a
      // 409 that only says "taken" leaves the person with nothing to try.
      return NextResponse.json(
        {
          error: 'roster_name_taken',
          message: 'Someone in this group already goes by that name. Pick a different one to join.',
        },
        { status: 409 },
      );
    }
    console.error('POST /api/groups/join:', error);
    return NextResponse.json({ error: 'join_failed' }, { status: 500 });
  }
}
