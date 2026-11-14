import { rosterMemberIds } from '@/lib/roster';
import { sendPushToMembers } from '@/lib/push';
import { recordNotices } from '@/lib/notices';
import { listOrganisers, readGroup, rosterNameHolder } from '@/lib/groups';
import { getContainer } from '@/lib/cosmos';
import { sendJoinedEmail } from '@/lib/authEmail';
import { outboundOriginOrNull } from '@/lib/appOrigin';
import type { Member } from '@/lib/types';

/**
 * "Sandra Lee has joined BPM Core" on EVERY member's Notifications page
 * (Grant, 2026-11-07: "Anyone should get a notification (not push, just
 * passive one in the notification center)"). No push: a new name is club
 * news, not a reason to light up thirty lock screens.
 *
 * Called when a person actually becomes a member: an organiser approving
 * them at the door (`POST /api/admin/access-requests`). Invite joins called it
 * too until one-time invites were retired (docs/plans/one-way-in.md, step 5).
 * Not when an imported name is linked: that person was already on the list.
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
