/**
 * CARD PAYMENTS — a SANDBOX PROTOTYPE (docs/plans/card-pay-prototype.md).
 *
 * Began as a sandbox prototype while "card payments processing" was a locked
 * ROADMAP non-goal; the non-goal was lifted on 2026-11-12 and the flag
 * (`NEXT_PUBLIC_FLAG_CARD_PAY`) has been ON in production since 2026-11-15.
 *
 * THE MONEY FLOW (Stripe Connect, a SaaS platform with direct charges):
 *   - Each CLUB is its own Stripe account. An organiser connects it once
 *     (Accounts v2, `dashboard: 'full'`, Stripe collects the fees and owns the
 *     losses), and its id lives in the club's `clubSettings` doc. BPM is the
 *     software, never the merchant: a member's $12 lands in the club's
 *     account, never in another club's and never in the platform's.
 *   - A member pays their SETTLED session lines, and their finished, priced
 *     stringing jobs, through a Stripe-hosted
 *     Checkout page created ON the club's account (`stripeAccount`). Only
 *     frozen money, for the same reason e-transfer auto-match and "pay with
 *     credit" read `settledLines`: an estimate can still move under a payment.
 *   - A signed webhook (`checkout.session.completed`) marks each row paid with
 *     `paidVia: 'card'` and `paymentId: <Checkout Session id>`, and the ledger
 *     mirror writes `payment:<row>:<session id>` — so a redelivered event
 *     computes the same ids and changes nothing.
 *
 * NEVER GUESS WITH MONEY. A line that cannot be applied when the money lands
 * (paid another way meanwhile, covered, re-priced, removed) is REFUNDED to the
 * card, never carried as an overpayment nobody asked for. A Checkout Session
 * whose amount does not match the lines it carries, or that arrives from an
 * account other than the club's own, is ignored — and WRITTEN DOWN FOR A
 * PERSON as a `review` row in the club's `payments` container (`source:
 * 'card'`), the same queue the e-transfer inbox fills, so it shows under
 * "Needs a look" (docs/plans/money-audit.md, 2026-11-16: until then these
 * were a `console.error` nobody read). The row's id is derived from the
 * Checkout Session (and the charge, for a refund), so a redelivered event
 * finds it and writes nothing; a write that fails throws, so the webhook
 * answers 500 and Stripe redelivers.
 */
import Stripe from 'stripe';
import { createHash } from 'crypto';
import { isFlagOn } from './flags';
import { groupDocId, groupScope, type GroupScope } from './groupScope';
import { computeOwed, settledLines, type OwedLine } from './owedBalance';
import { resolveIdentity } from './playerIdentity';
import { everPaidBy, mirrorPaid, mirrorStringingChanged, mirrorUnpaid } from './ledgerMirror';
import { isBillable } from './stringingBilling';
import { ensurePayments, releaseHoldIfSettled } from './paymentsInbox';
import { requireOutboundOrigin } from './appOrigin';
import type { EtransferPayment, Player, StringingJob } from './types';
import { APP_NAME } from './brand';
import { feeShareOf, linesPartOfRefund, maxAllowedSurcharge } from './surchargeMath';
import { sendCardReceipt, sessionDay, type ReceiptLine } from './cardReceiptEmail';
import { returnRowCredit } from './storeCredit';


/**
 * A card refund or chargeback un-paid a row credit had helped pay
 * (docs/plans/partial-credit.md): the credit it held goes back to whoever
 * spent it — the row's member, or a guest's host — spend by spend. Clearing
 * the row without this left the credit spent on a line that now owes it all.
 */
async function giveBackRowCredit(scope: GroupScope, row: Record<string, unknown>, pk: string, note: string): Promise<void> {
  const landed = Array.isArray(row.creditSpends) ? (row.creditSpends as string[]) : [];
  if (landed.length === 0) return;
  const spender = typeof row.memberId === 'string' ? row.memberId : typeof row.guestOf === 'string' ? row.guestOf : null;
  if (!spender) return;
  await returnRowCredit(scope, spender, { kind: 'session', ref: String(row.id), pk }, landed, 'stripe', note);
}

export const CARD_PAY_SETTINGS_ID = 'card-pay';
export function cardPaySettingsId(groupId: string): string {
  return groupDocId(groupId, CARD_PAY_SETTINGS_ID);
}

/** The club's connected Stripe account. One per club, in `clubSettings`. */
export interface CardPaySettingsDoc {
  id: string;
  kind: 'cardPay';
  groupId?: string;
  /** The Accounts v2 id (`acct_…`). */
  stripeAccountId: string;
  /** `configuration.merchant.capabilities.card_payments.status === 'active'`, as last read. */
  chargesEnabled: boolean;
  connectedBy: string;
  createdAt: string;
  updatedAt: string;
  /**
   * The card fee on credit cards (docs/plans/card-surcharge.md). Absent or
   * `on: false` = no fee, and members pay through Stripe's hosted Checkout as
   * before. On, they pay through the in-app card form, which can tell credit
   * from debit before the charge.
   */
  surcharge?: CardSurchargeSetting;
  _etag?: string;
}

export interface CardSurchargeSetting {
  on: boolean;
  /** Basis points, 1–240 (2.4% is the most allowed). */
  bps: number;
  /** The organiser confirmed they told Mastercard and Stripe, when they turned it on. */
  acknowledgedAt?: string;
  acknowledgedBy?: string;
  updatedAt: string;
}

/** The most lines one Checkout carries; older ones are paid first, the rest next time. */
export const MAX_CARD_LINES = 12;
export const CURRENCY = 'cad';

export class CardPayError extends Error {
  constructor(public code: 'club_not_connected' | 'club_not_ready' | 'nothing_to_pay' | 'unavailable') {
    super(code);
  }
}

// ── The Stripe client ───────────────────────────────────────────────────────

let client: Stripe | null = null;
let override: Stripe | null | undefined;

/** The Stripe client, or null when no `STRIPE_SECRET_KEY` is set (the feature is then off). */
export function stripeClient(): Stripe | null {
  if (override !== undefined) return override;
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key) return null;
  return (client ??= new Stripe(key, { appInfo: { name: APP_NAME } }));
}

/** Tests only: a fake client, or `undefined` to go back to the real one. */
export function _setStripeForTests(fake: Stripe | null | undefined): void {
  override = fake;
}

/** The flag AND a key. Either missing, every card route answers as if it did not exist. */
export function cardPayOn(): boolean {
  return isFlagOn('NEXT_PUBLIC_FLAG_CARD_PAY') && stripeClient() !== null;
}

export function must(): Stripe {
  const s = stripeClient();
  if (!s) throw new CardPayError('unavailable');
  return s;
}

/** Where Stripe sends a person back to. Never derived from the request's Host. */
function appBase(): string {
  return `${requireOutboundOrigin()}/bpm`;
}

// ── The club's account ──────────────────────────────────────────────────────

export async function readCardPay(groupId: string): Promise<CardPaySettingsDoc | undefined> {
  const doc = await groupScope(groupId).read<CardPaySettingsDoc>('clubSettings', cardPaySettingsId(groupId));
  // A shared cabinet: a point read checks the kind, so this route can never
  // read (or later write) another kind's doc by id.
  return doc?.kind === 'cardPay' ? doc : undefined;
}

const isConflict = (err: unknown) => (err as { code?: number })?.code === 409;

/**
 * Connect the club's Stripe account (creating it the first time) and return
 * a Stripe-hosted onboarding link for the organiser to finish in.
 */
export async function connectClub(groupId: string, organiserMemberId: string): Promise<{ url: string }> {
  const stripe = must();
  const scope = groupScope(groupId);
  let doc = await readCardPay(groupId);
  if (!doc) {
    const account = await stripe.v2.core.accounts.create(
      {
        dashboard: 'full',
        identity: { country: 'ca' },
        defaults: {
          currency: CURRENCY,
          responsibilities: { fees_collector: 'stripe', losses_collector: 'stripe' },
        },
        configuration: { merchant: { capabilities: { card_payments: { requested: true } } } },
        metadata: { bpm_group: groupId },
      },
      // Two organisers tapping at once must not open two accounts for one club.
      { idempotencyKey: `bpm-connect:${groupId}` },
    );
    const now = new Date().toISOString();
    try {
      doc = await scope.create<CardPaySettingsDoc>('clubSettings', {
        id: cardPaySettingsId(groupId),
        kind: 'cardPay',
        stripeAccountId: account.id,
        chargesEnabled: false,
        connectedBy: organiserMemberId,
        createdAt: now,
        updatedAt: now,
      });
    } catch (err) {
      if (!isConflict(err)) throw err;
      doc = await readCardPay(groupId);
      if (!doc) throw err;
    }
  }
  const base = appBase();
  const link = await stripe.v2.core.accountLinks.create({
    account: doc.stripeAccountId,
    use_case: {
      type: 'account_onboarding',
      account_onboarding: {
        refresh_url: `${base}/?tab=admin&cardpay=refresh`,
        return_url: `${base}/?tab=admin&cardpay=return`,
      },
    },
  });
  return { url: link.url };
}

export interface CardPayStatus {
  connected: boolean;
  chargesEnabled: boolean;
  /** The club's own account, for the organiser's "Open Stripe Dashboard" link. */
  stripeAccountId?: string;
}

/** Ask Stripe whether the club can take cards yet, and remember the answer. */
export async function refreshCardPayStatus(groupId: string): Promise<CardPayStatus> {
  const doc = await readCardPay(groupId);
  if (!doc) return { connected: false, chargesEnabled: false };
  const account = await must().v2.core.accounts.retrieve(doc.stripeAccountId, { include: ['configuration.merchant'] });
  const chargesEnabled = account.configuration?.merchant?.capabilities?.card_payments?.status === 'active';
  if (chargesEnabled !== doc.chargesEnabled) {
    // Best effort: a lost race only means the next read asks Stripe again.
    await groupScope(groupId).replace('clubSettings', { ...doc, chargesEnabled, updatedAt: new Date().toISOString() });
  }
  return { connected: true, chargesEnabled, stripeAccountId: doc.stripeAccountId };
}

/** Whether Home should offer "Pay by card" — the stored answer, no Stripe call. */
export async function clubTakesCards(groupId: string): Promise<boolean> {
  if (!cardPayOn()) return false;
  return (await readCardPay(groupId))?.chargesEnabled === true;
}

// ── Checkout ────────────────────────────────────────────────────────────────

/**
 * One payable line, as carried through Stripe metadata:
 * `<kind>:<id>:<partition key>:<cents>` — a session share is
 * `session:<players row>:<sessionId>:<cents>`, a finished stringing job
 * `stringing:<job id>:<memberId>:<cents>`.
 */
export interface CardLine {
  kind: 'session' | 'stringing';
  ref: string;
  pk: string;
  amountCents: number;
}

export function encodeLine(l: Pick<OwedLine, 'kind' | 'ref' | 'pk' | 'amountCents'>): string {
  return `${l.kind}:${l.ref}:${l.pk}:${l.amountCents}`;
}

/** The lines a Checkout Session carries, from its metadata. Anything malformed is dropped. */
export function linesFromMetadata(metadata: Record<string, string> | null | undefined): CardLine[] {
  if (!metadata) return [];
  const out: CardLine[] = [];
  for (let i = 0; i < MAX_CARD_LINES; i++) {
    const raw = metadata[`bpm_line_${i}`];
    if (!raw) break;
    const k = raw.indexOf(':');
    const kind = raw.slice(0, k);
    if (kind !== 'session' && kind !== 'stringing') continue;
    // The partition key may itself contain ':' (`<group>:session-…`), so the
    // id is the field after the kind, the cents the last, the key between.
    const rest = raw.slice(k + 1);
    const first = rest.indexOf(':');
    const last = rest.lastIndexOf(':');
    if (first <= 0 || last <= first) continue;
    const amountCents = Number(rest.slice(last + 1));
    if (!Number.isInteger(amountCents) || amountCents <= 0) continue;
    out.push({ kind, ref: rest.slice(0, first), pk: rest.slice(first + 1, last), amountCents });
  }
  return out;
}

/**
 * What a member can pay by card right now, oldest first: settled session
 * shares and finished, priced stringing jobs (frozen money, as e-transfer and
 * credit pay), at most MAX_CARD_LINES, with the metadata that carries them
 * through Stripe. Shared by Checkout and the in-app card form.
 */
export async function payableLines(
  groupId: string,
  memberId: string,
): Promise<{ lines: OwedLine[]; metadata: Record<string, string>; amountCents: number }> {
  const scope = groupScope(groupId);
  const identity = await resolveIdentity({ memberId }, groupId);
  const lines = settledLines(await computeOwed(scope, identity), identity.memberId)
    .filter((l) => l.amountCents > 0)
    .slice(0, MAX_CARD_LINES);
  if (lines.length === 0) throw new CardPayError('nothing_to_pay');
  const metadata: Record<string, string> = { bpm_group: groupId, bpm_member: memberId };
  lines.forEach((l, i) => {
    metadata[`bpm_line_${i}`] = encodeLine(l);
  });
  return { lines, metadata, amountCents: lines.reduce((sum, l) => sum + l.amountCents, 0) };
}

/**
 * A Stripe-hosted Checkout page for this member's settled session lines, as a
 * direct charge on the club's account. Returns the page's URL.
 */
export async function startCardCheckout(
  groupId: string,
  memberId: string,
  now = Date.now(),
  opts: { native?: boolean } = {},
): Promise<{ url: string; lines: number; amountCents: number }> {
  const stripe = must();
  const settings = await readCardPay(groupId);
  if (!settings) throw new CardPayError('club_not_connected');
  if (!settings.chargesEnabled) throw new CardPayError('club_not_ready');
  const { lines, metadata, amountCents } = await payableLines(groupId, memberId);

  // A double tap within ten minutes gets the SAME page, not a second charge.
  const key = createHash('sha256')
    .update([groupId, memberId, ...lines.map(encodeLine), String(Math.floor(now / 600_000)), opts.native ? 'native' : 'web'].join('|'))
    .digest('hex')
    .slice(0, 40);

  const base = appBase();
  // The store apps open Checkout in the system browser sheet, a separate
  // browser: sending it back to `/?tab=home` would load the website inside
  // that sheet. It lands on /pay/done instead, whose button opens
  // `bpm://pay/return` and hands the person back to the app.
  const back = opts.native
    ? { success_url: `${base}/pay/done`, cancel_url: `${base}/pay/done?cancelled=1` }
    : { success_url: `${base}/?tab=home&card=paid`, cancel_url: `${base}/?tab=home` };
  const session = await stripe.checkout.sessions.create(
    {
      mode: 'payment',
      line_items: lines.map((l) => ({
        quantity: 1,
        price_data: {
          currency: CURRENCY,
          unit_amount: l.amountCents,
          product_data: { name: `${l.kind === 'stringing' ? 'Stringing' : 'Badminton'} · ${l.at.slice(0, 10)}` },
        },
      })),
      client_reference_id: memberId,
      metadata,
      payment_intent_data: { metadata },
      ...back,
    },
    { stripeAccount: settings.stripeAccountId, idempotencyKey: `bpm-checkout:${key}` },
  );
  if (!session.url) throw new CardPayError('unavailable');
  return { url: session.url, lines: lines.length, amountCents };
}

// ── What a person has to look at ────────────────────────────────────────────

export type CardReviewReason = 'card_amount_mismatch' | 'card_account_mismatch' | 'card_unapplied_not_refunded' | 'card_refund_no_line' | 'card_dispute' | 'card_dispute_no_line';

/**
 * File a Stripe outcome the webhook could not act on where the organiser will
 * see it: a `review` row in `payments`, beside the e-transfers. Keyed on the
 * Checkout Session (and the charge, for a refund) so a redelivery 409s and is
 * swallowed; any other failure THROWS, so the webhook answers 500 and Stripe
 * tries again — a lost alert is the one outcome this exists to prevent.
 */
async function fileCardReview(
  groupId: string,
  input: { checkoutId: string; chargeId?: string; disputeId?: string; kind: 'payment' | 'refund' | 'dispute'; memberId: string | null; amountCents: number; reason: CardReviewReason; at?: number },
): Promise<void> {
  await ensurePayments();
  const scope = groupScope(groupId);
  const bareId =
    input.kind === 'refund' ? `card:${input.checkoutId}:refund:${input.chargeId ?? 'charge'}`
    : input.kind === 'dispute' ? `card:${input.checkoutId}:dispute:${input.disputeId ?? 'dispute'}`
    : `card:${input.checkoutId}`;
  const identity = input.memberId ? await resolveIdentity({ memberId: input.memberId }, groupId).catch(() => null) : null;
  const payerName = identity?.member?.name ?? null;
  const now = new Date().toISOString();
  const doc: EtransferPayment = {
    id: groupDocId(groupId, bareId),
    source: 'card',
    card: { checkoutId: input.checkoutId, ...(input.chargeId ? { chargeId: input.chargeId } : {}), ...(input.disputeId ? { disputeId: input.disputeId } : {}), kind: input.kind },
    senderName: payerName,
    amountCents: input.amountCents,
    memo: null,
    subject: input.kind === 'refund' ? `Stripe refund ${input.chargeId ?? ''}`.trim() : input.kind === 'dispute' ? `Stripe dispute ${input.disputeId ?? ''}`.trim() : `Stripe Checkout ${input.checkoutId}`,
    receivedAt: input.at ? new Date(input.at * 1000).toISOString() : now,
    // Stripe signed the event: the money (or the refund) is real.
    authenticated: true,
    status: 'review',
    reason: input.reason,
    memberId: input.memberId,
    ...(payerName ? { payerName } : {}),
    allocations: [],
    ...(payerName ? { suggestions: [{ memberId: input.memberId, name: payerName, owedCents: 0, proposed: [] }] } : {}),
    createdAt: now,
  };
  try {
    await scope.create('payments', doc);
  } catch (err) {
    if (!isConflict(err)) throw err; // already filed by an earlier delivery
  }
}

// ── The webhook ─────────────────────────────────────────────────────────────

type LineOutcome = 'paid' | 'ours' | 'not_applied';

/**
 * This Checkout paid the line once already, and the line has changed since
 * (un-ticked, refunded, disputed, re-settled, deleted). The money did its job:
 * a redelivery must NOT refund it. Stripe's idempotency key on the refund
 * lasts 24 hours, so it cannot be what stops a Resend days later; the row's
 * own stamps and the ledger's payment entry (kept even when voided) can.
 */
async function paidByThisBefore(scope: GroupScope, line: CardLine, checkoutId: string, doc: { id: string; memberId?: string | null; guestOf?: string | null; refundedPaymentId?: string; disputedPaymentId?: string; paymentId?: string; cardPaymentId?: string } | undefined, memberId: string): Promise<boolean> {
  if (doc && [doc.refundedPaymentId, doc.disputedPaymentId, doc.paymentId, doc.cardPaymentId].includes(checkoutId)) return true;
  try {
    return await everPaidBy(scope, doc ?? { id: line.ref, memberId: line.kind === 'stringing' ? line.pk : memberId }, checkoutId);
  } catch {
    // Can't tell: never refund on a guess. The caller files it for a person.
    return true;
  }
}

/**
 * Mark one row paid by this Checkout Session, or say why not. A row is paid
 * only when it is still this member's, still SETTLED, still unpaid, and still
 * owes exactly what was charged for it.
 */
async function markCardPaid(scope: GroupScope, line: CardLine, memberId: string, checkoutId: string, paidAt: string): Promise<LineOutcome> {
  if (line.kind === 'stringing') return markJobCardPaid(scope, line, memberId, checkoutId, paidAt);
  for (let attempt = 0; attempt < 2; attempt++) {
    const row = await scope.read<Player & Record<string, unknown>>('players', line.ref, line.pk);
    if (!row) return 'not_applied';
    if (row.memberId !== memberId && row.guestOf !== memberId) return 'not_applied';
    // A redelivered event, or the second of two racing deliveries.
    if (row.paid === true) return row.paidVia === 'card' && row.paymentId === checkoutId ? 'ours' : 'not_applied';
    if (row.writtenOff === true || typeof row.settledAt !== 'string') return 'not_applied';
    // What is still owed: the bill less anything received before (docs/plans/paid-amount.md).
    if (Math.round((row.owedAmount ?? 0) * 100) - Math.round((row.paidAmount ?? 0) * 100) !== line.amountCents) return 'not_applied';
    const written = await scope.replace('players', { ...row, paid: true, paidAt, paidVia: 'card', paymentId: checkoutId, paidAmount: row.owedAmount }, line.pk);
    if (written) {
      await mirrorPaid(scope, written as unknown as Player, line.amountCents);
      return 'paid';
    }
    // `undefined`: gone OR changed under us (etag). Read again and decide.
  }
  return 'not_applied';
}

/**
 * The same for a finished stringing job: still this member's, still billable
 * (done, priced, unpaid) at exactly the price charged. The ledger keys the
 * payment on `paidAt` as it does for every way a job is paid; `cardPaymentId`
 * is what tells a redelivery that this Checkout already paid it.
 */
async function markJobCardPaid(scope: GroupScope, line: CardLine, memberId: string, checkoutId: string, paidAt: string): Promise<LineOutcome> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const job = await scope.read<StringingJob>('stringingJobs', line.ref, line.pk);
    if (!job || job.memberId !== memberId) return 'not_applied';
    if (job.paidAt !== null) return job.cardPaymentId === checkoutId ? 'ours' : 'not_applied';
    if (!isBillable(job) || job.priceCents !== line.amountCents) return 'not_applied';
    const written = await scope.replace<StringingJob>(
      'stringingJobs',
      { ...job, paidAt, paidVia: 'card', paymentId: checkoutId, cardPaymentId: checkoutId, updatedAt: new Date().toISOString() },
      line.pk,
    );
    if (written) {
      await mirrorStringingChanged(scope, job, written, 'card', checkoutId);
      return 'paid';
    }
  }
  return 'not_applied';
}

export type ApplyResult =
  | { ignored: 'not_paid' | 'not_ours' | 'unknown_club' | 'account_mismatch' | 'amount_mismatch' }
  | { applied: number; alreadyOurs: number; appliedBefore?: number; refundedCents: number };

/**
 * Money that landed for a member's lines, from either way of paying by card:
 * a hosted Checkout Session (no fee), or a PaymentIntent from the in-app card
 * form (`bpm_flow: 'surcharge'`, maybe a fee). `id` is what the rows record as
 * `paymentId` and what keys the ledger payment, the refund and the review row.
 */
export interface PaidSource {
  id: string;
  metadata: Record<string, string> | null | undefined;
  /** Everything the card was charged, fee included, cents. */
  chargedCents: number;
  currency: string | null | undefined;
  /** Unix seconds. */
  created: number | null | undefined;
  paymentIntentId: string | null;
  /** The card fee in `chargedCents` (0 for Checkout). */
  feeCents: number;
}

/** The fee a surcharge PaymentIntent says it carries (its own metadata; the event's API version may not show `amount_details.surcharge`). */
export function feeOfIntent(pi: Pick<Stripe.PaymentIntent, 'metadata'>): number {
  const n = Number(pi.metadata?.bpm_surcharge ?? 0);
  return Number.isInteger(n) && n > 0 ? n : 0;
}

/**
 * Apply a completed Checkout Session. `eventAccount` is the Stripe-Account the
 * EVENT came from (`event.account`), which must be the club's own: the
 * metadata names a club, but only the signed envelope says whose money it is.
 */
export async function applyPaidCheckout(session: Stripe.Checkout.Session, eventAccount: string | undefined): Promise<ApplyResult> {
  if (session.payment_status !== 'paid') return { ignored: 'not_paid' };
  return applyPaidSource(
    {
      id: session.id,
      metadata: session.metadata,
      chargedCents: session.amount_total ?? 0,
      currency: session.currency,
      created: session.created,
      paymentIntentId: typeof session.payment_intent === 'string' ? session.payment_intent : (session.payment_intent?.id ?? null),
      feeCents: 0,
    },
    eventAccount,
  );
}

/**
 * Apply a succeeded PaymentIntent from the in-app card form (the card fee's
 * path, docs/plans/card-surcharge.md). A Checkout's own PaymentIntent also
 * succeeds and carries the same lines; it is left to `checkout.session.*`,
 * so only `bpm_flow: 'surcharge'` is read here.
 */
export async function applyPaidIntent(pi: Stripe.PaymentIntent, eventAccount: string | undefined): Promise<ApplyResult> {
  if (pi.metadata?.bpm_flow !== 'surcharge') return { ignored: 'not_ours' };
  if (pi.status !== 'succeeded') return { ignored: 'not_paid' };
  return applyPaidSource(
    {
      id: pi.id,
      metadata: pi.metadata,
      chargedCents: pi.amount_received || pi.amount,
      currency: pi.currency,
      created: pi.created,
      paymentIntentId: pi.id,
      feeCents: feeOfIntent(pi),
    },
    eventAccount,
  );
}

async function applyPaidSource(source: PaidSource, eventAccount: string | undefined): Promise<ApplyResult> {
  const groupId = source.metadata?.bpm_group;
  const memberId = source.metadata?.bpm_member;
  if (!groupId || !memberId) return { ignored: 'not_ours' };

  const settings = await readCardPay(groupId);
  if (!settings) return { ignored: 'unknown_club' };
  const charged = source.chargedCents;
  if (!eventAccount || settings.stripeAccountId !== eventAccount) {
    console.error('[card-pay] payment from an account that is not the club\'s', { groupId, source: source.id });
    await fileCardReview(groupId, { checkoutId: source.id, kind: 'payment', memberId, amountCents: charged, reason: 'card_account_mismatch', at: source.created ?? undefined });
    return { ignored: 'account_mismatch' };
  }
  const lines = linesFromMetadata(source.metadata);
  const total = lines.reduce((sum, l) => sum + l.amountCents, 0);
  // The fee must be within the rules on top of exactly the lines, or a person decides.
  const feeOk = source.feeCents >= 0 && source.feeCents <= maxAllowedSurcharge(total);
  if (lines.length === 0 || !feeOk || total + source.feeCents !== charged || source.currency !== CURRENCY) {
    // We built this charge; a mismatch is a bug or tampering, and a person decides.
    console.error('[card-pay] charge does not match its lines', { groupId, source: source.id, total, fee: source.feeCents, charged });
    await fileCardReview(groupId, { checkoutId: source.id, kind: 'payment', memberId, amountCents: charged, reason: 'card_amount_mismatch', at: source.created ?? undefined });
    return { ignored: 'amount_mismatch' };
  }

  const scope = groupScope(groupId);
  const paidAt = new Date((source.created ?? Math.floor(Date.now() / 1000)) * 1000).toISOString();
  let applied = 0;
  let alreadyOurs = 0;
  let appliedBefore = 0;
  let unappliedCents = 0;
  // The lines THIS delivery newly paid, for the member's receipt. A
  // redelivery finds them already this payment's and adds nothing here.
  const receipt: ReceiptLine[] = [];
  for (const line of lines) {
    // A line this payment paid ONCE and that has changed since (un-ticked,
    // refunded, disputed, deleted) is settled business: a redelivery neither
    // pays it again over the organiser's decision nor refunds money that
    // already did its job (2026-11-18). Only a line it never touched is new.
    const doc = line.kind === 'stringing'
      ? await scope.read<StringingJob>('stringingJobs', line.ref, line.pk)
      : await scope.read<Player & Record<string, unknown>>('players', line.ref, line.pk);
    const holdsItNow = !!doc && (line.kind === 'stringing'
      ? (doc as StringingJob).paidAt !== null && (doc as StringingJob).cardPaymentId === source.id
      : (doc as Player).paid === true && (doc as Player).paymentId === source.id);
    if (!holdsItNow && (await paidByThisBefore(scope, line, source.id, doc as never, memberId))) {
      appliedBefore += 1;
      continue;
    }
    const outcome = await markCardPaid(scope, line, memberId, source.id, paidAt);
    if (outcome === 'paid') {
      applied += 1;
      receipt.push({ label: receiptLabel(line, doc, memberId), amountCents: line.amountCents });
    }
    else if (outcome === 'ours') alreadyOurs += 1;
    else unappliedCents += line.amountCents;
  }

  let refundedCents = 0;
  if (unappliedCents > 0) {
    // A line that cannot be paid goes back to the card WITH its share of the
    // fee (card network rule: a refund returns the prorated surcharge).
    const refund = unappliedCents + feeShareOf(unappliedCents, total, source.feeCents);
    if (source.paymentIntentId) {
      // Keyed on the source: a redelivered event cannot refund twice.
      await must().refunds.create(
        { payment_intent: source.paymentIntentId, amount: refund, metadata: { bpm_group: groupId, bpm_reason: 'line_no_longer_owed' } },
        { stripeAccount: eventAccount, idempotencyKey: `bpm-unapplied:${source.id}` },
      );
      refundedCents = refund;
    } else {
      console.error('[card-pay] cannot refund an unapplied line: no payment intent', { source: source.id, unappliedCents });
      await fileCardReview(groupId, { checkoutId: source.id, kind: 'payment', memberId, amountCents: refund, reason: 'card_unapplied_not_refunded', at: source.created ?? undefined });
    }
  }
  if (applied > 0 && isFlagOn('NEXT_PUBLIC_FLAG_PAYMENTS_AUTO')) {
    await releaseHoldIfSettled(scope, memberId);
  }
  if (receipt.length > 0) {
    // After every write and any refund; never throws (lib/cardReceiptEmail.ts).
    // The fee kept is these lines' share of it: the whole fee when every line landed.
    const paidCents = receipt.reduce((sum, l) => sum + l.amountCents, 0);
    await sendCardReceipt(groupId, memberId, receipt, feeShareOf(paidCents, total, source.feeCents), refundedCents, paidAt);
  }
  return { applied, alreadyOurs, appliedBefore, refundedCents };
}

/** How a paid line reads on the receipt: the night it was for (and whose
 *  share, for a guest), or the restring's job number. */
function receiptLabel(line: CardLine, doc: unknown, memberId: string): string {
  if (line.kind === 'stringing') {
    const job = doc as StringingJob | undefined;
    return job?.jobNo ? `Stringing · ${job.jobNo}` : 'Stringing';
  }
  const row = doc as (Player & { sessionId?: string }) | undefined;
  const day = sessionDay(row?.sessionId ?? line.pk);
  const base = day ? `Badminton · ${day}` : 'Badminton';
  return row && row.guestOf === memberId && row.memberId !== memberId && row.name ? `${base} · for ${row.name}` : base;
}

// ── Refunds made in the Stripe Dashboard ────────────────────────────────────

export type RefundResult =
  | { ignored: 'not_ours' | 'unknown_club' | 'account_mismatch' | 'app_refund' }
  | { unpaid: number; already: boolean }
  | { review: 'amount_matches_no_line' };

/**
 * A refund an organiser made in Stripe puts the rows it paid back to unpaid —
 * only when the amount says WHICH rows (never guess with money):
 *
 *   - refunds made by people (the app's own refunds of unapplied lines carry
 *     `metadata.bpm_reason` and are left out) are summed for the charge;
 *   - what this refund has already undone is the rows stamped
 *     `refundedPaymentId: <session>`, so a redelivered event, or a second
 *     partial refund later, only acts on what is new;
 *   - new refunded money equal to everything still paid by this session →
 *     every one of those rows; equal to exactly one row's amount, and only one
 *     → that row; anything else → logged for a person, nothing changes.
 */
/**
 * Which payment a charge belongs to: a hosted Checkout, or the in-app card
 * form's own PaymentIntent (the card fee's path, docs/plans/card-surcharge.md),
 * which carries the lines itself and the fee it charged. Its id stands in for
 * the Checkout's: it is what the webhook stamped as `paymentId`.
 */
async function cardSourceOf(
  stripe: Stripe,
  paymentIntentId: string,
  account: string,
): Promise<{ session: { id: string; metadata: Record<string, string> | null | undefined } | undefined; feeCents: number }> {
  const checkout = (await stripe.checkout.sessions.list({ payment_intent: paymentIntentId, limit: 1 }, { stripeAccount: account })).data[0];
  if (checkout) return { session: checkout, feeCents: 0 };
  const intent = await stripe.paymentIntents.retrieve(paymentIntentId, {}, { stripeAccount: account });
  if (intent?.metadata?.bpm_flow !== 'surcharge') return { session: undefined, feeCents: 0 };
  return { session: { id: intent.id, metadata: intent.metadata }, feeCents: feeOfIntent(intent) };
}

export async function applyRefund(charge: Stripe.Charge, eventAccount: string | undefined): Promise<RefundResult> {
  if (!eventAccount) return { ignored: 'not_ours' };
  const pi = typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id;
  if (!pi) return { ignored: 'not_ours' };
  const stripe = must();
  const { session, feeCents } = await cardSourceOf(stripe, pi, eventAccount);
  const groupId = session?.metadata?.bpm_group;
  const memberId = session?.metadata?.bpm_member;
  if (!session || !groupId || !memberId) return { ignored: 'not_ours' };
  const settings = await readCardPay(groupId);
  if (!settings) return { ignored: 'unknown_club' };
  if (settings.stripeAccountId !== eventAccount) {
    console.error('[card-pay] refund from an account that is not the club\'s', { groupId, charge: charge.id });
    return { ignored: 'account_mismatch' };
  }

  const refunds = (await stripe.refunds.list({ charge: charge.id, limit: 100 }, { stripeAccount: eventAccount })).data;
  const refundedByPeople = refunds
    .filter((r) => !r.metadata?.bpm_reason && r.status !== 'failed' && r.status !== 'canceled')
    .reduce((sum, r) => sum + r.amount, 0);
  if (refundedByPeople <= 0) return { ignored: 'app_refund' };

  const scope = groupScope(groupId);
  // Each line's doc: a session row, or a stringing job.
  type Held =
    | { line: CardLine; kind: 'session'; doc: Player & Record<string, unknown> }
    | { line: CardLine; kind: 'stringing'; doc: StringingJob };
  const held: Held[] = [];
  for (const line of linesFromMetadata(session.metadata)) {
    if (line.kind === 'stringing') {
      const doc = await scope.read<StringingJob>('stringingJobs', line.ref, line.pk);
      if (doc) held.push({ line, kind: 'stringing', doc });
    } else {
      const doc = await scope.read<Player & Record<string, unknown>>('players', line.ref, line.pk);
      if (doc) held.push({ line, kind: 'session', doc });
    }
  }
  const paidByThis = (h: Held) =>
    h.kind === 'session'
      ? h.doc.paid === true && h.doc.paidVia === 'card' && h.doc.paymentId === session.id
      : h.doc.paidAt !== null && h.doc.cardPaymentId === session.id;
  // With a card fee, a refund carries its prorated share of the fee: only
  // the LINES' part of what was refunded says which rows it was for.
  const linesTotal = held.reduce((sum, h) => sum + h.line.amountCents, 0);
  const byPeople = linesPartOfRefund(refundedByPeople, linesTotal, feeCents);
  const undone = held.filter((h) => h.doc.refundedPaymentId === session.id).reduce((sum, h) => sum + h.line.amountCents, 0);
  const stillPaid = held.filter(paidByThis);
  const fresh = byPeople - undone;
  if (fresh <= 0) return { unpaid: 0, already: true };

  // A prorated fee rounds; with one, a cent either way still names the line.
  const near = (a: number, b: number) => (feeCents > 0 ? Math.abs(a - b) <= 1 : a === b);
  const stillPaidCents = stillPaid.reduce((sum, h) => sum + h.line.amountCents, 0);
  const oneLine = stillPaid.filter((h) => near(h.line.amountCents, fresh));
  const target = near(fresh, stillPaidCents) ? stillPaid : oneLine.length === 1 ? oneLine : null;
  if (!target) {
    console.error('[card-pay] a refund made in Stripe matches no paid line — left for a person', { groupId, charge: charge.id, fresh, stillPaidCents });
    await fileCardReview(groupId, { checkoutId: session.id, chargeId: charge.id, kind: 'refund', memberId, amountCents: fresh, reason: 'card_refund_no_line', at: charge.created });
    return { review: 'amount_matches_no_line' };
  }

  let unpaid = 0;
  for (const h of target) {
    if (h.kind === 'session') {
      const written = await scope.replace(
        'players',
        { ...h.doc, paid: false, paidAt: undefined, paidVia: undefined, paymentId: undefined, paidAmount: undefined, creditSpends: undefined, refundedPaymentId: session.id },
        h.line.pk,
      );
      if (!written) continue; // changed under us; the next delivery re-reads
      await mirrorUnpaid(scope, h.doc as unknown as Player);
      await giveBackRowCredit(scope, h.doc, h.line.pk, 'Card refunded — credit returned');
    } else {
      const written = await scope.replace<StringingJob>(
        'stringingJobs',
        { ...h.doc, paidAt: null, paidVia: undefined, paymentId: undefined, cardPaymentId: undefined, refundedPaymentId: session.id, updatedAt: new Date().toISOString() },
        h.line.pk,
      );
      if (!written) continue;
      await mirrorStringingChanged(scope, h.doc, written, 'card', session.id);
    }
    unpaid += 1;
  }
  return { unpaid, already: false };
}

// ── Disputes (chargebacks) ──────────────────────────────────────────────────

export type DisputeResult =
  | { ignored: 'not_ours' | 'unknown_club' | 'account_mismatch' | 'not_won' }
  | { unpaid: number; already: boolean; review: 'card_dispute' | 'card_dispute_no_line' }
  | { repaid: number; already: boolean };

/**
 * A member's bank pulled a card payment back (`charge.dispute.created`,
 * docs/plans/money-audit.md "How BPM stays true with Stripe", item 2; Grant:
 * "Do dispute"). Stripe takes the disputed amount from the club's account the
 * moment the dispute opens, so the lines it paid are owed again — the same
 * rule as a Dashboard refund (`applyRefund`): the disputed money equal to
 * everything still paid by this Checkout → every one of those lines; equal
 * to exactly one line's amount, and only one → that line; anything else →
 * nothing moves. And whichever it is, a `review` row is filed under "Needs a
 * look" (keyed on the dispute, so a redelivery files nothing twice): a
 * dispute has a deadline in Stripe that only a person can meet.
 *
 * `charge.dispute.closed` with `status: 'won'` returns the money: the lines
 * this dispute un-paid, still unpaid, are marked paid by card again under the
 * same Checkout, each with a fresh ledger entry (`mirrorPaid` numbers the
 * re-pay), and the review row is closed. Lost, or any other close, changes
 * nothing: the lines stayed owed when the dispute opened.
 */
export async function applyDispute(dispute: Stripe.Dispute, eventAccount: string | undefined, eventType: string): Promise<DisputeResult> {
  if (!eventAccount) return { ignored: 'not_ours' };
  const pi = typeof dispute.payment_intent === 'string' ? dispute.payment_intent : dispute.payment_intent?.id;
  if (!pi) return { ignored: 'not_ours' };
  const stripe = must();
  const { session, feeCents } = await cardSourceOf(stripe, pi, eventAccount);
  const groupId = session?.metadata?.bpm_group;
  const memberId = session?.metadata?.bpm_member;
  if (!session || !groupId || !memberId) return { ignored: 'not_ours' };
  const settings = await readCardPay(groupId);
  if (!settings) return { ignored: 'unknown_club' };
  if (settings.stripeAccountId !== eventAccount) {
    console.error('[card-pay] dispute from an account that is not the club\'s', { groupId, dispute: dispute.id });
    return { ignored: 'account_mismatch' };
  }
  const chargeId = typeof dispute.charge === 'string' ? dispute.charge : dispute.charge?.id;
  const scope = groupScope(groupId);
  const now = new Date().toISOString();

  type Held =
    | { line: CardLine; kind: 'session'; doc: Player & Record<string, unknown> }
    | { line: CardLine; kind: 'stringing'; doc: StringingJob };
  const held: Held[] = [];
  for (const line of linesFromMetadata(session.metadata)) {
    if (line.kind === 'stringing') {
      const doc = await scope.read<StringingJob>('stringingJobs', line.ref, line.pk);
      if (doc) held.push({ line, kind: 'stringing', doc });
    } else {
      const doc = await scope.read<Player & Record<string, unknown>>('players', line.ref, line.pk);
      if (doc) held.push({ line, kind: 'session', doc });
    }
  }

  if (eventType === 'charge.dispute.closed') {
    if (dispute.status !== 'won') return { ignored: 'not_won' };
    // The money is back: what this dispute un-paid, and nobody paid since, is paid by card again.
    const toRepay = held.filter((h) => h.doc.disputedPaymentId === session.id && (h.kind === 'session' ? h.doc.paid !== true && h.doc.writtenOff !== true : h.doc.paidAt === null));
    let repaid = 0;
    for (const h of toRepay) {
      if (h.kind === 'session') {
        const written = await scope.replace(
          'players',
          // What the card brings back is the line's part: the row records
          // that on top of whatever it holds now, and is paid only once that
          // covers the bill. A row credit or a short transfer had part-paid
          // was cleared when the dispute opened (docs/plans/partial-credit.md).
          {
            ...h.doc,
            paid: Math.round(Number(h.doc.paidAmount ?? 0) * 100) + h.line.amountCents >= Math.round(Number(h.doc.owedAmount ?? 0) * 100),
            paidAt: now,
            paidVia: 'card',
            paymentId: session.id,
            paidAmount: (Math.round(Number(h.doc.paidAmount ?? 0) * 100) + h.line.amountCents) / 100,
            disputedPaymentId: undefined,
          },
          h.line.pk,
        );
        if (!written) continue;
        await mirrorPaid(scope, written as unknown as Player, h.line.amountCents);
      } else {
        const written = await scope.replace<StringingJob>(
          'stringingJobs',
          { ...h.doc, paidAt: now, paidVia: 'card', paymentId: session.id, cardPaymentId: session.id, disputedPaymentId: undefined, updatedAt: now },
          h.line.pk,
        );
        if (!written) continue;
        await mirrorStringingChanged(scope, h.doc, written, 'card', session.id);
      }
      repaid += 1;
    }
    // The review row has nothing left to ask: the money is back.
    await ensurePayments();
    const reviewId = groupDocId(groupId, `card:${session.id}:dispute:${dispute.id}`);
    const review = await scope.read<EtransferPayment>('payments', reviewId);
    if (review?.status === 'review') await scope.replace('payments', { ...review, status: 'ignored', matchedBy: 'stripe', resolvedAt: now });
    return { repaid, already: toRepay.length === 0 };
  }

  // Opened: the bank has the money. The lines it names are owed again.
  const paidByThis = (h: Held) =>
    h.kind === 'session'
      ? h.doc.paid === true && h.doc.paidVia === 'card' && h.doc.paymentId === session.id
      : h.doc.paidAt !== null && h.doc.cardPaymentId === session.id;
  const undone = held.filter((h) => h.doc.disputedPaymentId === session.id).reduce((sum, h) => sum + h.line.amountCents, 0);
  const stillPaid = held.filter(paidByThis);
  // With a card fee, a dispute covers the fee too: only the LINES' part says
  // which rows it was for, as for a refund (a cent either way, for rounding).
  const linesTotal = held.reduce((sum, h) => sum + h.line.amountCents, 0);
  const fresh = linesPartOfRefund(dispute.amount, linesTotal, feeCents) - undone;
  const near = (a: number, b: number) => (feeCents > 0 ? Math.abs(a - b) <= 1 : a === b);
  const stillPaidCents = stillPaid.reduce((sum, h) => sum + h.line.amountCents, 0);
  const oneLine = stillPaid.filter((h) => near(h.line.amountCents, fresh));
  const target = fresh <= 0 ? [] : near(fresh, stillPaidCents) ? stillPaid : oneLine.length === 1 ? oneLine : null;
  const reason: 'card_dispute' | 'card_dispute_no_line' = target ? 'card_dispute' : 'card_dispute_no_line';
  if (!target) console.error('[card-pay] a dispute matches no paid line — left for a person', { groupId, dispute: dispute.id, fresh, stillPaidCents });

  let unpaid = 0;
  for (const h of target ?? []) {
    if (h.kind === 'session') {
      const written = await scope.replace(
        'players',
        { ...h.doc, paid: false, paidAt: undefined, paidVia: undefined, paymentId: undefined, paidAmount: undefined, creditSpends: undefined, disputedPaymentId: session.id },
        h.line.pk,
      );
      if (!written) continue; // changed under us; the next delivery re-reads
      await mirrorUnpaid(scope, h.doc as unknown as Player);
      await giveBackRowCredit(scope, h.doc, h.line.pk, 'Card payment disputed — credit returned');
    } else {
      const written = await scope.replace<StringingJob>(
        'stringingJobs',
        { ...h.doc, paidAt: null, paidVia: undefined, paymentId: undefined, cardPaymentId: undefined, disputedPaymentId: session.id, updatedAt: now },
        h.line.pk,
      );
      if (!written) continue;
      await mirrorStringingChanged(scope, h.doc, written, 'card', session.id);
    }
    unpaid += 1;
  }
  // Filed whatever happened to the lines: the deadline is in Stripe, and only a person can meet it.
  await fileCardReview(groupId, { checkoutId: session.id, chargeId, disputeId: dispute.id, kind: 'dispute', memberId, amountCents: dispute.amount, reason, at: dispute.created });
  return { unpaid, already: fresh <= 0, review: reason };
}
