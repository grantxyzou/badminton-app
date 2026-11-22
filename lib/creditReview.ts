/**
 * UN-TICKING A CREDIT PAYMENT GOES THROUGH A REVIEW (docs/plans/money-audit.md,
 * gap 6; Grant, 2026-11-16: "un-tick should go through a review").
 *
 * A row paid with store credit used to un-tick like any other: the payment
 * was voided, the member owed again — and on their next balance read
 * `refundStaleSpends` saw credit taken for a line with no live payment,
 * took it for a crash half-way through, and marked the row paid again with
 * the same credit. The organiser's decision was undone without anyone seeing,
 * and the ledger could not record the second payment (its id was already
 * used and voided).
 *
 * Now the un-tick is refused, and instead FILES a `review` row in `payments`
 * beside the e-transfers and the card rows: "Lin's $30 was paid with store
 * credit — return the credit?" The row and the ledger do not change until a
 * person decides there:
 *   - RETURN: un-tick the row (void the payment) AND give the credit back
 *     (`refund:<ref>:<n>`, for exactly the net credit still taken for the
 *     line), in one server action. Both steps are idempotent, so a retry
 *     after a half-finished run completes it rather than doubling anything.
 *   - KEEP: dismiss; the row stays paid.
 */
import { groupDocId, type GroupScope } from './groupScope';
import { ensurePayments } from './paymentsInbox';
import { returnRowCredit } from './storeCredit';
import { mirrorUnpaid, mirrorStringingChanged } from './ledgerMirror';
import { resolveIdentity } from './playerIdentity';
import type { EtransferPayment, Player, StringingJob } from './types';

export type CreditReviewRef = { kind: 'session' | 'stringing'; ref: string; pk: string; memberId: string; amountCents: number };

const isConflict = (err: unknown) => (err as { code?: number })?.code === 409;
const ms = (iso: string | undefined | null) => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? String(t) : 'legacy';
};

/** File the review row. Keyed on the line and its `paidAt`, so a second un-tick finds the same row. */
export async function fileCreditReview(scope: GroupScope, input: CreditReviewRef & { paidAt: string | null | undefined; memberName?: string }): Promise<EtransferPayment> {
  await ensurePayments();
  const id = groupDocId(scope.groupId, `credit:${input.ref}:${ms(input.paidAt)}`);
  const existing = await scope.read<EtransferPayment>('payments', id);
  if (existing) return existing;
  const identity = await resolveIdentity({ memberId: input.memberId }, scope.groupId).catch(() => null);
  const name = identity?.member?.name ?? input.memberName ?? null;
  const now = new Date().toISOString();
  const doc: EtransferPayment = {
    id,
    source: 'credit',
    credit: { kind: input.kind, ref: input.ref, pk: input.pk, memberId: input.memberId, amountCents: input.amountCents },
    senderName: name,
    amountCents: input.amountCents,
    memo: null,
    subject: input.kind === 'stringing' ? `Credit payment for stringing ${input.ref}` : `Credit payment for session row ${input.ref}`,
    receivedAt: now,
    authenticated: true,
    status: 'review',
    reason: 'credit_untick',
    memberId: input.memberId,
    ...(name ? { payerName: name } : {}),
    allocations: [],
    createdAt: now,
  };
  try {
    return await scope.create('payments', doc);
  } catch (err) {
    if (!isConflict(err)) throw err;
    return (await scope.read<EtransferPayment>('payments', id)) ?? doc;
  }
}

export class CreditReviewError extends Error {
  constructor(readonly code: 'not_found' | 'already_resolved' | 'not_a_payment' | 'row_changed') {
    super(code);
  }
}

/**
 * The organiser's "Return the credit": un-tick the line and give the credit
 * back. Idempotent in both halves — a line already un-ticked is left alone,
 * and each credit spend the row held goes back under its own pair id
 * (`refund:<ref>:<n>`), so a retry after a half-finished run writes nothing
 * twice.
 */
export async function returnCredit(scope: GroupScope, paymentId: string, adminId: string): Promise<EtransferPayment> {
  await ensurePayments();
  const payment = await scope.read<EtransferPayment>('payments', paymentId);
  if (!payment) throw new CreditReviewError('not_found');
  if (payment.status !== 'review') throw new CreditReviewError('already_resolved');
  if (payment.source !== 'credit' || !payment.credit) throw new CreditReviewError('not_a_payment');
  const c = payment.credit;
  const now = new Date().toISOString();

  // The spends the row had received, read before the un-tick clears them:
  // only those go back (`returnRowCredit`). A line paid in full that keeps no
  // list gives back every spend ('all'); a retry that finds the line already
  // cleared gives back what is not mid-way ('stale').
  let landed: string[] | 'all' | 'stale' = 'stale';

  // 1. Un-tick, if the line is still paid by this credit.
  if (c.kind === 'session') {
    const row = await scope.read<Player & Record<string, unknown>>('players', c.ref, c.pk);
    if (!row) throw new CreditReviewError('row_changed');
    // A row credit paid in full (before part-payments, `paidVia: 'credit'`),
    // or one that lists a credit spend, paid in full or in part
    // (docs/plans/partial-credit.md). Un-ticking clears every payment on the
    // row, as any un-tick does; the credit goes back below.
    const listsCredit = Array.isArray(row.creditSpends) && (row.creditSpends as string[]).length > 0;
    const holdsMoney = row.paid === true || Number(row.paidAmount ?? 0) > 0;
    if (listsCredit) landed = [...(row.creditSpends as string[])];
    else if (holdsMoney) landed = 'all';
    if (holdsMoney) {
      if (!listsCredit && !(row.paid === true && row.paidVia === 'credit')) throw new CreditReviewError('row_changed');
      const written = await scope.replace(
        'players',
        { ...row, paid: false, paidAt: undefined, paidVia: undefined, paymentId: undefined, paidAmount: undefined, creditSpends: undefined },
        c.pk,
      );
      if (!written) throw new CreditReviewError('row_changed');
      await mirrorUnpaid(scope, row as unknown as Player);
    }
  } else {
    const job = await scope.read<StringingJob>('stringingJobs', c.ref, c.pk);
    if (!job) throw new CreditReviewError('row_changed');
    if (job.paidAt) {
      if (job.paidVia !== 'credit') throw new CreditReviewError('row_changed');
      landed = 'all';
      const written = await scope.replace<StringingJob>('stringingJobs', { ...job, paidAt: null, paidVia: undefined, paymentId: undefined, updatedAt: now }, c.pk);
      if (!written) throw new CreditReviewError('row_changed');
      await mirrorStringingChanged(scope, job, written);
    }
  }

  // 2. Give back the credit, each spend under its own pair id, so a retry
  //    after a half-finished run, or a spend refunded before, returns
  //    nothing twice (docs/plans/partial-credit.md).
  await returnRowCredit(scope, c.memberId, { kind: c.kind, ref: c.ref, pk: c.pk }, landed, adminId, 'Payment un-ticked — credit returned');

  // 3. Close the review.
  const next: EtransferPayment = { ...payment, status: 'matched', reason: undefined, matchedBy: adminId, resolvedAt: now };
  return (await scope.replace('payments', next)) ?? next;
}
