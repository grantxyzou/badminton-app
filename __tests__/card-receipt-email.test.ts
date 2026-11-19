import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Stripe from 'stripe';

/**
 * "Payment received" (docs/plans/branded-emails.md): BPM's own receipt for a
 * card payment. Two promises: it names exactly the lines this payment paid,
 * with the total drawn once; and a redelivered Stripe event, which pays
 * nothing new, sends nothing new. Stripe is faked; the signature is real.
 */

const sendMail = vi.fn(async () => ({}));
vi.mock('@/lib/mailTransport', () => ({ gmailTransport: async () => ({ sendMail }) }));

import { POST as checkout } from '@/app/api/payments/card/checkout/route';
import { POST as webhook } from '@/app/api/payments/card/webhook/route';
import { _setStripeForTests, cardPaySettingsId } from '@/lib/cardPay';
import { composeCardReceiptEmail, sessionDay } from '@/lib/cardReceiptEmail';
import {
  resetMockStore,
  seedPointer,
  seedSession,
  seedPlayer,
  seedMember,
  seedDoc,
  makeRequest,
  memberCookieValue,
  setupAdminPin,
  seedTestAdminMember,
} from './helpers';

const BASE = 'http://localhost:3000/api';
const SECRET = 'whsec_test_card_receipt';
const ACCT = 'acct_club_bpm';
const signer = new Stripe('sk_test_signer_only');
const settled = () => ({ at: '2026-10-02T00:00:00Z', costPerPerson: 12, totalCost: 48, courtTotal: 48, birdTotal: 0, playerCount: 4, playerNames: [] });

let lin: { id: string };
let fake: ReturnType<typeof makeFake>;

function makeFake() {
  return {
    checkout: {
      sessions: {
        create: vi.fn(async () => ({ id: 'cs_test_r1', url: 'https://checkout.stripe.com/c/pay/cs_test_r1' })),
        list: vi.fn(async () => ({ data: [] })),
      },
    },
    refunds: { create: vi.fn(async () => ({ id: 're_1' })), list: vi.fn(async () => ({ data: [] })) },
    webhooks: signer.webhooks,
  };
}

const asLin = () => ({ Cookie: `member_session=${memberCookieValue('Lin', lin.id)}` });

async function metadata(): Promise<Record<string, string>> {
  const res = await checkout(makeRequest('POST', `${BASE}/payments/card/checkout`, {}, asLin()));
  expect(res.status).toBe(200);
  const [params] = fake.checkout.sessions.create.mock.calls.at(-1) as unknown as [{ metadata: Record<string, string> }];
  return params.metadata;
}

async function deliver(session: Record<string, unknown>) {
  const payload = JSON.stringify({ id: `evt_${Math.random().toString(36).slice(2)}`, object: 'event', type: 'checkout.session.completed', account: ACCT, data: { object: session } });
  const header = await signer.webhooks.generateTestHeaderStringAsync({ payload, secret: SECRET });
  const req = new Request(`${BASE}/payments/card/webhook`, {
    method: 'POST',
    body: payload,
    headers: { 'stripe-signature': header, 'content-type': 'application/json', 'x-client-ip': `10.8.${Math.floor(Math.random() * 250)}.1` },
  });
  return webhook(req as never);
}

const paid = (md: Record<string, string>, amount = 2700) => ({
  id: 'cs_test_r1',
  object: 'checkout.session',
  payment_status: 'paid',
  amount_total: amount,
  currency: 'cad',
  metadata: md,
  payment_intent: 'pi_test_r1',
  created: 1_793_000_000,
});

beforeEach(async () => {
  resetMockStore();
  setupAdminPin();
  sendMail.mockClear();
  process.env.NEXT_PUBLIC_FLAG_CARD_PAY = 'true';
  process.env.STRIPE_WEBHOOK_SECRET = SECRET;
  process.env.GMAIL_USER = 'club@example.test';
  process.env.GMAIL_APP_PASSWORD = 'app-password';
  fake = makeFake();
  _setStripeForTests(fake as unknown as Stripe);
  await seedTestAdminMember();
  seedPointer('session-2026-10-08');
  seedSession('session-2026-10-08', { datetime: '2026-10-08T19:00:00-04:00' });
  seedSession('session-2026-09-24', { settled: settled(), datetime: '2026-09-24T19:00:00-04:00' });
  seedSession('session-2026-10-01', { settled: settled(), datetime: '2026-10-01T19:00:00-04:00' });
  lin = seedMember('Lin', { email: 'lin@example.test' });
  seedPlayer('session-2026-09-24', 'Lin', { memberId: lin.id, owedAmount: 12, settledAt: '2026-10-02T00:00:00Z' });
  seedPlayer('session-2026-10-01', 'Lin', { memberId: lin.id, owedAmount: 15, settledAt: '2026-10-02T00:00:00Z' });
  seedDoc('clubSettings', {
    id: cardPaySettingsId('bpm'),
    kind: 'cardPay',
    groupId: 'bpm',
    stripeAccountId: ACCT,
    chargesEnabled: true,
    connectedBy: 'x',
    createdAt: '2026-11-01T00:00:00Z',
    updatedAt: '2026-11-01T00:00:00Z',
  });
});

afterEach(() => {
  _setStripeForTests(undefined);
  delete process.env.NEXT_PUBLIC_FLAG_CARD_PAY;
  delete process.env.STRIPE_WEBHOOK_SECRET;
  delete process.env.GMAIL_USER;
  delete process.env.GMAIL_APP_PASSWORD;
});

describe('the receipt a card payment sends', () => {
  it('one paid Checkout: one receipt to the payer, naming each night and the total', async () => {
    const res = await deliver(paid(await metadata()));
    expect(res.status).toBe(200);
    expect(sendMail).toHaveBeenCalledTimes(1);
    const [msg] = sendMail.mock.calls[0] as unknown as [{ to: string; subject: string; text: string; html: string }];
    expect(msg.to).toBe('lin@example.test');
    expect(msg.subject).toMatch(/^Payment received — .+: \$27$/);
    expect(msg.text).toContain('Badminton · Sep 24: $12');
    expect(msg.text).toContain('Badminton · Oct 1: $15');
    expect(msg.text).not.toContain('Card fee');
  });

  it('a redelivered event pays nothing new and sends nothing new', async () => {
    const session = paid(await metadata());
    await deliver(session);
    await deliver(session);
    await deliver(session);
    expect(sendMail).toHaveBeenCalledTimes(1);
  });

  it('a payer with no email address gets none, and the payment still lands', async () => {
    const md = await metadata();
    const store = (await import('./helpers')).getStore();
    const me = (store['members'] as Array<Record<string, unknown>>).find((m) => m.id === lin.id)!;
    delete me.email;
    const res = await deliver(paid(md));
    expect(res.status).toBe(200);
    expect(sendMail).not.toHaveBeenCalled();
    expect((store['players'] as Array<Record<string, unknown>>).filter((p) => p.paid === true)).toHaveLength(2);
  });

  it('a mail server that throws does not fail the webhook (Stripe would only retry it)', async () => {
    sendMail.mockRejectedValueOnce(new Error('smtp down'));
    const res = await deliver(paid(await metadata()));
    expect(res.status).toBe(200);
  });
});

describe('composeCardReceiptEmail', () => {
  const base = { name: 'Lin', club: 'BPM Core', paidAt: '2026-11-18T20:00:00.000Z', appUrl: 'https://bpm.example.test/bpm/?tab=home', refundedCents: 0 };

  it('draws the total once, with the card fee as its own line', () => {
    const { html, subject } = composeCardReceiptEmail({ ...base, lines: [{ label: 'Badminton · Nov 13', amountCents: 1200 }, { label: 'Stringing · J-0042', amountCents: 3000 }], feeCents: 140 });
    expect(subject).toBe('Payment received — BPM Core: $43.40');
    const visible = html.replace(/<div style="display:none[^"]*">[^<]*<\/div>/, '');
    expect(visible.split('$43.40').length - 1).toBe(1);
    expect(html).toContain('Card fee');
    expect(html).toContain('$1.40');
    expect(html).toContain('Card · Nov 18, 2026');
    expect(html).toContain('>Open BPM<');
  });

  it('says what went back to the card', () => {
    const { text } = composeCardReceiptEmail({ ...base, lines: [{ label: 'Badminton · Nov 13', amountCents: 1200 }], feeCents: 0, refundedCents: 1500 });
    expect(text).toContain('$15 went back to your card');
  });

  it('escapes a guest name a member typed', () => {
    const { html } = composeCardReceiptEmail({ ...base, lines: [{ label: 'Badminton · Nov 13 · for <b>Sam</b>', amountCents: 1200 }], feeCents: 0 });
    expect(html).not.toContain('<b>Sam</b>');
    expect(html).toContain('&lt;b&gt;Sam&lt;/b&gt;');
  });

  it('reads the night from either form of session id', () => {
    expect(sessionDay('session-2026-11-13')).toBe('Nov 13');
    expect(sessionDay('six-feathers:session-2026-11-15')).toBe('Nov 15');
    expect(sessionDay('current-session')).toBeNull();
  });
});
