import { rosterMembers, rosterMemberIds } from '@/lib/roster';
import { sendPushToMembers } from '@/lib/push';
import { recordNotices } from '@/lib/notices';
import { listOrganisers, readGroup, rosterNameHolder } from '@/lib/groups';
import { getContainer } from '@/lib/cosmos';
import { sendJoinedEmail } from '@/lib/authEmail';
import { outboundOriginOrNull } from '@/lib/appOrigin';
import type { Member } from '@/lib/types';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/**
 * Tell a club's admins that somebody new just joined.
 *
 * Grant, 2026-10-06: "can we get people to create an account with an invite
 * link. Then they can just create an account and use the service? Admins just
 * get an update on who is new and joined." The first half is the design: an
 * invite admits a person, no approval step. This is the second half. Without
 * it a new name simply appeared on the roster, and the admin who shared the
 * link found out on sign-up day.
 *
 * Called from the three places a person can join a club by invite: both
 * sign-up terminals (`POST /api/auth/signup`, `POST /api/auth/complete-signup`)
 * and `POST /api/groups/join`. BEST-EFFORT, like the access-request and
 * stringing notices: push failing, or nobody having opted in, never fails the
 * join — the person is already in.
 *
 * Recipients are the club's admins by ROSTER (`rosterMembers`, which is
 * flag-aware: memberships with the flag on, `Member.role` with it off), never
 * the joiner, who is not an admin yet anyway. The body carries the NAME and
 * nothing else: a banner renders on a lock screen, and an email address has
 * no business there.
 */
export async function notifyAdminsOfJoin(groupId: string, joiner: { id: string; name: string }): Promise<void> {
  // Everyone hears it on the Notifications page too (no push), the same
  // notice the door approval writes.
  await noticeClubOfJoin(groupId, joiner);
  try {
    const roster = await rosterMembers(groupId);
    const adminIds = roster
      // `active` re-checked in JS: with the flag off the roster is a members
      // scan, and the mock store applies no WHERE.
      .filter((r) => r.member.role === 'admin' && r.member.active === true && r.member.id !== joiner.id)
      .map((r) => r.member.id);
    if (adminIds.length === 0) return;
    await sendPushToMembers(adminIds, {
      title: 'Someone new joined',
      body: `${joiner.name} joined with an invite.`,
      url: `${BASE}/?tab=admin`,
      // One banner per joiner: a phone that was offline for a day gets each
      // new name once, not a stack of the same one.
      tag: `join-${joiner.id}`,
    });
  } catch (err) {
    console.error('join notice failed:', err);
  }
}

/**
 * "Sandra Lee has joined BPM Core" on EVERY member's Notifications page
 * (Grant, 2026-11-07: "Anyone should get a notification (not push, just
 * passive one in the notification center)"). No push: a new name is club
 * news, not a reason to light up thirty lock screens.
 *
 * Called when a person actually becomes a member: an organiser approving
 * them at the door (`POST /api/admin/access-requests`) and every invite join
 * (through `notifyAdminsOfJoin`). Not when an imported name is claimed — that
 * person was already on the list.
 *
 * Recipients are the club's ACTIVE roster (`rosterMemberIds`), minus the new
 * person. Stores the name and the club's name at that moment, nothing else.
 * Never throws: the join already happened.
 */
export async function noticeClubOfJoin(groupId: string, joiner: { id: string; name: string }): Promise<void> {
  try {
    const [ids, group] = await Promise.all([rosterMemberIds(groupId), readGroup(groupId).catch(() => null)]);
    const recipients = [...ids].filter((id) => id !== joiner.id);
    if (recipients.length === 0) return;
    await recordNotices(groupId, recipients, {
      type: 'member_joined',
      memberName: joiner.name,
      club: group?.name?.trim() || undefined,
    });
  } catch (err) {
    console.error('join notice (club) failed:', err);
  }
}

/**
 * Someone asked to join through the club's link: tell its ORGANISERS (only an
 * organiser lets anyone in through the link, docs/plans/door-link.md). Moved
 * here from the ask route so the account-first ask (docs/plans/one-way-in.md,
 * step 4) sends the same push. Best-effort, never throws.
 */
export async function notifyOrganisersOfJoinRequest(groupId: string, requestId: string, name: string): Promise<void> {
  try {
    const [organisers, group] = await Promise.all([listOrganisers(groupId), readGroup(groupId)]);
    const ids = organisers.map((m) => m.memberId);
    if (ids.length === 0) return;
    const club = group?.name?.trim() || 'your club';
    // Taken already (a removed member's, or an imported name): still asked, so say so up front.
    const taken = (await rosterNameHolder(groupId, name)) !== null;
    await sendPushToMembers(ids, {
      title: 'Someone wants to join',
      body: taken ? `${name} is asking to join ${club}. That name is taken.` : `${name} is asking to join ${club}.`,
      url: `${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/?tab=admin`,
      tag: `join-${requestId}`,
    });
  } catch (err) {
    console.error('join-request push failed:', err);
  }
}

/**
 * An organiser let this account in (docs/plans/one-way-in.md, step 4). Tell
 * the person: an email to the address they signed in with, because a new
 * account rarely has notifications on and they may have closed the app
 * (Grant, 2026-11-13: "Email, plus push if on"), and a push for the phones
 * that do. Best-effort, never throws: the membership is already written.
 */
export async function tellJoinerTheyAreIn(groupId: string, memberId: string): Promise<void> {
  try {
    const [group, read] = await Promise.all([
      readGroup(groupId),
      getContainer('members').item(memberId, memberId).read<Member>(),
    ]);
    const member = read.resource;
    if (!group || !member) return;
    const club = group.name?.trim() || 'your club';
    const base = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
    await sendPushToMembers([memberId], {
      title: `You're in ${club}`,
      body: 'Open the app to sign up for the next session.',
      url: `${base}/`,
      tag: `joined-${groupId}`,
    });
    if (typeof member.email === 'string' && member.email) {
      const origin = outboundOriginOrNull();
      await sendJoinedEmail(member.email, member.name, club, origin ? `${origin}${base}` : null);
    }
  } catch (err) {
    console.error('joined notice failed:', err);
  }
}
