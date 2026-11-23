/**
 * THE CARD FEE (docs/plans/card-surcharge.md): an organiser's switch that
 * passes part of Stripe's cost on to members who pay by CREDIT card, within
 * Canada's rules — at most 2.4%, never on debit or prepaid, shown before the
 * member pays, returned (prorated) with any refund.
 *
 * Stripe's hosted Checkout cannot tell credit from debit before the charge,
 * so with the fee on, members pay through the in-app card form instead:
 *
 *   1. `startCardForm` — what the form needs: the amount, the club's account
 *      and the platform's publishable key (an App Setting, never built in).
 *   2. The browser turns the card into a PaymentMethod ON the club's account.
 *   3. `quoteCardPayment` — the server creates the PaymentIntent with that
 *      card (API `2026-03-25.preview`, where Stripe reports whether a
 *      surcharge is allowed for it and its ceiling), works out the fee, and
 *      writes it onto the intent. The browser shows it; nothing is charged.
 *   4. `confirmCardPayment` — the member taps Pay; the server confirms the
 *      SAME intent (amount and fee as quoted, never from the browser).
 *   5. The webhook (`payment_intent.succeeded`, lib/cardPay.ts
 *      `applyPaidIntent`) marks the lines paid, exactly as for Checkout.
 *
 * The fee is never in the ledger: it offsets Stripe's fee, which the ledger
 * does not record either. It lives on the PaymentIntent (`bpm_surcharge`).
 */
import type Stripe from 'stripe';
import { createHash } from 'crypto';
import { groupScope } from './groupScope';
import { CardPayError, CURRENCY, cardBrandRefused, must, payableLines, readCardPay, type CardPaySettingsDoc, type CardSurchargeSetting } from './cardPay';
import { SURCHARGE_DEFAULT_BPS, surchargeableCard, surchargeCents, validSurchargeBps } from './surchargeMath';

/** Stripe's surcharge fields exist only on this API version (public preview). */
export const SURCHARGE_API_VERSION = '2026-03-25.preview';

export class SurchargeError extends Error {
  constructor(
    public code:
      | 'surcharge_off'
      | 'no_publishable_key'
      | 'not_acknowledged'
      | 'bad_rate'
      | 'changed_elsewhere'
      | 'not_yours'
      | 'already_done'
      | 'not_ready'
      | 'brand_not_accepted',
  ) {
    super(code);
  }
}

/** The publishable key the card form loads Stripe with: the platform's own, from App Settings. */
export function publishableKey(): string | null {
  return process.env.STRIPE_PUBLISHABLE_KEY?.trim() || null;
}

/** The club's fee as members see it, or null when it is off. */
export async function memberCardFee(groupId: string): Promise<{ bps: number } | null> {
  const s = (await readCardPay(groupId))?.surcharge;
  return s?.on && validSurchargeBps(s.bps) ? { bps: s.bps } : null;
}

/**
 * Turn the fee on or off, or change its rate. ON needs the organiser to say
 * they told Mastercard and Stripe (`acknowledged`), a rate of 1–240 basis
 * points, and the publishable key the card form needs. Written under the
 * settings doc's etag; a save that lost a race answers `changed_elsewhere`.
 */
export async function setCardSurcharge(
  groupId: string,
  organiserMemberId: string,
  input: { on: boolean; bps?: number; acknowledged?: boolean },
): Promise<CardSurchargeSetting> {
  const doc = await readCardPay(groupId);
  if (!doc) throw new CardPayError('club_not_connected');
  const now = new Date().toISOString();
  const bps = input.bps ?? doc.surcharge?.bps ?? SURCHARGE_DEFAULT_BPS;
  if (!validSurchargeBps(bps)) throw new SurchargeError('bad_rate');
  let next: CardSurchargeSetting;
  if (input.on) {
    if (!publishableKey()) throw new SurchargeError('no_publishable_key');
    const already = doc.surcharge?.on === true && !!doc.surcharge.acknowledgedAt;
    if (!already && input.acknowledged !== true) throw new SurchargeError('not_acknowledged');
    next = {
      on: true,
      bps,
      acknowledgedAt: already ? doc.surcharge!.acknowledgedAt : now,
      acknowledgedBy: already ? doc.surcharge!.acknowledgedBy : organiserMemberId,
      updatedAt: now,
    };
  } else {
    next = { ...(doc.surcharge ?? { bps }), on: false, bps, updatedAt: now };
  }
  const written = await groupScope(groupId).replace<CardPaySettingsDoc>('clubSettings', { ...doc, surcharge: next, updatedAt: now });
  if (!written) throw new SurchargeError('changed_elsewhere');
  return next;
}

async function readyClub(groupId: string): Promise<CardPaySettingsDoc & { surcharge: CardSurchargeSetting }> {
  const settings = await readCardPay(groupId);
  if (!settings) throw new CardPayError('club_not_connected');
  if (!settings.chargesEnabled) throw new CardPayError('club_not_ready');
  if (!settings.surcharge?.on || !validSurchargeBps(settings.surcharge.bps)) throw new SurchargeError('surcharge_off');
  return settings as CardPaySettingsDoc & { surcharge: CardSurchargeSetting };
}

/** Step 1: what the in-app card form needs to draw itself. */
export async function startCardForm(groupId: string, memberId: string) {
  const settings = await readyClub(groupId);
  const key = publishableKey();
  if (!key) throw new SurchargeError('no_publishable_key');
  const { lines, amountCents } = await payableLines(groupId, memberId);
  return {
    publishableKey: key,
    stripeAccount: settings.stripeAccountId,
    amountCents,
    currency: CURRENCY,
    lines: lines.length,
    bps: settings.surcharge.bps,
  };
}

export interface CardQuote {
  intentId: string;
  baseCents: number;
  feeCents: number;
  totalCents: number;
  bps: number;
  /** `credit`, `debit`, `prepaid` or `unknown`: only credit carries a fee. */
  funding: string;
  brand: string | null;
  last4: string | null;
}

type SurchargeDetails = { surcharge?: { status?: string; maximum_amount?: number } };

/**
 * Step 3: the fee for THIS card, written onto a PaymentIntent. Debit,
 * prepaid, unknown, a brand other than Visa or Mastercard, or a card Stripe
 * says cannot be surcharged: no fee.
 */
export async function quoteCardPayment(groupId: string, memberId: string, paymentMethodId: string, now = Date.now()): Promise<CardQuote> {
  const settings = await readyClub(groupId);
  const stripe = must();
  const account = { stripeAccount: settings.stripeAccountId };
  const { lines, metadata, amountCents } = await payableLines(groupId, memberId);

  const pm = await stripe.paymentMethods.retrieve(paymentMethodId, {}, account);
  if (pm.type !== 'card' || !pm.card) throw new SurchargeError('not_ready');
  // The club does not take Amex (`cardBrandRefused`): refused before any
  // intent exists, so nothing is charged or held.
  if (cardBrandRefused(pm.card.brand)) throw new SurchargeError('brand_not_accepted');

  // One intent per (member, lines, card) per ten minutes: a second tap on
  // "Continue" quotes the same intent instead of starting another.
  const key = createHash('sha256')
    .update([groupId, memberId, paymentMethodId, ...lines.map((l) => `${l.kind}:${l.ref}:${l.amountCents}`), String(Math.floor(now / 600_000))].join('|'))
    .digest('hex')
    .slice(0, 40);
  const intent = (await stripe.paymentIntents.create(
    {
      amount: amountCents,
      currency: CURRENCY,
      payment_method: paymentMethodId,
      payment_method_types: ['card'],
      metadata: { ...metadata, bpm_flow: 'surcharge', bpm_surcharge: '0' },
      // Asks Stripe whether this card can be surcharged, and its ceiling.
      amount_details: { surcharge: { enforce_validation: 'enabled' } },
    } as unknown as Stripe.PaymentIntentCreateParams,
    { ...account, apiVersion: SURCHARGE_API_VERSION, idempotencyKey: `bpm-intent:${key}` },
  )) as Stripe.PaymentIntent & { amount_details?: SurchargeDetails };

  const detail = intent.amount_details?.surcharge;
  const funding = pm.card.funding ?? 'unknown';
  // Visa or Mastercard credit only (SURCHARGE_BRANDS), and only when Stripe says this card can carry it.
  const allowed = surchargeableCard(funding, pm.card.brand) && detail?.status === 'available';
  const feeCents = allowed ? surchargeCents(amountCents, settings.surcharge.bps, detail?.maximum_amount ?? null) : 0;

  if (Number(intent.metadata?.bpm_surcharge ?? 0) !== feeCents || intent.amount !== amountCents + feeCents) {
    await stripe.paymentIntents.update(
      intent.id,
      {
        amount: amountCents + feeCents,
        metadata: { bpm_surcharge: String(feeCents) },
        ...(feeCents > 0 ? { amount_details: { surcharge: { amount: feeCents } } } : {}),
      } as unknown as Stripe.PaymentIntentUpdateParams,
      { ...account, apiVersion: SURCHARGE_API_VERSION },
    );
  }
  return {
    intentId: intent.id,
    baseCents: amountCents,
    feeCents,
    totalCents: amountCents + feeCents,
    bps: settings.surcharge.bps,
    funding,
    brand: pm.card.brand ?? null,
    last4: pm.card.last4 ?? null,
  };
}

/**
 * Step 4: charge the quoted intent. Only this member's, only in this club,
 * only one that has not been charged; the amount is the one on the intent,
 * never anything the browser sends. Answers what the browser does next: done,
 * or a card check (3-D Secure) for Stripe.js to show with the client secret.
 */
export async function confirmCardPayment(
  groupId: string,
  memberId: string,
  intentId: string,
  returnUrl: string,
): Promise<{ status: string; clientSecret: string | null }> {
  const settings = await readyClub(groupId);
  const stripe = must();
  const account = { stripeAccount: settings.stripeAccountId };
  const intent = await stripe.paymentIntents.retrieve(intentId, {}, account);
  if (intent.metadata?.bpm_flow !== 'surcharge' || intent.metadata?.bpm_group !== groupId || intent.metadata?.bpm_member !== memberId) {
    throw new SurchargeError('not_yours');
  }
  if (intent.status === 'succeeded' || intent.status === 'processing') throw new SurchargeError('already_done');
  if (intent.status !== 'requires_confirmation' && intent.status !== 'requires_payment_method') {
    // requires_action: a card check already under way — hand it back to finish.
    return { status: intent.status, clientSecret: intent.client_secret };
  }
  const confirmed = await stripe.paymentIntents.confirm(
    intentId,
    { return_url: returnUrl } as Stripe.PaymentIntentConfirmParams,
    { ...account, apiVersion: SURCHARGE_API_VERSION, idempotencyKey: `bpm-confirm:${intentId}` },
  );
  return { status: confirmed.status, clientSecret: confirmed.client_secret };
}
