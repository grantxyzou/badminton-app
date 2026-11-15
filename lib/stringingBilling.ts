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
import { isFlagOn } from './flags';

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

/**
 * SENT, OR NEVER WAITING ON A SEND (`docs/plans/stringing-invoice.md`).
 *
 * A job made with `billOn: 'invoice'` owes nothing until its invoice goes out;
 * every other job (all of them before the flag, and every one made while it
 * is off) bills at Ready, as it always did. The ONE reading of that rule:
 * `isBillable` here, the ledger mirror's `billableShaped` and the backfill's
 * `jobEntries` all call it, so the Balance card, the ledger and the reconcile
 * cannot disagree about a job that is finished but not invoiced.
 */
export function invoiceGateOpen(job: { billOn?: string | null; invoice?: { sentAt?: string } | null }): boolean {
  if (job.billOn !== 'invoice') return true;
  return typeof job.invoice?.sentAt === 'string' && job.invoice.sentAt.length > 0;
}

/** Finished and priced and unpaid, whether or not it has been invoiced yet. */
export function isFinishedUnpaid(job: { priceCents: number | null; paidAt: string | null; status: string }): boolean {
  if (typeof job.priceCents !== 'number' || job.priceCents <= 0) return false;
  if (job.paidAt !== null) return false;
  return BILLABLE_STATUSES.has(job.status);
}

export function isBillable(job: {
  priceCents: number | null;
  paidAt: string | null;
  status: string;
  billOn?: string | null;
  invoice?: { sentAt?: string } | null;
}): boolean {
  return isFinishedUnpaid(job) && invoiceGateOpen(job);
}

/** Finished, priced, unpaid and waiting on an invoice the stringer has not sent. */
export function awaitingInvoice(job: {
  priceCents: number | null;
  paidAt: string | null;
  status: string;
  billOn?: string | null;
  invoice?: { sentAt?: string } | null;
  cancelledAt?: string | null;
}): boolean {
  return !job.cancelledAt && isFinishedUnpaid(job) && !invoiceGateOpen(job);
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

/**
 * What a NEW job is stamped with: `{ billOn: 'invoice' }` while
 * `NEXT_PUBLIC_FLAG_STRINGING_INVOICE` is on, nothing otherwise. Read on the
 * server at creation, so the flag decides only for jobs made from then on and
 * turning it off strands no invoice (docs/plans/stringing-invoice.md).
 */
export function newJobBilling(): Pick<StringingJob, 'billOn'> {
  return isFlagOn('NEXT_PUBLIC_FLAG_STRINGING_INVOICE') ? { billOn: 'invoice' } : {};
}
