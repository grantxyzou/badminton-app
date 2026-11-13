/**
 * CARD PAYMENTS — a SANDBOX PROTOTYPE (docs/plans/card-pay-prototype.md).
 *
 * "Card payments processing" is still a locked ROADMAP non-goal. This module
 * exists so the shape can be seen working against a Stripe sandbox; the flag
 * (`NEXT_PUBLIC_FLAG_CARD_PAY`) stays off in production until that is changed
 * on purpose.
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
 * account other than the club's own, is ignored and logged for a person.
 */
import Stripe from 'stripe';
import { createHash } from 'crypto';
import { isFlagOn } from './flags';
import { groupDocId, groupScope, type GroupScope } from './groupScope';
import { computeOwed, settledLines, type OwedLine } from './owedBalance';
import { resolveIdentity } from './playerIdentity';
import { mirrorPaid, mirrorStringingChanged, mirrorUnpaid } from './ledgerMirror';
import { isBillable } from './stringingBilling';
import { releaseHoldIfSettled } from './paymentsInbox';
import { requireOutboundOrigin } from './appOrigin';
import type { Player, StringingJob } from './types';
import { APP_NAME } from './brand';

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
  _etag?: string;
}

/** The most lines one Checkout carries; older ones are paid first, the rest next time. */
export const MAX_CARD_LINES = 12;
const CURRENCY = 'cad';

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

function must(): Stripe {
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
 * A Stripe-hosted Checkout page for this member's settled session lines, as a
 * direct charge on the club's account. Returns the page's URL.
 */
export async function startCardCheckout(groupId: string, memberId: string, now = Date.now()): Promise<{ url: string; lines: number; amountCents: number }> {
  const stripe = must();
  const settings = await readCardPay(groupId);
  if (!settings) throw new CardPayError('club_not_connected');
  if (!settings.chargesEnabled) throw new CardPayError('club_not_ready');

  const scope = groupScope(groupId);
  const identity = await resolveIdentity({ memberId }, groupId);
  // Settled session shares and finished, priced stringing jobs (a job is
  // frozen money by construction), oldest first, as e-transfer and credit pay.
  const lines = settledLines(await computeOwed(scope, identity), identity.memberId)
    .filter((l) => l.amountCents > 0)
    .slice(0, MAX_CARD_LINES);
  if (lines.length === 0) throw new CardPayError('nothing_to_pay');

  const metadata: Record<string, string> = { bpm_group: groupId, bpm_member: memberId };
  lines.forEach((l, i) => {
    metadata[`bpm_line_${i}`] = encodeLine(l);
  });
  const amountCents = lines.reduce((sum, l) => sum + l.amountCents, 0);

  // A double tap within ten minutes gets the SAME page, not a second charge.
  const key = createHash('sha256')
    .update([groupId, memberId, ...lines.map(encodeLine), String(Math.floor(now / 600_000))].join('|'))
    .digest('hex')
    .slice(0, 40);

  const base = appBase();
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
      success_url: `${base}/?tab=home&card=paid`,
      cancel_url: `${base}/?tab=home`,
    },
    { stripeAccount: settings.stripeAccountId, idempotencyKey: `bpm-checkout:${key}` },
  );
  if (!session.url) throw new CardPayError('unavailable');
  return { url: session.url, lines: lines.length, amountCents };
}

// ── The webhook ─────────────────────────────────────────────────────────────

type LineOutcome = 'paid' | 'ours' | 'not_applied';

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
    if (Math.round((row.owedAmount ?? 0) * 100) !== line.amountCents) return 'not_applied';
    const written = await scope.replace('players', { ...row, paid: true, paidAt, paidVia: 'card', paymentId: checkoutId }, line.pk);
    if (written) {
      await mirrorPaid(scope, written as unknown as Player);
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
      { ...job, paidAt, cardPaymentId: checkoutId, updatedAt: new Date().toISOString() },
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
  | { applied: number; alreadyOurs: number; refundedCents: number };

/**
 * Apply a completed Checkout Session. `eventAccount` is the Stripe-Account the
 * EVENT came from (`event.account`), which must be the club's own: the
 * metadata names a club, but only the signed envelope says whose money it is.
 */
export async function applyPaidCheckout(session: Stripe.Checkout.Session, eventAccount: string | undefined): Promise<ApplyResult> {
  if (session.payment_status !== 'paid') return { ignored: 'not_paid' };
  const groupId = session.metadata?.bpm_group;
  const memberId = session.metadata?.bpm_member;
  if (!groupId || !memberId) return { ignored: 'not_ours' };

  const settings = await readCardPay(groupId);
  if (!settings) return { ignored: 'unknown_club' };
  if (!eventAccount || settings.stripeAccountId !== eventAccount) {
    console.error('[card-pay] checkout from an account that is not the club\'s', { groupId, session: session.id });
    return { ignored: 'account_mismatch' };
  }
  const lines = linesFromMetadata(session.metadata);
  const total = lines.reduce((sum, l) => sum + l.amountCents, 0);
  if (lines.length === 0 || total !== session.amount_total || session.currency !== CURRENCY) {
    // We built this session; a mismatch is a bug or tampering, and a person decides.
    console.error('[card-pay] checkout amount does not match its lines', { groupId, session: session.id, total, charged: session.amount_total });
    return { ignored: 'amount_mismatch' };
  }

  const scope = groupScope(groupId);
  const paidAt = new Date((session.created ?? Math.floor(Date.now() / 1000)) * 1000).toISOString();
  let applied = 0;
  let alreadyOurs = 0;
  let unappliedCents = 0;
  for (const line of lines) {
    const outcome = await markCardPaid(scope, line, memberId, session.id, paidAt);
    if (outcome === 'paid') applied += 1;
    else if (outcome === 'ours') alreadyOurs += 1;
    else unappliedCents += line.amountCents;
  }

  let refundedCents = 0;
  if (unappliedCents > 0) {
    const pi = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id;
    if (pi) {
      // Keyed on the session: a redelivered event cannot refund twice.
      await must().refunds.create(
        { payment_intent: pi, amount: unappliedCents, metadata: { bpm_group: groupId, bpm_reason: 'line_no_longer_owed' } },
        { stripeAccount: eventAccount, idempotencyKey: `bpm-unapplied:${session.id}` },
      );
      refundedCents = unappliedCents;
    } else {
      console.error('[card-pay] cannot refund an unapplied line: no payment intent', { session: session.id, unappliedCents });
    }
  }
  if (applied > 0 && isFlagOn('NEXT_PUBLIC_FLAG_PAYMENTS_AUTO')) {
    await releaseHoldIfSettled(scope, memberId);
  }
  return { applied, alreadyOurs, refundedCents };
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
export async function applyRefund(charge: Stripe.Charge, eventAccount: string | undefined): Promise<RefundResult> {
  if (!eventAccount) return { ignored: 'not_ours' };
  const pi = typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id;
  if (!pi) return { ignored: 'not_ours' };
  const stripe = must();
  const session = (await stripe.checkout.sessions.list({ payment_intent: pi, limit: 1 }, { stripeAccount: eventAccount })).data[0];
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
  const byPeople = refunds
    .filter((r) => !r.metadata?.bpm_reason && r.status !== 'failed' && r.status !== 'canceled')
    .reduce((sum, r) => sum + r.amount, 0);
  if (byPeople <= 0) return { ignored: 'app_refund' };

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
  const undone = held.filter((h) => h.doc.refundedPaymentId === session.id).reduce((sum, h) => sum + h.line.amountCents, 0);
  const stillPaid = held.filter(paidByThis);
  const fresh = byPeople - undone;
  if (fresh <= 0) return { unpaid: 0, already: true };

  const stillPaidCents = stillPaid.reduce((sum, h) => sum + h.line.amountCents, 0);
  const oneLine = stillPaid.filter((h) => h.line.amountCents === fresh);
  const target = fresh === stillPaidCents ? stillPaid : oneLine.length === 1 ? oneLine : null;
  if (!target) {
    console.error('[card-pay] a refund made in Stripe matches no paid line — left for a person', { groupId, charge: charge.id, fresh, stillPaidCents });
    return { review: 'amount_matches_no_line' };
  }

  let unpaid = 0;
  for (const h of target) {
    if (h.kind === 'session') {
      const written = await scope.replace(
        'players',
        { ...h.doc, paid: false, paidAt: undefined, paidVia: undefined, paymentId: undefined, refundedPaymentId: session.id },
        h.line.pk,
      );
      if (!written) continue; // changed under us; the next delivery re-reads
      await mirrorUnpaid(scope, h.doc as unknown as Player);
    } else {
      const written = await scope.replace<StringingJob>(
        'stringingJobs',
        { ...h.doc, paidAt: null, cardPaymentId: undefined, refundedPaymentId: session.id, updatedAt: new Date().toISOString() },
        h.line.pk,
      );
      if (!written) continue;
      await mirrorStringingChanged(scope, h.doc, written, 'card', session.id);
    }
    unpaid += 1;
  }
  return { unpaid, already: false };
}
