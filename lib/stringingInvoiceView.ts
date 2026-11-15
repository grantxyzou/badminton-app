/**
 * A restring's INVOICE, the pure half (docs/plans/stringing-invoice.md).
 *
 * No server imports: the bench, the stringer's card and the routes all read
 * these, so the button a stringer sees and the refusal the route answers come
 * from the same rule. The sending (push, email) is `lib/stringingInvoice.ts`.
 */
import { invoiceGateOpen, isFinishedUnpaid } from './stringingBilling';
import type { StringingInvoice, StringingJob } from './types';

/** Day-3 push to the player; day-7 push to whoever sent it. */
export const INVOICE_REMIND_PLAYER_DAYS = 3;
export const INVOICE_REMIND_SENDER_DAYS = 7;

/** A second tap inside this window is the same send, not a resend. */
export const INVOICE_RESEND_GUARD_MS = 60 * 1000;

/** `J-0006` → `INV-0006`. One invoice per job, numbered like the job. */
export function invoiceNoOf(jobNo: string): string {
  return /^J-/.test(jobNo) ? `INV-${jobNo.slice(2)}` : `INV-${jobNo}`;
}

export type InvoiceRefusal = 'cancelled' | 'not_finished' | 'not_priced' | 'job_paid';

type JobForInvoice = Pick<StringingJob, 'status' | 'priceCents' | 'paidAt' | 'jobNo'> &
  Partial<Pick<StringingJob, 'cancelledAt' | 'billOn' | 'invoice'>>;

/** Why this job cannot be invoiced now, or null when it can. */
export function invoiceRefusal(job: JobForInvoice): InvoiceRefusal | null {
  if (job.cancelledAt) return 'cancelled';
  if (job.paidAt) return 'job_paid';
  if (typeof job.priceCents !== 'number' || job.priceCents <= 0) return 'not_priced';
  if (!isFinishedUnpaid({ priceCents: job.priceCents, paidAt: job.paidAt ?? null, status: job.status })) return 'not_finished';
  return null;
}

/** The job with its invoice sent (the first time) or sent again. */
export function withInvoiceSent<T extends JobForInvoice>(job: T, now: string, by: string | null): T & { invoice: StringingInvoice } {
  const prev = job.invoice;
  const invoice: StringingInvoice = prev
    ? {
        ...prev,
        // A resend carries today's price: the invoice in their hand is the one
        // just sent. `sentAt` (when billing started) never moves.
        amountCents: job.priceCents as number,
        lastSentAt: now,
        sends: (prev.sends ?? 1) + 1,
        sentBy: by ?? prev.sentBy,
        // A fresh send restarts the reminders: the day-3 and day-7 clocks
        // count from the latest send.
        playerRemindedAt: undefined,
        senderRemindedAt: undefined,
      }
    : {
        no: invoiceNoOf(job.jobNo),
        amountCents: job.priceCents as number,
        sentAt: now,
        lastSentAt: now,
        sentBy: by,
        sends: 1,
      };
  // Cosmos keeps `undefined` keys out of the document; drop them here too so a
  // test's deep-equal reads what the store would.
  if (invoice.playerRemindedAt === undefined) delete invoice.playerRemindedAt;
  if (invoice.senderRemindedAt === undefined) delete invoice.senderRemindedAt;
  return { ...job, invoice };
}

/** Sent within the guard window: a double tap, answered as "already sending". */
export function invoiceJustSent(job: { invoice?: StringingInvoice | null }, nowMs = Date.now()): boolean {
  const at = Date.parse(job.invoice?.lastSentAt ?? '');
  return Number.isFinite(at) && nowMs - at < INVOICE_RESEND_GUARD_MS;
}

/** What the bench and the stringer's card show about a job's invoice. */
export interface InvoiceView {
  no: string;
  /** Today's price, dollars. */
  amount: number | null;
  /** First send (billing starts here for an invoice-billed job). */
  sentAt: string | null;
  lastSentAt: string | null;
  sends: number;
  /** What the last invoice said, dollars. */
  sentAmount: number | null;
  /** The price moved after the invoice went: offer a resend. */
  priceChanged: boolean;
  /** Finished, priced, unpaid, not withdrawn. */
  canSend: boolean;
  paid: boolean;
  /** `'invoice'`: owed only once sent. `'ready'`: owed since Ready (older jobs). */
  billOn: 'invoice' | 'ready';
  /** Owed now: what the player's Balance shows. */
  owed: boolean;
}

export function invoiceView(job: JobForInvoice): InvoiceView {
  const inv = job.invoice ?? null;
  const amount = typeof job.priceCents === 'number' ? job.priceCents / 100 : null;
  const sentAmount = inv ? inv.amountCents / 100 : null;
  return {
    no: inv?.no ?? invoiceNoOf(job.jobNo),
    amount,
    sentAt: inv?.sentAt ?? null,
    lastSentAt: inv?.lastSentAt ?? null,
    sends: inv?.sends ?? 0,
    sentAmount,
    priceChanged: !!inv && !job.paidAt && typeof job.priceCents === 'number' && job.priceCents !== inv.amountCents,
    canSend: invoiceRefusal(job) === null,
    paid: !!job.paidAt,
    billOn: job.billOn === 'invoice' ? 'invoice' : 'ready',
    owed:
      invoiceRefusal(job) === null &&
      invoiceGateOpen({ billOn: job.billOn, invoice: inv }),
  };
}
