/**
 * "Still waiting" nudges for stringing requests nobody has moved
 * (docs/plans/stringing-request-nudge.md). Run once an hour per club by the
 * tick (`lib/tick.ts`).
 *
 * A request still at `requested` 48 hours after it was made, and again at 3
 * days, pushes:
 *   - nobody on it → every member with the stringer switch in this club, plus
 *     its organisers (groups off: the admins), minus the player who asked;
 *   - assigned → that stringer only. Their name is on it.
 *
 * Each nudge is stamped on the job (`requestNudgedAt`) BEFORE the push, under
 * the job's etag (`replace`), so a repeated or crashed tick can miss one but
 * never send one twice — the payment reminders' rule. A tick that was down past
 * both marks sends one push and stamps both; nobody gets a burst.
 *
 * No money and no spec in the push (the lock-screen rule every stringing push
 * keeps). Never throws past a single job: one bad row is logged and skipped.
 */
import { groupScope } from './groupScope';
import { rosterMembers } from './roster';
import { sendPushToMembers } from './push';
import { buildRequestWaitingPayload } from './pushMessages';
import { isArchived } from './stringingOrder';
import { nudgesDue, nudgesSent, waitingDays } from './stringingWaiting';
import type { StringingJob } from './types';

export interface NudgeRecipient {
  memberId: string;
  /** Where the push opens: the bench for an admin or organiser, the stringer's card otherwise. */
  opens: 'admin' | 'stringing';
}

/**
 * Who hears about a request nobody has taken: every stringer and every
 * organiser of THIS club, from the roster (a person in two clubs hears only
 * about the club whose request it is), minus the requester.
 */
export async function unclaimedRecipients(groupId: string, requesterId: string): Promise<NudgeRecipient[]> {
  const roster = await rosterMembers(groupId);
  const out: NudgeRecipient[] = [];
  for (const { member, membership } of roster) {
    if (member.id === requesterId) continue;
    // Groups on: the membership's rank. Groups off: no membership, and every
    // admin stands in for the organiser, as everywhere else with the flag off.
    const organiser = membership ? membership.role === 'owner' : member.role === 'admin';
    if (!organiser && member.canString !== true) continue;
    out.push({ memberId: member.id, opens: member.role === 'admin' ? 'admin' : 'stringing' });
  }
  return out;
}

export interface NudgeRunResult extends Record<string, number> {
  /** Requests at `requested` past the first mark. */
  waiting: number;
  /** Jobs a nudge was stamped on this run. */
  nudged: number;
  /** People the pushes were addressed to (summed over jobs). */
  recipients: number;
}

async function nudgeJob(groupId: string, job: StringingJob, now: number): Promise<number | null> {
  const due = nudgesDue(job, now);
  const sent = nudgesSent(job);
  if (due <= sent) return null;

  const scope = groupScope(groupId);
  const stamp = new Date(now).toISOString();
  const stamps = [...(job.requestNudgedAt ?? []), ...Array.from({ length: due - sent }, () => stamp)];
  // Stamp first, under the etag the read returned. `undefined` = gone or
  // changed since the read (taken, cancelled, archived): skip it this hour.
  const written = await scope.replace<StringingJob>('stringingJobs', { ...job, requestNudgedAt: stamps }, job.memberId);
  if (!written) return null;

  const recipients: NudgeRecipient[] = job.stringerId
    ? [{ memberId: job.stringerId, opens: 'stringing' }]
    : await unclaimedRecipients(groupId, job.memberId);
  if (recipients.length === 0) return 0;

  const days = waitingDays(job, now);
  for (const opens of ['admin', 'stringing'] as const) {
    const ids = recipients.filter((r) => r.opens === opens).map((r) => r.memberId);
    if (ids.length === 0) continue;
    await sendPushToMembers(ids, (locale) => buildRequestWaitingPayload(job, days, opens, locale));
  }
  return recipients.length;
}

export async function runStringingNudges(groupId: string, now: number): Promise<NudgeRunResult> {
  const scope = groupScope(groupId);
  const rows = await scope.query<StringingJob>('stringingJobs', {
    where: "c.status = @status AND (NOT IS_DEFINED(c.archivedAt) OR c.archivedAt = null)",
    params: [{ name: '@status', value: 'requested' }],
  });
  // Re-checked in JS: the mock store applies no WHERE it does not recognise.
  const live = rows.filter((j) => j.status === 'requested' && !isArchived(j) && !j.cancelledAt);

  const result: NudgeRunResult = { waiting: 0, nudged: 0, recipients: 0 };
  for (const job of live) {
    if (nudgesDue(job, now) === 0) continue;
    result.waiting += 1;
    try {
      const sentTo = await nudgeJob(groupId, job, now);
      if (sentTo !== null) {
        result.nudged += 1;
        result.recipients += sentTo;
      }
    } catch (err) {
      console.error('[stringing-nudge] a job failed (the others continue):', err);
    }
  }
  return result;
}
