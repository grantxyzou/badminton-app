import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Stripe from 'stripe';
import { PATCH as patchJob } from '@/app/api/stringing/jobs/[id]/route';
import { applyAllocations } from '@/lib/paymentsInbox';
import { applyPaidCheckout, applyRefund, cardPaySettingsId, _setStripeForTests } from '@/lib/cardPay';
import { payWithCredit, refundStaleSpends } from '@/lib/storeCredit';
import { jobEntries } from '@/lib/ledgerBackfill';
import { groupScope } from '@/lib/groupScope';
import { describeMismatch } from '@/lib/ledgerReconcileDetail';
import type { LedgerEntry, StringingJob } from '@/lib/types';
import { resetMockStore, getStore, seedPointer, seedSession, seedMember, seedDoc, makeAdminRequest, setupAdminPin, seedTestAdminMember } from './helpers';

/**
 * A STRINGING JOB REMEMBERS HOW IT WAS PAID (docs/plans/money-audit.md,
 * transparency item 1, 2026-11-16; Grant: "add paidVia to stringing jobs").
 *
 * `StringingJob.paidVia` / `paymentId` are stamped by every path that marks a
 * job paid — the inbox, the card webhook, store credit, the bench — cleared by
 * every un-pay, and read by the mirror, the backfill and the Ledger check's
 * description. The ledger id stays keyed on `paidAt`, so nothing already
 * written moves.
 */

const BASE = 'http://localhost:3000/api';
const ACCT = 'acct_club_bpm';
const SID = 'session-2026-10-08';
let lin: { id: string };
const job = () => (getStore()['stringingJobs'] as StringingJob[]).find((j) => j.id === 'job-1')!;
const ledger = () => (getStore()['ledger'] ?? []) as LedgerEntry[];
const payments = () => ledger().filter((e) => e.kind === 'payment' && e.ref?.id === 'job-1');
const scope = () => groupScope('bpm');
const bench = (body: Record<string, unknown>) =>
  patchJob(makeAdminRequest('PATCH', `${BASE}/stringing/jobs/job-1`, { memberId: lin.id, ...body }), { params: Promise.resolve({ id: 'job-1' }) } as never);

beforeEach(async () => {
  resetMockStore();
  setupAdminPin();
  process.env.NEXT_PUBLIC_FLAG_STRINGING = 'true';
  process.env.NEXT_PUBLIC_FLAG_LEDGER_MIRROR = 'true';
  process.env.NEXT_PUBLIC_FLAG_CARD_PAY = 'true';
  await seedTestAdminMember();
  seedPointer(SID);
  seedSession(SID, { datetime: '2026-10-08T19:00:00-04:00' });
  lin = seedMember('Lin');
  seedDoc('stringingJobs', {
    id: 'job-1', groupId: 'bpm', memberId: lin.id, memberName: 'Lin', jobNo: 'J-0001', racketLabel: 'Astrox', stringLabel: 'BG65',
    status: 'ready', priceCents: 3000, paidAt: null, tensionMains: 24, tensionCrosses: 26, createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z',
    stringerId: null, stringerName: null, archivedAt: null, pendingEdit: null, acceptedAt: null, sessionId: null, history: [],
  });
  seedDoc('clubSettings', {
    id: cardPaySettingsId('bpm'), kind: 'cardPay', groupId: 'bpm', stripeAccountId: ACCT, chargesEnabled: true,
    connectedBy: 'x', createdAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-01T00:00:00Z',
  });
});

afterEach(() => {
  _setStripeForTests(undefined);
  for (const k of ['NEXT_PUBLIC_FLAG_STRINGING', 'NEXT_PUBLIC_FLAG_LEDGER_MIRROR', 'NEXT_PUBLIC_FLAG_CARD_PAY']) delete process.env[k];
});

describe('each way a job is paid stamps how', () => {
  it('the inbox: etransfer, with the payment doc id, and the mirror says so', async () => {
    const landed = await applyAllocations(scope(), [{ kind: 'stringing', ref: 'job-1', pk: lin.id, amountCents: 3000 }], 'etx:1');
    expect(landed).toHaveLength(1);
    expect(job()).toMatchObject({ paidVia: 'etransfer', paymentId: 'etx:1' });
    expect(payments().map((p) => [p.meta?.via, p.meta?.paymentId])).toEqual([['etransfer', 'etx:1']]);
  });

  it('the card webhook: card, with the Checkout id', async () => {
    const r = await applyPaidCheckout(
      {
        id: 'cs_1', payment_status: 'paid', amount_total: 3000, currency: 'cad', created: 1_793_000_000, payment_intent: 'pi_1',
        metadata: { bpm_group: 'bpm', bpm_member: lin.id, bpm_line_0: `stringing:job-1:${lin.id}:3000` },
      } as unknown as Stripe.Checkout.Session,
      ACCT,
    );
    expect(r).toMatchObject({ applied: 1 });
    expect(job()).toMatchObject({ paidVia: 'card', paymentId: 'cs_1', cardPaymentId: 'cs_1' });
    expect(payments().map((p) => p.meta?.via)).toEqual(['card']);
  });

  it('store credit: credit — and a later balance read knows the job is credit’s by the stamp, not only by the clock', async () => {
    seedDoc('ledger', { id: 'grant:t', groupId: 'bpm', memberId: lin.id, account: 'member_credit', kind: 'credit_grant', amountCents: 5000, note: '', createdAt: '2026-10-01T00:00:00Z', createdBy: 'x' });
    expect((await payWithCredit('bpm', lin.id)).paid).toBe(1);
    expect(job()).toMatchObject({ paidVia: 'credit' });
    expect(payments().map((p) => p.meta?.via)).toEqual(['credit']);
    const r = await refundStaleSpends(scope(), lin.id);
    expect([r.finished, r.refunded]).toEqual([0, 0]);
  });

  it('the bench: manual; an un-tick forgets the method and the link', async () => {
    expect((await bench({ paid: true })).status).toBe(200);
    expect(job()).toMatchObject({ paidVia: 'manual' });
    expect(payments().map((p) => p.meta?.via)).toEqual(['manual']);
    expect((await bench({ paid: false })).status).toBe(200);
    const j = job();
    expect(j.paidAt).toBeNull();
    expect(j.paidVia).toBeUndefined();
    expect(j.paymentId).toBeUndefined();
  });

  it('a bench tick on a job the inbox already paid keeps the inbox’s stamp', async () => {
    await applyAllocations(scope(), [{ kind: 'stringing', ref: 'job-1', pk: lin.id, amountCents: 3000 }], 'etx:9');
    expect((await bench({ paid: true })).status).toBe(200);
    expect(job()).toMatchObject({ paidVia: 'etransfer', paymentId: 'etx:9' });
  });

  it('a Dashboard refund clears the stamp with the payment', async () => {
    await applyPaidCheckout(
      {
        id: 'cs_2', payment_status: 'paid', amount_total: 3000, currency: 'cad', created: 1_793_000_000, payment_intent: 'pi_2',
        metadata: { bpm_group: 'bpm', bpm_member: lin.id, bpm_line_0: `stringing:job-1:${lin.id}:3000` },
      } as unknown as Stripe.Checkout.Session,
      ACCT,
    );
    _setStripeForTests({
      checkout: { sessions: { list: async () => ({ data: [{ id: 'cs_2', metadata: { bpm_group: 'bpm', bpm_member: lin.id, bpm_line_0: `stringing:job-1:${lin.id}:3000` } }] }) } },
      refunds: { list: async () => ({ data: [{ amount: 3000, status: 'succeeded', metadata: {} }] }) },
    } as unknown as Stripe);
    const r = await applyRefund({ id: 'ch_2', payment_intent: 'pi_2' } as unknown as Stripe.Charge, ACCT);
    expect(r).toMatchObject({ unpaid: 1 });
    const j = job();
    expect(j.paidAt).toBeNull();
    expect(j.paidVia).toBeUndefined();
    expect(j.paymentId).toBeUndefined();
  });
});

describe('what reads the stamp', () => {
  it('the backfill writes the job’s own method, and `manual` for a job from before the stamp', async () => {
    const paid = { ...job(), paidAt: '2026-10-02T00:00:00Z', paidVia: 'etransfer' as const, paymentId: 'etx:5' };
    expect(jobEntries(paid).filter((e) => e.kind === 'payment').map((e) => [e.meta?.via, e.meta?.paymentId])).toEqual([['etransfer', 'etx:5']]);
    const older = { ...job(), paidAt: '2026-10-02T00:00:00Z' };
    expect(jobEntries(older).filter((e) => e.kind === 'payment').map((e) => e.meta?.via)).toEqual(['manual']);
    // The id is unchanged by the stamp: nothing already written moves.
    expect(jobEntries(paid).find((e) => e.kind === 'payment')!.id).toBe(jobEntries(older).find((e) => e.kind === 'payment')!.id);
  });

  it('the Ledger check’s description carries it', async () => {
    await applyAllocations(scope(), [{ kind: 'stringing', ref: 'job-1', pk: lin.id, amountCents: 3000 }], 'etx:7');
    const d = await describeMismatch(scope(), { memberId: lin.id, ref: { kind: 'stringing', id: 'job-1', pk: lin.id }, code: 'missing_payment', ledgerCents: 3000, liveCents: 0 });
    expect(d.subject).toMatchObject({ kind: 'stringing', paidVia: 'etransfer' });
  });
});
