/**
 * PATCH /api/members/me/name — "What should the club call you?"
 * (docs/plans/profile-nickname.md; Grant, 2026-11-08, after "one name, what
 * about a username like an alias?").
 *
 * A member changes the name THIS CLUB knows them by: their roster name, the
 * one the sign-up list, kudos and receipts show. There is no second name: a
 * nickname is just the roster name, set by the person rather than the
 * organiser. Before this, only an organiser could change it (the Roster).
 *
 * WHO: the caller's own `member_session`, re-checked live
 * (`verifyLiveMemberAuth`). No name or id in the body: a name-keyed version
 * would let anyone rename anyone.
 *
 * UNIQUE IN THE CLUB: the club's name reservation is the clash check, exactly
 * as the organiser's rename is — a taken name answers 409 `name_taken` and
 * nothing changes. Another club's same name is no clash.
 *
 * AFTER: the cookie is re-minted with the new name (some reads still key on
 * the cookie's name), this week's sign-up rows and the club's e-transfer
 * aliases follow (`carryRosterRename`), and BPM's Member copy is written for
 * rollback, as the organiser's rename does.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getContainer } from '@/lib/cosmos';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import { verifyLiveMemberAuth, setMemberCookie } from '@/lib/auth';
import { resolveGroupId } from '@/lib/groupContext';
import { BPM_GROUP_ID } from '@/lib/groupScope';
import { groupsOn } from '@/lib/groupRoutes';
import { readMembership, renameRosterMember, rosterNameHolder, RosterNameTakenError } from '@/lib/groups';
import { ROSTER_NAME_MAX } from '@/lib/nameLimits';
import { carryRosterRename } from '@/lib/rosterRename';
import { resolveActiveMemberId } from '@/lib/memberResolve';
import type { Member } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function PATCH(req: NextRequest) {
  // Rule 4: rate limit first.
  const ip = getClientIp(req);
  if (!checkRateLimit(`member-rename:${ip}`, 10, 60 * 60 * 1000)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }

  const auth = await verifyLiveMemberAuth(req);
  if (!auth) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => null);
  const name = body && typeof body.name === 'string' ? body.name.trim().replace(/\s+/g, ' ') : '';
  if (!name || [...name].length > ROSTER_NAME_MAX) {
    return NextResponse.json({ error: 'invalid_name' }, { status: 400 });
  }

  const groupId = groupsOn() ? resolveGroupId(req) : BPM_GROUP_ID;
  const members = getContainer('members');

  try {
    const { resource: member } = await members.item(auth.memberId, auth.memberId).read<Member>();
    if (!member || member.active !== true) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

    let oldName = member.name;
    if (groupsOn()) {
      const membership = await readMembership(groupId, auth.memberId);
      if (!membership || membership.status !== 'active') {
        return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
      }
      oldName = membership.name;
      if (oldName === name) return NextResponse.json({ ok: true, name });
      const holder = await rosterNameHolder(groupId, name);
      if (holder && holder !== auth.memberId) return NextResponse.json({ error: 'name_taken' }, { status: 409 });
      try {
        await renameRosterMember(groupId, auth.memberId, name);
      } catch (err) {
        if (err instanceof RosterNameTakenError) return NextResponse.json({ error: 'name_taken' }, { status: 409 });
        throw err;
      }
    } else {
      if (oldName === name) return NextResponse.json({ ok: true, name });
      // Groups off is BPM alone: the one owner of name → member answers.
      const holder = await resolveActiveMemberId(BPM_GROUP_ID, name);
      if (holder && holder !== auth.memberId) return NextResponse.json({ error: 'name_taken' }, { status: 409 });
    }

    // BPM's Member copy is the rollback copy (flag off IS BPM), as in the
    // organiser's rename. Another club's name never touches the person.
    if (!groupsOn() || groupId === BPM_GROUP_ID) {
      await members.items.upsert({ ...member, name });
    }

    await carryRosterRename(groupId, auth.memberId, oldName, name);

    const res = NextResponse.json({ ok: true, name });
    setMemberCookie(res, auth.memberId, name, groupId);
    return res;
  } catch (err) {
    console.error('PATCH /api/members/me/name failed:', err);
    return NextResponse.json({ error: 'write_failed' }, { status: 503 });
  }
}
