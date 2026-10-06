import { rosterMembers } from '@/lib/roster';
import { sendPushToMembers } from '@/lib/push';

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
