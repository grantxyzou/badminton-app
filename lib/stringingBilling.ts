/**
 * When does a stringing job become money someone owes?
 *
 * A QUOTE IS A RANGE; A BILL IS A NUMBER.
 *
 * The rest of this feature works hard to keep the stringer's exact figure off
 * a player's screen — `toPlayerJob` replaces it with a quantised band, and
 * there are tests asserting on the serialised response body. That rule is
 * about a PROVISIONAL price: what your racket will cost depends on the string,
 * the request, and what the stringer decides, and a precise-looking number
 * before any of that is settled would be a promise nobody made.
 *
 * A balance line is the opposite situation. You cannot total a range, and you
 * cannot ask someone to pay one. Once the racket is done and priced, the
 * player has to be told exactly what to hand over. So the band applies until a
 * job is billable and the exact figure applies from then on — which is not a
 * hole in the wall, it is where the wall was always meant to end.
 *
 * BILLABLE means all three of:
 *   - PRICED. No price, no bill. An unpriced job is not free, it is undecided,
 *     and it stays off the balance rather than appearing as $0.
 *   - NOT PAID. `paidAt` is the stringer's record of having been paid.
 *   - DONE. `ready` or `picked_up` only. Billing for work still on the bench
 *     asks someone to pay for a racket they cannot use yet — and lets a job
 *     that gets corrected backwards un-bill itself, which is worse than
 *     billing late.
 */
import type { StringingJob } from './types';

export interface StringingCharge {
  jobId: string;
  jobNo: string;
  racketLabel: string;
  /** Dollars, matching the session lines this sits beside on the receipt. */
  amount: number;
  /** ISO — when the racket was finished, for ordering the receipt. */
  at: string;
}

/** Statuses at which the work is finished and the money is due. */
const BILLABLE_STATUSES = new Set(['ready', 'picked_up']);

export function isBillable(job: {
  priceCents: number | null;
  paidAt: string | null;
  status: string;
}): boolean {
  if (typeof job.priceCents !== 'number' || job.priceCents <= 0) return false;
  if (job.paidAt !== null) return false;
  return BILLABLE_STATUSES.has(job.status);
}

/**
 * The charges a player owes for stringing, newest first.
 *
 * Returns dollars rather than cents because it lands on the same receipt as
 * the session lines, which are dollars — one unit per document beats two and a
 * conversion at the render site.
 */
export function stringingCharges(jobs: StringingJob[]): StringingCharge[] {
  return jobs
    .filter(isBillable)
    .map((job) => ({
      jobId: job.id,
      jobNo: job.jobNo,
      racketLabel: job.racketLabel,
      amount: Math.round(job.priceCents!) / 100,
      at: job.updatedAt,
    }))
    .sort((a, b) => (a.at < b.at ? 1 : -1));
}

export function stringingTotal(charges: StringingCharge[]): number {
  // Summed in cents and rounded once. Adding dollars as floats accumulates the
  // classic 0.1 + 0.2 drift, and a receipt whose total is a cent off its own
  // lines is the kind of thing people notice and stop trusting.
  const cents = charges.reduce((sum, c) => sum + Math.round(c.amount * 100), 0);
  return cents / 100;
}
