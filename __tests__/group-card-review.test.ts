import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Stripe from 'stripe';
import { POST as checkout } from '@/app/api/payments/card/checkout/route';
import { POST as webhook } from '@/app/api/payments/card/webhook/route';
import { GET as inbox } from '@/app/api/admin/payments/route';
import { POST as assign } from '@/app/api/admin/payments/assign/route';
import { _setStripeForTests, cardPaySettingsId } from '@/lib/cardPay';
import type { EtransferPayment, LedgerEntry } from '@/lib/types';
import {
  resetMockStore,
  getStore,
  seedPointer,
  seedSession,
  seedPlayer,
  seedMember,
  seedDoc,
  makeRequest,
  makeAdminRequest,
  memberCookieValue,
  setupAdminPin,
  seedTestAdminMember,
} from './helpers';

/**
 * A STRIPE OUTCOME THE WEBHOOK CANNOT ACT ON IS FILED FOR A PERSON
 * (docs/plans/money-audit.md, "How BPM stays true with Stripe", 2026-11-16).
 *
 * Until then a Checkout whose amount did not match, one from another club's
 * account, or a Dashboard refund that named no single line was a
 * `console.error` and nothing else. Now each is a `review` row in `payments`
 * beside the e-transfers — `source: 'card'`, keyed on the Checkout Session so
 * a redelivery files nothing twice — and the organiser resolves it in "Needs
 * a look": a card row assigned to lines pays them BY CARD under the Checkout
 * id (the id the webhook would have used), never writes a bank-name alias,
 * and a refund row (money out) can only be dismissed.
 */

const BASE = 'http://localhost:3000/api';
const SECRET = 'whsec_test_card_review';
const ACCT = 'acct_club_bpm';
const settled = () => ({ at: '2026-10-02T00:00:00Z', costPerPerson: 12, totalCost: 48, courtTotal: 48, birdTotal: 0, playerCount: 4, playerNames: [] });
const signer = new Stripe('sk_test_signer_only');

let lin: { id: string };
let row1: { id: string };
let row2: { id: string };
let listedSession: Record<string, unknown> | null = null;
let refundList: Array<{ amount: number; status: string; metadata: Record<string, string> }> = [];
const fake = {
  checkout: {
    sessions: {
      create: vi.fn(async () => ({ id: 'cs_test_1', url: 'https://checkout.stripe.com/c/pay/cs_test_1' })),
      list: vi.fn(async () => ({ data: listedSession ? [listedSession] : [] })),
    },
  },
  refunds: {
    create: vi.fn(async () => ({ id: 're_1' })),
    list: vi.fn(async () => ({ data: refundList })),
  },
  webhooks: signer.webhooks,
};

const asLin = () => ({ Cookie: `member_session=${memberCookieValue('Lin', lin.id)}` });
const row = (id: string) => (getStore()['players'] as Array<Record<string, unknown>>).find((p) => p.id === id)!;
const payments = () => (getStore()['payments'] ?? []) as EtransferPayment[];
const cardRows = () => payments().filter((p) => p.source === 'card');
const ledger = () => (getStore()['ledger'] ?? []) as LedgerEntry[];
const aliases = () => ((getStore()['clubSettings'] ?? []) as Array<{ kind?: string }>).filter((d) => d.kind === 'alias');

async function checkoutMetadata(): Promise<Record<string, string>> {
  const res = await checkout(makeRequest('POST', `${BASE}/payments/card/checkout`, {}, asLin()));
  expect(res.status).toBe(200);
  const [params] = fake.checkout.sessions.create.mock.calls.at(-1) as unknown as [{ metadata: Record<string, string> }];
  return params.metadata;
}

async function deliver(object: Record<string, unknown>, account: string | undefined = ACCT, type = 'checkout.session.completed') {
  const payload = JSON.stringify({ id: `evt_${Math.random().toString(36).slice(2)}`, object: 'event', type, account, data: { object } });
  const header = await signer.webhooks.generateTestHeaderStringAsync({ payload, secret: SECRET });
  const req = new Request(`${BASE}/payments/card/webhook`, {
    method: 'POST',
    body: payload,
    headers: { 'stripe-signature': header, 'content-type': 'application/json', 'x-client-ip': `10.8.${Math.floor(Math.random() * 250)}.1` },
  });
  return webhook(req as never);
}

const paidSession = (metadata: Record<string, string>, amount = 2700) => ({
  id: 'cs_test_1',
  object: 'checkout.session',
  payment_status: 'paid',
  amount_total: amount,
  currency: 'cad',
  metadata,
  payment_intent: 'pi_test_1',
  created: 1_793_000_000,
});

const review = async () => ((await (await inbox(makeAdminRequest('GET', `${BASE}/admin/payments`))).json()) as { review: EtransferPayment[] }).review;
const resolve = (body: Record<string, unknown>) => assign(makeAdminRequest('POST', `${BASE}/admin/payments/assign`, body));

beforeEach(async () => {
  resetMockStore();
  setupAdminPin();
  process.env.NEXT_PUBLIC_FLAG_CARD_PAY = 'true';
  process.env.NEXT_PUBLIC_FLAG_LEDGER_MIRROR = 'true';
  process.env.STRIPE_WEBHOOK_SECRET = SECRET;
  listedSession = null;
  refundList = [];
  fake.checkout.sessions.create.mockClear();
  fake.refunds.create.mockClear();
  _setStripeForTests(fake as unknown as Stripe);
  await seedTestAdminMember();
  seedPointer('session-2026-10-08');
  seedSession('session-2026-10-08', { datetime: '2026-10-08T19:00:00-04:00' });
  seedSession('session-2026-09-24', { settled: settled(), datetime: '2026-09-24T19:00:00-04:00' });
  seedSession('session-2026-10-01', { settled: settled(), datetime: '2026-10-01T19:00:00-04:00' });
  lin = seedMember('Lin');
  row1 = seedPlayer('session-2026-09-24', 'Lin', { memberId: lin.id, owedAmount: 12, settledAt: '2026-10-02T00:00:00Z' });
  row2 = seedPlayer('session-2026-10-01', 'Lin', { memberId: lin.id, owedAmount: 15, settledAt: '2026-10-02T00:00:00Z' });
  seedDoc('clubSettings', {
    id: cardPaySettingsId('bpm'), kind: 'cardPay', groupId: 'bpm', stripeAccountId: ACCT, chargesEnabled: true,
    connectedBy: 'x', createdAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-01T00:00:00Z',
  });
});

afterEach(() => {
  _setStripeForTests(undefined);
  for (const k of ['NEXT_PUBLIC_FLAG_CARD_PAY', 'NEXT_PUBLIC_FLAG_LEDGER_MIRROR', 'STRIPE_WEBHOOK_SECRET']) delete process.env[k];
});

describe('a Checkout the webhook could not apply is filed under Needs a look', () => {
  it('amount mismatch: one card row naming the payer, the Checkout and the charge; a redelivery files nothing twice', async () => {
    const metadata = await checkoutMetadata();
    expect((await deliver(paidSession(metadata, 9900))).status).toBe(200);
    expect(row(row1.id).paid).not.toBe(true);

    const [r, ...rest] = cardRows();
    expect(rest).toEqual([]);
    expect(r).toMatchObject({
      id: 'card:cs_test_1',
      source: 'card',
      card: { checkoutId: 'cs_test_1', kind: 'payment' },
      status: 'review',
      reason: 'card_amount_mismatch',
      amountCents: 9900,
      memberId: lin.id,
      senderName: 'Lin',
      authenticated: true,
      allocations: [],
    });
    expect(r.suggestions?.map((s) => s.name)).toEqual(['Lin']);

    // Stripe sends it again: the same id, nothing new.
    expect((await deliver(paidSession(metadata, 9900))).status).toBe(200);
    expect(cardRows()).toHaveLength(1);

    // The organiser sees it where the e-transfers are.
    expect((await review()).map((p) => [p.id, p.reason])).toEqual([['card:cs_test_1', 'card_amount_mismatch']]);
  });

  it('account mismatch: money claiming this club from an account that is not the club’s is filed, and nothing is paid', async () => {
    const metadata = await checkoutMetadata();
    expect((await deliver(paidSession(metadata), 'acct_somebody_else')).status).toBe(200);
    expect(row(row1.id).paid).not.toBe(true);
    expect(cardRows().map((p) => [p.id, p.reason, p.amountCents])).toEqual([['card:cs_test_1', 'card_account_mismatch', 2700]]);
  });

  it('a clean payment files nothing', async () => {
    const metadata = await checkoutMetadata();
    expect((await deliver(paidSession(metadata))).status).toBe(200);
    expect(row(row1.id).paid).toBe(true);
    expect(cardRows()).toEqual([]);
  });
});

describe('a Dashboard refund that names no single line', () => {
  it('is filed as a refund row keyed on the charge, and a redelivery files nothing twice', async () => {
    const metadata = await checkoutMetadata();
    await deliver(paidSession(metadata));
    expect([row(row1.id).paid, row(row2.id).paid]).toEqual([true, true]);

    listedSession = { id: 'cs_test_1', metadata };
    refundList = [{ amount: 1000, status: 'succeeded', metadata: {} }]; // neither $12, $15 nor $27
    const charge = { id: 'ch_test_1', object: 'charge', payment_intent: 'pi_test_1', created: 1_793_100_000 };
    expect((await deliver(charge, ACCT, 'charge.refunded')).status).toBe(200);
    expect([row(row1.id).paid, row(row2.id).paid]).toEqual([true, true]); // never guessed
    expect(cardRows().map((p) => [p.id, p.reason, p.amountCents, p.card])).toEqual([
      ['card:cs_test_1:refund:ch_test_1', 'card_refund_no_line', 1000, { checkoutId: 'cs_test_1', chargeId: 'ch_test_1', kind: 'refund' }],
    ]);

    await deliver(charge, ACCT, 'charge.refunded');
    expect(cardRows()).toHaveLength(1);
  });

  it('cannot be assigned (money went OUT); it can be dismissed', async () => {
    const metadata = await checkoutMetadata();
    await deliver(paidSession(metadata));
    listedSession = { id: 'cs_test_1', metadata };
    refundList = [{ amount: 1000, status: 'succeeded', metadata: {} }];
    await deliver({ id: 'ch_test_1', object: 'charge', payment_intent: 'pi_test_1' }, ACCT, 'charge.refunded');
    const id = cardRows()[0].id;

    const refused = await resolve({ paymentId: id, action: 'assign', name: 'Lin', refs: [row1.id] });
    expect(refused.status).toBe(409);
    expect(await refused.json()).toEqual({ error: 'not_a_payment' });

    const ok = await resolve({ paymentId: id, action: 'ignore' });
    expect(ok.status).toBe(200);
    expect(cardRows()[0].status).toBe('ignored');
    expect(await review()).toEqual([]);
  });
});

describe('the organiser resolves a card row', () => {
  it('assigning it pays the lines BY CARD under the Checkout id, mirrors them so, and remembers no alias', async () => {
    const metadata = await checkoutMetadata();
    await deliver(paidSession(metadata, 9900));
    const id = cardRows()[0].id;

    // Having checked Stripe, the organiser applies the money to both lines.
    const res = await resolve({ paymentId: id, action: 'assign', name: 'Lin', refs: [row1.id, row2.id], remember: true });
    expect(res.status).toBe(200);
    expect(row(row1.id)).toMatchObject({ paid: true, paidVia: 'card', paymentId: 'cs_test_1' });
    expect(row(row2.id)).toMatchObject({ paid: true, paidVia: 'card', paymentId: 'cs_test_1' });
    // The ledger id is the one the webhook itself would have written.
    expect(ledger().filter((e) => e.kind === 'payment').map((e) => `${e.id} ${e.meta?.via}`).sort()).toEqual(
      [`payment:${row1.id}:cs_test_1 card`, `payment:${row2.id}:cs_test_1 card`].sort(),
    );
    expect(aliases()).toEqual([]); // "remember" means nothing for card money
    const done = cardRows()[0];
    expect(done).toMatchObject({ status: 'matched', memberId: lin.id, payerName: 'Lin' });
    expect(done.allocations.map((a) => a.ref).sort()).toEqual([row1.id, row2.id].sort());

    // Stripe redelivers the mismatched event afterwards: the rows are already
    // ours under this Checkout, so nothing moves and nothing is refunded.
    await deliver(paidSession(metadata, 9900));
    expect(fake.refunds.create).not.toHaveBeenCalled();
    expect(cardRows()).toHaveLength(1);
  });

  it('dismissing a card row never writes an alias even when asked to remember', async () => {
    const metadata = await checkoutMetadata();
    await deliver(paidSession(metadata, 9900));
    const res = await resolve({ paymentId: cardRows()[0].id, action: 'ignore', name: 'Lin', remember: true });
    expect(res.status).toBe(200);
    expect(aliases()).toEqual([]);
    expect(cardRows()[0].status).toBe('ignored');
  });
});
