/**
 * Tell the stringers a request came in (docs/plans/stringing-audit-fixes.md).
 *
 * RECIPIENTS: every `canString` member AND every admin of the GROUP, minus
 * the requester (Grant, 2026-10-11: "All stringer"). Admins are included
 * because the admin runs the bench and is not necessarily flagged; the
 * requester is excluded because a stringer asking for their own restring
 * already knows. Resolved through the roster so a second club's stringers
 * never hear about this club's rackets — `pushSubscriptions` is person-scoped
 * and nothing on the row could separate them.
 *
 * Same contract as the player notices (`lib/stringingNotifyDispatch.ts`):
 * never throws, never fails the request it rides on.
 */
import { rosterMembers } from './roster';
import { sendPushToMembers } from './push';
import { buildRequestPayload } from './pushMessages';
import type { StringingJob } from './types';

export async function requestRecipients(groupId: string, requesterId: string): Promise<string[]> {
  const roster = await rosterMembers(groupId);
  return roster
    .filter(
      ({ member }) =>
        member.id !== requesterId && (member.canString === true || member.role === 'admin'),
    )
    .map(({ member }) => member.id);
}

export async function notifyStringersOfRequest(
  job: StringingJob,
  groupId: string,
): Promise<{ recipients: number; sent: number }> {
  try {
    const ids = await requestRecipients(groupId, job.memberId);
    if (ids.length === 0) return { recipients: 0, sent: 0 };
    const { sent } = await sendPushToMembers(ids, buildRequestPayload(job));
    return { recipients: ids.length, sent };
  } catch (err) {
    console.error('[stringing] request notify failed (the request stands):', err);
    return { recipients: 0, sent: 0 };
  }
}
