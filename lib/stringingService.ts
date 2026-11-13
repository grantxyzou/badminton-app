/**
 * Is the stringing service on for a club? (docs/plans/stringing-add-on.md, phase 1)
 *
 * Two switches, and both must be on: the deployment's `NEXT_PUBLIC_FLAG_STRINGING`
 * (the kill switch for everyone) and the club's own `run.stringing`, set on
 * "How your club runs". A club with stringing off has no Stringing tab, no
 * bench and takes no new requests.
 *
 * A setting never hides money owed: the settings route refuses to switch the
 * service off while a job is still open or unpaid (`isOpenStringingJob`), so
 * by the time it is off there is nothing on the bench and nothing on anyone's
 * balance. Reads and moves on existing jobs are never refused for it.
 */

import { clubRunOf, type ClubRun } from './clubRun';
import { isFlagOn } from './flags';
import { readGroup } from './groups';
import { groupScope } from './groupScope';
import { isBillable } from './stringingBilling';
import { walkUpJobClosed } from './stringing';

/** The pure reading, for a screen that already holds the club's run. */
export function stringingServiceOn(run: Pick<ClubRun, 'stringing'>): boolean {
  return isFlagOn('NEXT_PUBLIC_FLAG_STRINGING') && run.stringing === 'on';
}

/**
 * The server's reading for one club. Fails OPEN on a read error: refusing a
 * request because one settings read failed would close a working shop, and
 * the job's own write would fail on a real outage anyway.
 */
export async function stringingServiceOnFor(groupId: string): Promise<boolean> {
  if (!isFlagOn('NEXT_PUBLIC_FLAG_STRINGING')) return false;
  try {
    const group = await readGroup(groupId);
    return clubRunOf(group?.settings).stringing === 'on';
  } catch {
    return true;
  }
}

type JobLike = {
  status?: string;
  cancelledAt?: string | null;
  archivedAt?: string | null;
  priceCents?: number | null;
  paidAt?: string | null;
};

/** Still on the bench, or finished and not yet paid for. */
export function isOpenStringingJob(job: JobLike): boolean {
  if (job.cancelledAt) return false;
  if (!walkUpJobClosed(job)) return true;
  return isBillable({ priceCents: job.priceCents ?? null, paidAt: job.paidAt ?? null, status: job.status ?? '' });
}

/** How many of the club's jobs keep the service from being switched off. */
export async function openStringingJobCount(groupId: string): Promise<number> {
  const rows = await groupScope(groupId).query<JobLike>('stringingJobs', {
    select: 'c.id, c.status, c.cancelledAt, c.archivedAt, c.priceCents, c.paidAt',
  });
  return rows.filter(isOpenStringingJob).length;
}
