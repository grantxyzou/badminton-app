import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Stripe from 'stripe';
import { GET as status, PATCH as setFee } from '@/app/api/admin/card-pay/route';
import { POST as form } from '@/app/api/payments/card/form/route';
import { POST as webhook } from '@/app/api/payments/card/webhook/route';
import { GET as unpaid } from '@/app/api/players/unpaid/route';
import { _setStripeForTests, cardPaySettingsId } from '@/lib/cardPay';
import { SURCHARGE_API_VERSION } from '@/lib/cardSurcharge';
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
 * The card fee on credit cards (docs/plans/card-surcharge.md). Grant,
 * 2026-11-17: "give me the ability to charge the stripe fee on per
 * transaction … a toggle I turn on off", then "Rule-following 2.4%".
 *
 * What matters: the fee is never above 2.4% (or Stripe's ceiling for the
 * card), never on debit, worked out on the SERVER and shown before the
 * charge; the money lands on exactly the lines, the fee never in the ledger;
 * a refund carries its share of the fee; one club or member can never act on
 * another's payment. Stripe is faked; the webhook signature is real.
 */
const BASE = 'http://localhost:3000/api';
const SECRET = 'whsec_test_surcharge';
const ACCT = 'acct_club_bpm';
const settled = () => ({ at: '2026-10-02T00:00:00Z', costPerPerson: 12, totalCost: 48, courtTotal: 48, birdTotal: 0, playerCount: 4, playerNames: [] });
const signer = new Stripe('sk_test_signer_only');

let lin: { id: string };
let viktor: { id: string };
let row1: { id: string };
let row2: { id: string };
let fake: ReturnType<typeof makeFake>;
/** The card the fake says the member entered. */
let card: { funding: string; brand: string; last4: string };
/** What Stripe says about surcharging this card. */
let surchargeDetail: { status: string; maximum_amount?: number };
/** The intents the fake holds, by id. */
let intents: Record<string, Record<string, unknown>>;
let refundList: Array<{ amount: number; status: string; metadata: Record<string, string> }>;

function makeFake() {
  return {
    v2: { core: { accounts: { retrieve: vi.fn(async () => ({ id: ACCT, configuration: { merchant: { capabilities: { card_payments: { status: 'active' } } } } })) } } },
    paymentMethods: {
      retrieve: vi.fn(async (id: string) => ({ id, type: 'card', card }))
    },
    paymentIntents: {
      create: vi.fn(async (params: Record<string, unknown>) => {
        const id = 'pi_surcharge_1';
        intents[id] = { id, status: 'requires_confirmation', client_secret: `${id}_secret`, ...params, amount_details: { surcharge: { enforce_validation: 'enabled', ...surchargeDetail } } };
        return intents[id];
      }),
      update: vi.fn(async (id: string, params: Record<string, unknown>) => {
        const cur = intents[id];
        intents[id] = { ...cur, ...params, metadata: { ...(cur.metadata as object), ...((params.metadata as object) ?? {}) } };
        return intents[id];
      }),
      retrieve: vi.fn(async (id: string) => intents[id]),
      confirm: vi.fn(async (id: string) => {
        intents[id] = { ...intents[id], status: 'succeeded' };
        return intents[id];
      }),
    },
    checkout: { sessions: { list: vi.fn(async () => ({ data: [] })) } },
    refunds: {
      create: vi.fn(async () => ({ id: 're_1' })),
      list: vi.fn(async () => ({ data: refundList })),
    },
    webhooks: signer.webhooks,
  };
}

const asLin = () => ({ Cookie: `member_session=${memberCookieValue('Lin', lin.id)}` });
const asViktor = () => ({ Cookie: `member_session=${memberCookieValue('Viktor', viktor.id)}` });
const row = (id: string) => (getStore()['players'] as Array<Record<string, unknown>>).find((p) => p.id === id)!;
const ledger = () => (getStore()['ledger'] ?? []) as Array<{ id: string; kind: string; amountCents: number; ref?: { id: string } }>;
const settingsDoc = () => (getStore()['clubSettings'] as Array<Record<string, unknown>>).find((d) => d.id === cardPaySettingsId('bpm'))!;

function connectClub(surcharge?: Record<string, unknown>) {
  seedDoc('clubSettings', {
    id: cardPaySettingsId('bpm'),
    kind: 'cardPay',
    groupId: 'bpm',
    stripeAccountId: ACCT,
    chargesEnabled: true,
    connectedBy: 'x',
    createdAt: '2026-11-01T00:00:00Z',
    updatedAt: '2026-11-01T00:00:00Z',
    ...(surcharge ? { surcharge } : {}),
  });
}
function feeOn(bps = 240) {
  const surcharge = { on: true, bps, acknowledgedAt: '2026-11-17T00:00:00Z', acknowledgedBy: 'x', updatedAt: '2026-11-17T00:00:00Z' };
  const existing = (getStore()['clubSettings'] as Array<Record<string, unknown>> | undefined)?.find((d) => d.id === cardPaySettingsId('bpm'));
  if (existing) existing.surcharge = surcharge;
  else connectClub(surcharge);
}

const step = (body: Record<string, unknown>, who = asLin()) => form(makeRequest('POST', `${BASE}/payments/card/form`, body, who));

async function deliver(object: Record<string, unknown>, type: string, account: string | undefined = ACCT) {
  const payload = JSON.stringify({ id: `evt_${Math.random().toString(36).slice(2)}`, object: 'event', type, account, data: { object } });
  const header = await signer.webhooks.generateTestHeaderStringAsync({ payload, secret: SECRET });
  const req = new Request(`${BASE}/payments/card/webhook`, {
    method: 'POST',
    body: payload,
    headers: { 'stripe-signature': header, 'content-type': 'application/json', 'x-client-ip': `10.8.${Math.floor(Math.random() * 250)}.1` },
  });
  return webhook(req as never);
}

/** Quote with the current card, then return the intent as Stripe would report it paid. */
async function quotedAndPaid(): Promise<Record<string, unknown>> {
  const res = await step({ step: 'quote', paymentMethodId: 'pm_card_visa_1' });
  expect(res.status).toBe(200);
  const { intentId } = await res.json();
  const pi = intents[intentId];
  return { ...pi, object: 'payment_intent', status: 'succeeded', amount_received: pi.amount, created: 1_793_000_000 };
}

beforeEach(async () => {
  resetMockStore();
  setupAdminPin();
  process.env.NEXT_PUBLIC_FLAG_CARD_PAY = 'true';
  process.env.NEXT_PUBLIC_FLAG_LEDGER_MIRROR = 'true';
  process.env.STRIPE_WEBHOOK_SECRET = SECRET;
  process.env.STRIPE_PUBLISHABLE_KEY = 'pk_test_platform';
  card = { funding: 'credit', brand: 'visa', last4: '4242' };
  surchargeDetail = { status: 'available', maximum_amount: 64 };
  intents = {};
  refundList = [];
  fake = makeFake();
  _setStripeForTests(fake as unknown as Stripe);
  await seedTestAdminMember();
  seedPointer('session-2026-10-08');
  seedSession('session-2026-10-08', { datetime: '2026-10-08T19:00:00-04:00' });
  seedSession('session-2026-09-24', { settled: settled(), datetime: '2026-09-24T19:00:00-04:00' });
  seedSession('session-2026-10-01', { settled: settled(), datetime: '2026-10-01T19:00:00-04:00' });
  lin = seedMember('Lin');
  viktor = seedMember('Viktor');
  row1 = seedPlayer('session-2026-09-24', 'Lin', { memberId: lin.id, owedAmount: 12, settledAt: '2026-10-02T00:00:00Z' });
  row2 = seedPlayer('session-2026-10-01', 'Lin', { memberId: lin.id, owedAmount: 15, settledAt: '2026-10-02T00:00:00Z' });
  seedPlayer('session-2026-10-01', 'Viktor', { memberId: viktor.id, owedAmount: 15, settledAt: '2026-10-02T00:00:00Z' });
});

afterEach(() => {
  _setStripeForTests(undefined);
  delete process.env.NEXT_PUBLIC_FLAG_CARD_PAY;
  delete process.env.NEXT_PUBLIC_FLAG_LEDGER_MIRROR;
  delete process.env.STRIPE_WEBHOOK_SECRET;
  delete process.env.STRIPE_PUBLISHABLE_KEY;
});

describe('the organiser’s toggle', () => {
  const patch = (surcharge: Record<string, unknown>) => setFee(makeAdminRequest('PATCH', `${BASE}/admin/card-pay`, { surcharge }));

  it('on needs the organiser to confirm they told Mastercard and Stripe; then it is stored', async () => {
    connectClub();
    const refused = await patch({ on: true });
    expect(refused.status).toBe(409);
    expect(await refused.json()).toEqual({ error: 'not_acknowledged' });

    const res = await patch({ on: true, acknowledged: true });
    expect(res.status).toBe(200);
    expect((await res.json()).surcharge).toEqual(expect.objectContaining({ on: true, bps: 240 }));
    expect(settingsDoc().surcharge).toEqual(expect.objectContaining({ on: true, bps: 240, acknowledgedAt: expect.any(String) }));
    const read = await (await status(makeAdminRequest('GET', `${BASE}/admin/card-pay`))).json();
    expect(read).toEqual(expect.objectContaining({ surcharge: expect.objectContaining({ on: true }), cardFormReady: true }));

    // Changing the rate later needs no second confirmation; off keeps the rate.
    expect((await patch({ on: true, bps: 200 })).status).toBe(200);
    expect(((await (await patch({ on: false })).json()).surcharge)).toEqual(expect.objectContaining({ on: false, bps: 200 }));
  });

  it('never above 2.4%, never on without the key the card form needs, organisers only', async () => {
    connectClub();
    expect(await (await patch({ on: true, bps: 290, acknowledged: true })).json()).toEqual({ error: 'bad_rate' });
    delete process.env.STRIPE_PUBLISHABLE_KEY;
    expect(await (await patch({ on: true, acknowledged: true })).json()).toEqual({ error: 'no_publishable_key' });
    expect((await setFee(makeRequest('PATCH', `${BASE}/admin/card-pay`, { surcharge: { on: true, acknowledged: true } }, asLin()))).status).toBe(401);
  });
});

describe('what a member sees before paying', () => {
  it('Home is told the fee only while it is on', async () => {
    connectClub();
    const read = async () => (await (await unpaid(makeRequest('GET', `${BASE}/players/unpaid?name=Lin`, undefined, asLin()))).json()).cardFee;
    expect(await read()).toBeNull();
    feeOn();
    expect(await read()).toEqual({ bps: 240 });
  });

  it('the form starts only with the fee on, with the amount owed and the club’s account', async () => {
    connectClub();
    expect(await (await step({ step: 'start' })).json()).toEqual({ error: 'surcharge_off' });
    feeOn();
    expect(await (await step({ step: 'start' })).json()).toEqual({
      publishableKey: 'pk_test_platform', stripeAccount: ACCT, amountCents: 2700, currency: 'cad', lines: 2, bps: 240,
    });
  });

  it('a CREDIT card: 2.4% of the lines, rounded down, written on the intent on the preview API', async () => {
    feeOn();
    const res = await step({ step: 'quote', paymentMethodId: 'pm_card_visa_1' });
    expect(await res.json()).toEqual({ intentId: 'pi_surcharge_1', baseCents: 2700, feeCents: 64, totalCents: 2764, bps: 240, funding: 'credit', brand: 'visa', last4: '4242' });
    const [created, createOpts] = fake.paymentIntents.create.mock.calls[0] as unknown as [Record<string, unknown>, Record<string, unknown>];
    expect(created).toEqual(expect.objectContaining({ amount: 2700, currency: 'cad', payment_method: 'pm_card_visa_1', payment_method_types: ['card'] }));
    expect(createOpts).toEqual(expect.objectContaining({ stripeAccount: ACCT, apiVersion: SURCHARGE_API_VERSION }));
    expect(intents.pi_surcharge_1).toEqual(expect.objectContaining({ amount: 2764, amount_details: { surcharge: { amount: 64 } } }));
    expect((intents.pi_surcharge_1.metadata as Record<string, string>).bpm_surcharge).toBe('64');
  });

  it('never above Stripe’s ceiling for the card', async () => {
    feeOn();
    surchargeDetail = { status: 'available', maximum_amount: 50 };
    expect((await (await step({ step: 'quote', paymentMethodId: 'pm_card_visa_1' })).json()).feeCents).toBe(50);
  });

  it('DEBIT, prepaid, or a card Stripe says cannot be surcharged: no fee at all', async () => {
    feeOn();
    for (const [funding, st] of [['debit', 'available'], ['prepaid', 'available'], ['credit', 'unavailable']] as const) {
      resetIntents();
      card = { funding, brand: 'visa', last4: '0005' };
      surchargeDetail = { status: st, maximum_amount: 64 };
      const quote = await (await step({ step: 'quote', paymentMethodId: 'pm_card_visa_1' })).json();
      expect([funding, st, quote.feeCents, quote.totalCents]).toEqual([funding, st, 0, 2700]);
    }
  });
});

function resetIntents() {
  intents = {};
}

describe('paying', () => {
  it('confirms the quoted intent, never one that is not the member’s', async () => {
    feeOn();
    await step({ step: 'quote', paymentMethodId: 'pm_card_visa_1' });
    expect(await (await step({ step: 'confirm', intentId: 'pi_surcharge_1' }, asViktor())).json()).toEqual({ error: 'not_yours' });
    const res = await step({ step: 'confirm', intentId: 'pi_surcharge_1' });
    expect(await res.json()).toEqual({ status: 'succeeded', clientSecret: 'pi_surcharge_1_secret' });
    const [, params] = fake.paymentIntents.confirm.mock.calls[0] as unknown as [string, { return_url: string }];
    expect(params.return_url).toMatch(/\/bpm\/\?tab=home&card=paid$/);
    // Twice is refused, not charged twice.
    expect(await (await step({ step: 'confirm', intentId: 'pi_surcharge_1' })).json()).toEqual({ error: 'already_done' });
  });

  it('the money lands on exactly the lines; the fee is never in the ledger; a redelivery changes nothing', async () => {
    feeOn();
    const pi = await quotedAndPaid();
    const res = await deliver(pi, 'payment_intent.succeeded');
    expect((await res.json()).result).toEqual({ applied: 2, alreadyOurs: 0, refundedCents: 0 });
    expect(row(row1.id)).toEqual(expect.objectContaining({ paid: true, paidVia: 'card', paymentId: 'pi_surcharge_1' }));
    const payments = ledger().filter((e) => e.kind === 'payment').map((e) => e.amountCents).sort((a, b) => a - b);
    expect(payments).toEqual([-1500, -1200]);
    expect((await (await deliver(pi, 'payment_intent.succeeded')).json()).result).toEqual({ applied: 0, alreadyOurs: 2, refundedCents: 0 });
  });

  it('a fee above 2.4% of the lines is not applied: it goes to Needs a look', async () => {
    feeOn();
    const pi = await quotedAndPaid();
    const res = await deliver({ ...pi, amount: 2800, amount_received: 2800, metadata: { ...(pi.metadata as object), bpm_surcharge: '100' } }, 'payment_intent.succeeded');
    expect((await res.json()).result).toEqual({ ignored: 'amount_mismatch' });
    expect(row(row1.id).paid).not.toBe(true);
    expect((getStore()['payments'] as Array<{ reason: string }>).map((p) => p.reason)).toContain('card_amount_mismatch');
  });

  it('a Checkout’s own PaymentIntent is left to the Checkout events', async () => {
    feeOn();
    const pi = await quotedAndPaid();
    const { bpm_flow: _f, ...plain } = pi.metadata as Record<string, string>;
    expect((await (await deliver({ ...pi, metadata: plain }, 'payment_intent.succeeded')).json()).result).toEqual({ ignored: 'not_ours' });
  });

  it('a line paid another way meanwhile goes back to the card WITH its share of the fee', async () => {
    feeOn();
    const pi = await quotedAndPaid();
    Object.assign(row(row2.id), { paid: true, paidVia: 'manual', paidAt: '2026-10-03T00:00:00Z' });
    const res = await deliver(pi, 'payment_intent.succeeded');
    // $15 line + floor(1500 × 64 / 2700) = 35¢ of the fee.
    expect((await res.json()).result).toEqual({ applied: 1, alreadyOurs: 0, refundedCents: 1535 });
    expect((fake.refunds.create.mock.calls as unknown as Array<[Record<string, unknown>]>)[0][0]).toEqual(expect.objectContaining({ payment_intent: 'pi_surcharge_1', amount: 1535 }));
  });
});

describe('refunds made in Stripe', () => {
  const charge = { id: 'ch_1', object: 'charge', payment_intent: 'pi_surcharge_1', created: 1_793_000_100 };

  it('a full refund (fee included) un-pays every line', async () => {
    feeOn();
    await deliver(await quotedAndPaid(), 'payment_intent.succeeded');
    refundList = [{ amount: 2764, status: 'succeeded', metadata: {} }];
    expect((await (await deliver(charge, 'charge.refunded')).json()).result).toEqual({ unpaid: 2, already: false });
    expect(row(row1.id).paid).toBe(false);
  });

  it('one line plus its prorated fee un-pays that line only', async () => {
    feeOn();
    await deliver(await quotedAndPaid(), 'payment_intent.succeeded');
    // $12 + 28¢ (1200 × 64 / 2700 = 28.4).
    refundList = [{ amount: 1228, status: 'succeeded', metadata: {} }];
    expect((await (await deliver(charge, 'charge.refunded')).json()).result).toEqual({ unpaid: 1, already: false });
    expect(row(row1.id).paid).toBe(false);
    expect(row(row2.id).paid).toBe(true);
  });
});

describe('a dispute (chargeback) on a payment that carried the fee', () => {
  const dispute = (amount: number, status = 'needs_response') => ({ id: 'dp_1', object: 'dispute', charge: 'ch_1', payment_intent: 'pi_surcharge_1', amount, status, reason: 'fraudulent', created: 1_793_200_000 });
  const result = async (res: Response) => (await res.json()).result;

  it('the whole charge (fee included) makes every line owed again; won pays them by card again', async () => {
    feeOn();
    await deliver(await quotedAndPaid(), 'payment_intent.succeeded');
    expect(await result(await deliver(dispute(2764), 'charge.dispute.created'))).toEqual({ unpaid: 2, already: false, review: 'card_dispute' });
    expect(row(row1.id)).toMatchObject({ paid: false, disputedPaymentId: 'pi_surcharge_1' });
    expect(row(row2.id)).toMatchObject({ paid: false, disputedPaymentId: 'pi_surcharge_1' });
    expect(await result(await deliver(dispute(2764, 'won'), 'charge.dispute.closed'))).toEqual({ repaid: 2, already: false });
    expect(row(row1.id)).toMatchObject({ paid: true, paidVia: 'card', paymentId: 'pi_surcharge_1' });
  });

  it('one line plus its share of the fee makes that line alone owed again', async () => {
    feeOn();
    await deliver(await quotedAndPaid(), 'payment_intent.succeeded');
    // $15 + 35¢ (1500 × 64 / 2700 = 35.5).
    expect(await result(await deliver(dispute(1535), 'charge.dispute.created'))).toEqual({ unpaid: 1, already: false, review: 'card_dispute' });
    expect(row(row1.id).paid).toBe(true);
    expect(row(row2.id).paid).toBe(false);
  });
});

describe('two clubs', () => {
  it('a payment from another club’s account never marks this club’s rows', async () => {
    feeOn();
    const pi = await quotedAndPaid();
    expect((await (await deliver(pi, 'payment_intent.succeeded', 'acct_someone_else')).json()).result).toEqual({ ignored: 'account_mismatch' });
    expect(row(row1.id).paid).not.toBe(true);
  });

  it('an intent made for another club cannot be confirmed from this one', async () => {
    feeOn();
    await step({ step: 'quote', paymentMethodId: 'pm_card_visa_1' });
    intents.pi_surcharge_1.metadata = { ...(intents.pi_surcharge_1.metadata as object), bpm_group: 'other' };
    expect(await (await step({ step: 'confirm', intentId: 'pi_surcharge_1' })).json()).toEqual({ error: 'not_yours' });
  });
});
