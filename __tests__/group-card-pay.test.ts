import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Stripe from 'stripe';
import { GET as status, POST as connect } from '@/app/api/admin/card-pay/route';
import { POST as checkout } from '@/app/api/payments/card/checkout/route';
import { POST as webhook } from '@/app/api/payments/card/webhook/route';
import { GET as unpaid } from '@/app/api/players/unpaid/route';
import { _setStripeForTests, cardPaySettingsId, linesFromMetadata } from '@/lib/cardPay';
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
 * CARD PAYMENTS — the sandbox prototype (docs/plans/card-pay-prototype.md).
 *
 * What matters: a club's card money is applied only when Stripe's SIGNED
 * envelope says it came from THAT club's own account; only settled lines at
 * the exact amount charged are marked paid; a redelivered event changes
 * nothing; and a line that cannot be applied any more is refunded to the card,
 * never guessed at. Stripe itself is faked here — the signature is real.
 */

const BASE = 'http://localhost:3000/api';
const SECRET = 'whsec_test_card_pay';
const ACCT = 'acct_club_bpm';
const settled = () => ({ at: '2026-10-02T00:00:00Z', costPerPerson: 12, totalCost: 48, courtTotal: 48, birdTotal: 0, playerCount: 4, playerNames: [] });
const signer = new Stripe('sk_test_signer_only');

let lin: { id: string };
let row1: { id: string };
let row2: { id: string };
let fake: ReturnType<typeof makeFake>;
/** What the fake answers for "the Checkout Session behind this payment" and "this charge's refunds". */
let listedSession: Record<string, unknown> | null = null;
let refundList: Array<{ amount: number; status: string; metadata: Record<string, string> }> = [];

function makeFake() {
  return {
    v2: {
      core: {
        accounts: {
          create: vi.fn(async () => ({ id: ACCT })),
          retrieve: vi.fn(async () => ({ id: ACCT, configuration: { merchant: { capabilities: { card_payments: { status: 'active' } } } } })),
        },
        accountLinks: { create: vi.fn(async () => ({ url: 'https://connect.stripe.com/setup/test' })) },
      },
    },
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
}

const asLin = () => ({ Cookie: `member_session=${memberCookieValue('Lin', lin.id)}` });
const row = (id: string) => (getStore()['players'] as Array<Record<string, unknown>>).find((p) => p.id === id)!;
const ledger = () => (getStore()['ledger'] ?? []) as Array<{ id: string; kind: string }>;
const connectClubAccount = (chargesEnabled = true) =>
  seedDoc('clubSettings', {
    id: cardPaySettingsId('bpm'),
    kind: 'cardPay',
    groupId: 'bpm',
    stripeAccountId: ACCT,
    chargesEnabled,
    connectedBy: 'x',
    createdAt: '2026-11-01T00:00:00Z',
    updatedAt: '2026-11-01T00:00:00Z',
  });

/** The metadata the real checkout route put on the session it created. */
async function checkoutMetadata(): Promise<Record<string, string>> {
  const res = await checkout(makeRequest('POST', `${BASE}/payments/card/checkout`, {}, asLin()));
  expect(res.status).toBe(200);
  const [params] = fake.checkout.sessions.create.mock.calls.at(-1) as unknown as [{ metadata: Record<string, string> }];
  return params.metadata;
}

async function deliver(
  session: Record<string, unknown>,
  account: string | undefined = ACCT,
  secret = SECRET,
  type = 'checkout.session.completed',
) {
  const payload = JSON.stringify({
    id: `evt_${Math.random().toString(36).slice(2)}`,
    object: 'event',
    type,
    account,
    data: { object: session },
  });
  const header = await signer.webhooks.generateTestHeaderStringAsync({ payload, secret });
  const req = new Request(`${BASE}/payments/card/webhook`, {
    method: 'POST',
    body: payload,
    headers: { 'stripe-signature': header, 'content-type': 'application/json', 'x-client-ip': `10.9.${Math.floor(Math.random() * 250)}.1` },
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

beforeEach(async () => {
  resetMockStore();
  setupAdminPin();
  process.env.NEXT_PUBLIC_FLAG_CARD_PAY = 'true';
  process.env.NEXT_PUBLIC_FLAG_LEDGER_MIRROR = 'true';
  process.env.STRIPE_WEBHOOK_SECRET = SECRET;
  fake = makeFake();
  listedSession = null;
  refundList = [];
  _setStripeForTests(fake as unknown as Stripe);
  await seedTestAdminMember();
  seedPointer('session-2026-10-08');
  seedSession('session-2026-10-08', { datetime: '2026-10-08T19:00:00-04:00' });
  seedSession('session-2026-09-24', { settled: settled(), datetime: '2026-09-24T19:00:00-04:00' });
  seedSession('session-2026-10-01', { settled: settled(), datetime: '2026-10-01T19:00:00-04:00' });
  lin = seedMember('Lin');
  row1 = seedPlayer('session-2026-09-24', 'Lin', { memberId: lin.id, owedAmount: 12, settledAt: '2026-10-02T00:00:00Z' });
  row2 = seedPlayer('session-2026-10-01', 'Lin', { memberId: lin.id, owedAmount: 15, settledAt: '2026-10-02T00:00:00Z' });
});

afterEach(() => {
  _setStripeForTests(undefined);
  delete process.env.NEXT_PUBLIC_FLAG_CARD_PAY;
  delete process.env.NEXT_PUBLIC_FLAG_LEDGER_MIRROR;
  delete process.env.STRIPE_WEBHOOK_SECRET;
});

describe('gates', () => {
  it('every card route 404s with the flag off, and with no Stripe key', async () => {
    for (const setup of [() => (process.env.NEXT_PUBLIC_FLAG_CARD_PAY = 'false'), () => _setStripeForTests(null)]) {
      setup();
      expect((await status(makeAdminRequest('GET', `${BASE}/admin/card-pay`))).status).toBe(404);
      expect((await connect(makeAdminRequest('POST', `${BASE}/admin/card-pay`))).status).toBe(404);
      expect((await checkout(makeRequest('POST', `${BASE}/payments/card/checkout`, {}, asLin()))).status).toBe(404);
      expect((await deliver(paidSession({})))).toHaveProperty('status', 404);
      process.env.NEXT_PUBLIC_FLAG_CARD_PAY = 'true';
      _setStripeForTests(fake as unknown as Stripe);
    }
  });

  it('connecting is an organiser\'s; paying needs a signed-in member', async () => {
    expect((await connect(makeRequest('POST', `${BASE}/admin/card-pay`, {}, asLin()))).status).toBe(401);
    expect((await checkout(makeRequest('POST', `${BASE}/payments/card/checkout`, {}))).status).toBe(401);
  });
});

describe('the club connects its own Stripe account', () => {
  it('creates ONE account (full dashboard, Stripe owns fees and losses) and hands back an onboarding link', async () => {
    const res = await connect(makeAdminRequest('POST', `${BASE}/admin/card-pay`));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ url: 'https://connect.stripe.com/setup/test' });
    const [params, opts] = fake.v2.core.accounts.create.mock.calls[0] as unknown as [Record<string, unknown>, Record<string, unknown>];
    expect(params).toMatchObject({
      dashboard: 'full',
      defaults: { currency: 'cad', responsibilities: { fees_collector: 'stripe', losses_collector: 'stripe' } },
      configuration: { merchant: { capabilities: { card_payments: { requested: true } } } },
    });
    expect(opts).toEqual({ idempotencyKey: 'bpm-connect:bpm' });

    // A second tap continues onboarding on the same account.
    await connect(makeAdminRequest('POST', `${BASE}/admin/card-pay`));
    expect(fake.v2.core.accounts.create).toHaveBeenCalledTimes(1);
    expect(fake.v2.core.accountLinks.create).toHaveBeenCalledTimes(2);
  });

  it('reads whether it can take cards from Stripe, and Home offers the button only then', async () => {
    connectClubAccount(false);
    const unpaidNow = async () => (await (await unpaid(makeRequest('GET', `${BASE}/players/unpaid?name=Lin`, undefined, asLin()))).json()).cardPay;
    expect(await unpaidNow()).toBe(false);
    expect(await (await status(makeAdminRequest('GET', `${BASE}/admin/card-pay`))).json()).toEqual({ connected: true, chargesEnabled: true, stripeAccountId: ACCT });
    expect(await unpaidNow()).toBe(true);
  });
});

describe('a member pays by card', () => {
  it('is refused until the club can take cards', async () => {
    const res = await checkout(makeRequest('POST', `${BASE}/payments/card/checkout`, {}, asLin()));
    expect(await res.json()).toEqual({ error: 'club_not_connected' });
    connectClubAccount(false);
    expect(await (await checkout(makeRequest('POST', `${BASE}/payments/card/checkout`, {}, asLin()))).json()).toEqual({ error: 'club_not_ready' });
  });

  it('charges the SETTLED lines, in CAD, directly on the club\'s account — never an unsettled estimate', async () => {
    connectClubAccount();
    // An unsettled past session with a live share: Home shows it, cards do not pay it.
    seedSession('session-2026-10-05', { datetime: '2026-10-05T19:00:00-04:00', costPerCourt: 20, courts: 1 });
    seedPlayer('session-2026-10-05', 'Lin', { memberId: lin.id });

    const res = await checkout(makeRequest('POST', `${BASE}/payments/card/checkout`, {}, asLin()));
    expect(await res.json()).toEqual({ url: 'https://checkout.stripe.com/c/pay/cs_test_1' });
    const [params, opts] = fake.checkout.sessions.create.mock.calls[0] as unknown as [
      { line_items: Array<{ price_data: { currency: string; unit_amount: number } }>; metadata: Record<string, string>; mode: string },
      { stripeAccount: string; idempotencyKey: string },
    ];
    expect(params.mode).toBe('payment');
    expect(params.line_items.map((l) => [l.price_data.currency, l.price_data.unit_amount])).toEqual([['cad', 1200], ['cad', 1500]]);
    expect(linesFromMetadata(params.metadata).map((l) => l.ref)).toEqual([row1.id, row2.id]);
    expect(opts.stripeAccount).toBe(ACCT);
    expect(opts.idempotencyKey).toMatch(/^bpm-checkout:/);
    // Nothing is paid until Stripe says so.
    expect(row(row1.id).paid).not.toBe(true);
  });
});

describe('the webhook', () => {
  beforeEach(() => connectClubAccount());

  it('refuses an unsigned or wrongly signed event and changes nothing', async () => {
    const metadata = await checkoutMetadata();
    expect((await deliver(paidSession(metadata), ACCT, 'whsec_someone_else'))).toHaveProperty('status', 400);
    expect(row(row1.id).paid).not.toBe(true);
  });

  it('marks each line paid by card, mirrors it, and a redelivery changes nothing', async () => {
    const metadata = await checkoutMetadata();
    const res = await deliver(paidSession(metadata));
    expect(res.status).toBe(200);
    expect((await res.json()).result).toEqual({ applied: 2, alreadyOurs: 0, refundedCents: 0 });
    for (const r of [row1, row2]) {
      expect(row(r.id)).toMatchObject({ paid: true, paidVia: 'card', paymentId: 'cs_test_1' });
      expect(ledger().some((e) => e.id === `payment:${r.id}:cs_test_1`)).toBe(true);
    }
    const entries = ledger().length;

    const again = await deliver(paidSession(metadata));
    expect((await again.json()).result).toEqual({ applied: 0, alreadyOurs: 2, refundedCents: 0 });
    expect(ledger()).toHaveLength(entries);
    expect(fake.refunds.create).not.toHaveBeenCalled();
  });

  it('refunds a line paid another way meanwhile, keyed so a redelivery cannot refund twice', async () => {
    const metadata = await checkoutMetadata();
    Object.assign(row(row2.id), { paid: true, paidVia: 'etransfer', paymentId: 'pay_1' });

    const res = await deliver(paidSession(metadata));
    expect((await res.json()).result).toEqual({ applied: 1, alreadyOurs: 0, refundedCents: 1500 });
    expect(row(row2.id)).toMatchObject({ paidVia: 'etransfer', paymentId: 'pay_1' });
    const [params, opts] = fake.refunds.create.mock.calls[0] as unknown as [Record<string, unknown>, Record<string, unknown>];
    expect(params).toMatchObject({ payment_intent: 'pi_test_1', amount: 1500 });
    expect(opts).toEqual({ stripeAccount: ACCT, idempotencyKey: 'bpm-unapplied:cs_test_1' });
  });

  it('ignores money from an account that is not the club\'s own', async () => {
    const metadata = await checkoutMetadata();
    const res = await deliver(paidSession(metadata), 'acct_somebody_else');
    expect((await res.json()).result).toEqual({ ignored: 'account_mismatch' });
    expect(row(row1.id).paid).not.toBe(true);
    expect(fake.refunds.create).not.toHaveBeenCalled();
  });

  it('ignores a session whose charge does not match the lines it carries', async () => {
    const metadata = await checkoutMetadata();
    const res = await deliver(paidSession(metadata, 100));
    expect((await res.json()).result).toEqual({ ignored: 'amount_mismatch' });
    expect(row(row1.id).paid).not.toBe(true);
  });

  it('a line re-priced since checkout is refunded, not paid at the old amount', async () => {
    const metadata = await checkoutMetadata();
    row(row1.id).owedAmount = 14;
    const res = await deliver(paidSession(metadata));
    expect((await res.json()).result).toEqual({ applied: 1, alreadyOurs: 0, refundedCents: 1200 });
    expect(row(row1.id).paid).not.toBe(true);
  });
});

describe('stringing jobs are paid by card in the same Checkout', () => {
  const JOB = 'job-1';
  const job = () => (getStore()['stringingJobs'] as Array<Record<string, unknown>>).find((j) => j.id === JOB)!;
  beforeEach(() => {
    process.env.NEXT_PUBLIC_FLAG_STRINGING = 'true';
    connectClubAccount();
    seedDoc('stringingJobs', {
      id: JOB, groupId: 'bpm', memberId: lin.id, memberName: 'Lin', jobNo: 'J-0001', racketLabel: 'Test racket',
      status: 'ready', priceCents: 3000, paidAt: null, createdAt: '2026-10-20T00:00:00Z', updatedAt: '2026-10-25T00:00:00Z', history: [],
    });
  });
  afterEach(() => {
    delete process.env.NEXT_PUBLIC_FLAG_STRINGING;
  });

  it('adds a finished, priced job as its own line, after the older session shares', async () => {
    await checkoutMetadata();
    const [params] = fake.checkout.sessions.create.mock.calls.at(-1) as unknown as [
      { line_items: Array<{ price_data: { unit_amount: number; product_data: { name: string } } }>; metadata: Record<string, string> },
    ];
    expect(params.line_items.map((l) => [l.price_data.product_data.name, l.price_data.unit_amount])).toEqual([
      ['Badminton · 2026-09-24', 1200],
      ['Badminton · 2026-10-01', 1500],
      ['Stringing · 2026-10-25', 3000],
    ]);
    expect(linesFromMetadata(params.metadata).at(-1)).toEqual({ kind: 'stringing', ref: JOB, pk: lin.id, amountCents: 3000 });
  });

  it('the webhook marks the job paid by this Checkout, mirrors it, and a redelivery changes nothing', async () => {
    const metadata = await checkoutMetadata();
    expect((await (await deliver(paidSession(metadata, 5700))).json()).result).toEqual({ applied: 3, alreadyOurs: 0, refundedCents: 0 });
    expect(job()).toMatchObject({ cardPaymentId: 'cs_test_1' });
    expect(typeof job().paidAt).toBe('string');
    expect(ledger().some((e) => e.id.startsWith(`payment:${JOB}:`))).toBe(true);
    expect((await (await deliver(paidSession(metadata, 5700))).json()).result).toEqual({ applied: 0, alreadyOurs: 3, refundedCents: 0 });
  });

  it('a refund of exactly the job’s price in Stripe puts the job back to owed and leaves the sessions paid', async () => {
    const metadata = await checkoutMetadata();
    listedSession = paidSession(metadata, 5700);
    await deliver(paidSession(metadata, 5700));
    refundList = [{ amount: 3000, status: 'succeeded', metadata: {} }];
    const res = await deliver({ id: 'ch_1', object: 'charge', payment_intent: 'pi_test_1' }, ACCT, SECRET, 'charge.refunded');
    expect((await res.json()).result).toEqual({ unpaid: 1, already: false });
    expect(job()).toMatchObject({ paidAt: null, refundedPaymentId: 'cs_test_1' });
    expect(job().cardPaymentId).toBeUndefined();
    expect(row(row1.id).paid).toBe(true);
  });
});

describe('a refund made in the Stripe Dashboard', () => {
  const charge = { id: 'ch_1', object: 'charge', payment_intent: 'pi_test_1' };
  const refundEvent = (account = ACCT) => deliver(charge, account, SECRET, 'charge.refunded');
  const byPerson = (amount: number) => ({ amount, status: 'succeeded', metadata: {} });
  const result = async (res: Response) => (await res.json()).result;

  beforeEach(async () => {
    connectClubAccount();
    const metadata = await checkoutMetadata();
    listedSession = paidSession(metadata);
    await deliver(paidSession(metadata)); // both rows paid by card, $12 and $15
  });

  it('a full refund puts every row it paid back to unpaid, voids the ledger payments, and a redelivery changes nothing', async () => {
    refundList = [byPerson(2700)];
    expect(await result(await refundEvent())).toEqual({ unpaid: 2, already: false });
    for (const r of [row1, row2]) {
      expect(row(r.id)).toMatchObject({ paid: false, refundedPaymentId: 'cs_test_1' });
      expect(row(r.id).paidVia).toBeUndefined();
      expect(ledger().some((e) => e.id === `void:payment:${r.id}:cs_test_1`)).toBe(true);
    }
    const entries = ledger().length;
    expect(await result(await refundEvent())).toEqual({ unpaid: 0, already: true });
    expect(ledger()).toHaveLength(entries);
  });

  it('a refund of exactly one session’s amount un-pays that session only, and a later refund of the other un-pays it', async () => {
    refundList = [byPerson(1500)];
    expect(await result(await refundEvent())).toEqual({ unpaid: 1, already: false });
    expect(row(row2.id).paid).toBe(false);
    expect(row(row1.id).paid).toBe(true);
    refundList = [byPerson(1500), byPerson(1200)];
    expect(await result(await refundEvent())).toEqual({ unpaid: 1, already: false });
    expect(row(row1.id).paid).toBe(false);
  });

  it('an amount that matches no paid session changes nothing and is left for a person', async () => {
    refundList = [byPerson(700)];
    expect(await result(await refundEvent())).toEqual({ review: 'amount_matches_no_line' });
    expect(row(row1.id).paid).toBe(true);
    expect(row(row2.id).paid).toBe(true);
  });

  it('ignores the app’s own refunds of unapplied lines, and refunds from an account that is not the club’s', async () => {
    refundList = [{ amount: 2700, status: 'succeeded', metadata: { bpm_reason: 'line_no_longer_owed' } }];
    expect(await result(await refundEvent())).toEqual({ ignored: 'app_refund' });
    refundList = [byPerson(2700)];
    expect(await result(await refundEvent('acct_somebody_else'))).toEqual({ ignored: 'account_mismatch' });
    expect(row(row1.id).paid).toBe(true);
  });
});

describe('two clubs', () => {
  it("one club's account cannot pay another club's lines, whatever the metadata says", async () => {
    connectClubAccount();
    seedDoc('clubSettings', {
      id: cardPaySettingsId('other'),
      kind: 'cardPay',
      groupId: 'other',
      stripeAccountId: 'acct_club_other',
      chargesEnabled: true,
      connectedBy: 'y',
      createdAt: '2026-11-01T00:00:00Z',
      updatedAt: '2026-11-01T00:00:00Z',
    });
    const metadata = { ...(await checkoutMetadata()), bpm_group: 'other' };
    // Signed by Stripe, from BPM's account, claiming to be the other club's.
    const res = await deliver(paidSession(metadata), ACCT);
    expect((await res.json()).result).toEqual({ ignored: 'account_mismatch' });
    expect(row(row1.id).paid).not.toBe(true);
  });
});
