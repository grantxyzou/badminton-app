/**
 * Who hears about stringing work, and when (docs/plans/stringing-audit-fixes.md).
 *
 * A NEW REQUEST goes to the ADMINS of the group, minus the requester. A
 * request arrives unassigned, and only an admin can claim or assign it; a
 * non-admin stringer's card shows just the jobs assigned to them, so a push
 * about an unclaimed request sent them to a screen that bounced them
 * (`?tab=admin`) or showed nothing (final review, 2026-10-11). Grant's "All
 * stringer" is honoured one step later: an ASSIGNMENT pushes the assignee,
 * which is the moment the work is theirs to do.
 *
 * Both resolve through the roster so a second club's people never hear about
 * this club's rackets — `pushSubscriptions` is person-scoped and nothing on
 * the row could separate them. Same contract as the player notices
 * (`lib/stringingNotifyDispatch.ts`): never throws, never fails the write it
 * rides on.
 */
import { rosterMembers } from './roster';
import { sendPushToMembers } from './push';
import { buildRequestPayload, buildAssignmentPayload } from './pushMessages';
import type { StringingJob } from './types';

export async function requestRecipients(groupId: string, requesterId: string): Promise<string[]> {
  const roster = await rosterMembers(groupId);
  return roster
    .filter(({ member }) => member.id !== requesterId && member.role === 'admin')
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

/** The assignee, and only them. The caller has already ruled out a self-claim. */
export async function notifyStringerOfAssignment(job: StringingJob): Promise<{ sent: number }> {
  if (!job.stringerId) return { sent: 0 };
  try {
    const { sent } = await sendPushToMembers([job.stringerId], buildAssignmentPayload(job));
    return { sent };
  } catch (err) {
    console.error('[stringing] assignment notify failed (the assignment stands):', err);
    return { sent: 0 };
  }
}
