/**
 * THE PAYMENTS INBOX — the server half of "the system knows who paid"
 * (docs/plans/payments.md, Phase 1).
 *
 *   key      — the per-club secret the admin's Apps Script sends. Stored as a
 *              sha256 in the club's `clubSettings` doc, shown in plaintext
 *              exactly once, at minting. It carries its group (`<groupId>.<hex>`)
 *              because the script has no cookie to say which club it is.
 *   ingest   — one forwarded email → one `payments` doc, matched or queued.
 *   assign   — the admin's one tap on a queued payment.
 *
 * A payment marks rows the SAME way an admin's tap does (`paid: true`), plus
 * the additive `paidAt` / `paidVia` / `paymentId`, so no reader of `paid`
 * changes. A row already paid or covered by the time a payment lands is left
 * alone and the allocation is dropped — two paths racing to mark the same row
 * must not let the second one quietly move money onto it.
 */
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { ensureContainer, getActiveSessionId } from './cosmos';
import { defaultMaxPlayers } from './defaults';
import { groupDocId, groupScope, type GroupScope } from './groupScope';
import { ensureClubSettings } from './stringingShop';
import { parseInteracEmail, type RawInteracEmail } from './etransferParse';
import { decideMatch, allocateAmount, type MatchCandidate } from './etransferMatch';
import { computeOwed, owedLines, type OwedLine } from './owedBalance';
import { resolveIdentity } from './playerIdentity';
import { rosterMembers } from './roster';
import type { Alias, EtransferPayment, PaymentAllocation, Player, StringingJob } from './types';

export const PAYMENTS_SETTINGS_ID = 'payments-inbox';
export function paymentsSettingsId(groupId: string): string {
  return groupDocId(groupId, PAYMENTS_SETTINGS_ID);
}

/**
 * Unpaid SETTLED sessions at which a sign-up waits on the list. 0 = off, and
 * off is the default: the hold is opted into from the admin card, after the
 * admin has seen who it would hold today. Production carries months of rows
 * that were ticked by hand or never ticked at all, and switching it on with
 * the inbox would have waitlisted people for debts already paid in cash.
 */
export const DEFAULT_HOLD_AFTER_UNPAID = 0;
/** What the admin card offers when the hold is switched on. */
export const SUGGESTED_HOLD_AFTER_UNPAID = 2;

export interface PaymentsSettingsDoc {
  id: string;
  keyHash?: string;
  keyCreatedAt?: string;
  lastReceivedAt?: string;
  holdAfterUnpaid?: number;
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const GROUP_ID_SHAPE = /^[a-z0-9]{1,64}$/;

let paymentsReady: Promise<void> | null = null;
export function ensurePayments(): Promise<void> {
  if (!paymentsReady) {
    paymentsReady = Promise.all([ensureContainer('payments', '/id'), ensureClubSettings()])
      .then(() => undefined)
      .catch((err) => {
        paymentsReady = null;
        throw err;
      });
  }
  return paymentsReady;
}

export async function readPaymentsSettings(groupId: string): Promise<PaymentsSettingsDoc | undefined> {
  await ensurePayments();
  return groupScope(groupId).read<PaymentsSettingsDoc>('clubSettings', paymentsSettingsId(groupId));
}

/** Mint (or rotate) the club's key. The ONLY time the plaintext exists. */
export async function mintPaymentsKey(groupId: string): Promise<string> {
  const key = `${groupId}.${randomBytes(24).toString('hex')}`;
  const existing = await readPaymentsSettings(groupId);
  await groupScope(groupId).upsert<PaymentsSettingsDoc>('clubSettings', {
    ...(existing ?? { id: paymentsSettingsId(groupId) }),
    keyHash: sha256(key),
    keyCreatedAt: new Date().toISOString(),
  });
  return key;
}

/**
 * The group a presented key belongs to, or `null`. Hashed both sides and
 * compared in constant time (security rule 11). A malformed key and a wrong
 * key are the same `null`.
 */
export async function groupForPaymentsKey(provided: string | null): Promise<string | null> {
  if (!provided || provided.length > 200) return null;
  const dot = provided.indexOf('.');
  const groupId = dot > 0 ? provided.slice(0, dot) : '';
  if (!GROUP_ID_SHAPE.test(groupId)) return null;
  const doc = await readPaymentsSettings(groupId);
  if (!doc?.keyHash) return null;
  const a = Buffer.from(sha256(provided), 'hex');
  const b = Buffer.from(doc.keyHash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b) ? groupId : null;
}

/**
 * Everyone the sender's name could be, with what each owes.
 *
 * An e-transfer carries the sender's LEGAL name ("BRUCE WAYNE"), which is
 * rarely the name the club uses ("Bruce W."). The `aliases` table is the
 * bridge — and every "remember this name" tap in the queue grows it, which is
 * what moves a club from mostly-queued to mostly-automatic.
 */
export async function candidatesFor(scope: GroupScope, senderName: string | null): Promise<MatchCandidate[]> {
  if (!senderName) return [];
  const lower = senderName.trim().toLowerCase();
  const aliases = await scope.query<Alias>('aliases');
  const names = new Set<string>();
  for (const a of aliases) {
    if (typeof a.etransferName === 'string' && a.etransferName.trim().toLowerCase() === lower && a.appName) {
      names.add(a.appName.trim());
    }
  }
  const roster = await rosterMembers(scope.groupId);
  for (const { member } of roster) {
    if (member.name.trim().toLowerCase() === lower) names.add(member.name.trim());
  }

  const byPerson = new Map<string, MatchCandidate>();
  for (const name of names) {
    const rosterHit = roster.find((r) => r.member.name.trim().toLowerCase() === name.toLowerCase());
    const identity = rosterHit
      ? await resolveIdentity({ memberId: rosterHit.member.id }, scope.groupId)
      : await resolveIdentity({ name }, scope.groupId);
    const key = identity.memberId ?? `name:${name.toLowerCase()}`;
    if (byPerson.has(key)) continue;
    const balance = await computeOwed(scope, identity);
    byPerson.set(key, {
      memberId: identity.memberId,
      name: rosterHit?.member.name ?? name,
      lines: owedLines(balance, identity.memberId),
    });
  }
  return [...byPerson.values()];
}

const toAllocation = (l: OwedLine): PaymentAllocation => ({ kind: l.kind, ref: l.ref, pk: l.pk, amountCents: l.amountCents });

/**
 * Mark each allocated line paid. Returns the allocations that actually landed;
 * a row already paid, covered or gone is skipped (see the header).
 */
export async function applyAllocations(
  scope: GroupScope,
  allocations: PaymentAllocation[],
  paymentId: string,
): Promise<PaymentAllocation[]> {
  const now = new Date().toISOString();
  const landed: PaymentAllocation[] = [];
  for (const a of allocations) {
    if (a.kind === 'session') {
      const row = await scope.read<Player & Record<string, unknown>>('players', a.ref, a.pk);
      if (!row || row.paid === true || row.writtenOff === true) continue;
      const ok = await scope.replace('players', { ...row, paid: true, paidAt: now, paidVia: 'etransfer', paymentId }, a.pk);
      if (ok) landed.push(a);
    } else {
      const job = await scope.read<StringingJob>('stringingJobs', a.ref, a.pk);
      if (!job || job.paidAt !== null) continue;
      const ok = await scope.replace('stringingJobs', { ...job, paidAt: now, updatedAt: now }, a.pk);
      if (ok) landed.push(a);
    }
  }
  return landed;
}

export interface IngestResult {
  id: string;
  status: EtransferPayment['status'];
  duplicate: boolean;
}

export async function ingestEmail(groupId: string, raw: RawInteracEmail): Promise<IngestResult> {
  await ensurePayments();
  const scope = groupScope(groupId);
  const id = `etx:${sha256(raw.messageId)}`;

  const existing = await scope.read<EtransferPayment>('payments', id);
  if (existing) return { id, status: existing.status, duplicate: true };

  const parsed = parseInteracEmail(raw);
  const candidates = parsed.kind === 'received' ? await candidatesFor(scope, parsed.senderName) : [];
  const decision = decideMatch({
    recognized: parsed.kind === 'received',
    authenticated: parsed.authenticated,
    amountCents: parsed.amountCents,
    candidates,
  });

  const now = new Date().toISOString();
  const doc: EtransferPayment = {
    id,
    source: 'etransfer',
    senderName: parsed.senderName,
    amountCents: parsed.amountCents,
    memo: parsed.memo,
    subject: String(raw.subject ?? '').slice(0, 200),
    receivedAt: Number.isFinite(Date.parse(raw.date)) ? new Date(raw.date).toISOString() : now,
    authenticated: parsed.authenticated,
    status: 'review',
    allocations: [],
    createdAt: now,
  };

  if (decision.status === 'matched') {
    // Written as REVIEW first, so a crash between marking rows and recording
    // the payment leaves a visible queue item rather than paid rows nobody
    // can trace back to an email.
    await scope.create('payments', { ...doc, reason: 'applying' });
    const landed = await applyAllocations(scope, decision.allocations.map(toAllocation), id);
    const fullyLanded = landed.length === decision.allocations.length;
    await scope.upsert<EtransferPayment>('payments', {
      ...doc,
      status: fullyLanded ? 'matched' : 'review',
      reason: fullyLanded ? undefined : 'changed_while_matching',
      memberId: decision.candidate.memberId,
      payerName: decision.candidate.name,
      allocations: landed,
      matchedBy: fullyLanded ? 'auto' : undefined,
      resolvedAt: fullyLanded ? now : undefined,
    });
    await touchLastReceived(groupId, now);
    await releaseHoldIfSettled(scope, decision.candidate.memberId);
    return { id, status: fullyLanded ? 'matched' : 'review', duplicate: false };
  }

  await scope.create('payments', {
    ...doc,
    reason: decision.reason,
    suggestions: decision.candidates.map((c) => ({
      memberId: c.memberId,
      name: c.name,
      owedCents: c.lines.reduce((s, l) => s + l.amountCents, 0),
      proposed: (parsed.amountCents !== null ? allocateAmount(c.lines, parsed.amountCents) ?? [] : []).map(toAllocation),
    })),
  });
  await touchLastReceived(groupId, now);
  return { id, status: 'review', duplicate: false };
}

async function touchLastReceived(groupId: string, at: string): Promise<void> {
  try {
    const doc = await readPaymentsSettings(groupId);
    if (doc) await groupScope(groupId).replace<PaymentsSettingsDoc>('clubSettings', { ...doc, lastReceivedAt: at });
  } catch (err) {
    // Freshness is a convenience for the setup card; never fail an ingest on it.
    console.error('payments: lastReceivedAt not updated', err);
  }
}

export class AssignError extends Error {
  constructor(readonly code: 'not_found' | 'already_resolved' | 'not_owed' | 'unknown_person') {
    super(code);
  }
}

/**
 * The admin resolves a queued payment: for `person`, paying `refs` (lines they
 * owe) — or, with no refs, the clean allocation if there is one. `remember`
 * writes the sender's name as an alias so the next one matches on its own.
 * `ignore` files it away without marking anything (a refund, a gift, a dupe).
 */
export async function resolvePayment(
  groupId: string,
  paymentId: string,
  action:
    | { kind: 'ignore'; adminId: string }
    | { kind: 'assign'; adminId: string; memberId?: string; name?: string; refs?: string[]; remember?: boolean },
): Promise<EtransferPayment> {
  await ensurePayments();
  const scope = groupScope(groupId);
  const payment = await scope.read<EtransferPayment>('payments', paymentId);
  if (!payment) throw new AssignError('not_found');
  if (payment.status !== 'review') throw new AssignError('already_resolved');
  const now = new Date().toISOString();

  if (action.kind === 'ignore') {
    const next = { ...payment, status: 'ignored' as const, matchedBy: action.adminId, resolvedAt: now };
    return (await scope.replace('payments', next)) ?? next;
  }

  if (!action.memberId && !action.name) throw new AssignError('unknown_person');
  const identity = await resolveIdentity(action.memberId ? { memberId: action.memberId } : { name: action.name }, groupId);
  if (action.memberId && !identity.memberId) throw new AssignError('unknown_person');
  const lines = owedLines(await computeOwed(scope, identity), identity.memberId);

  let chosen: OwedLine[];
  if (action.refs && action.refs.length > 0) {
    const wanted = new Set(action.refs);
    chosen = lines.filter((l) => wanted.has(l.ref));
    if (chosen.length !== wanted.size) throw new AssignError('not_owed');
  } else {
    chosen = payment.amountCents !== null ? allocateAmount(lines, payment.amountCents) ?? [] : [];
    if (chosen.length === 0) throw new AssignError('not_owed');
  }

  const landed = await applyAllocations(scope, chosen.map(toAllocation), payment.id);
  const payerName = identity.member?.name ?? action.name ?? '';

  if (action.remember && payment.senderName && payerName) {
    const known = (await scope.query<Alias>('aliases')).some(
      (a) =>
        a.etransferName?.trim().toLowerCase() === payment.senderName!.trim().toLowerCase() &&
        a.appName?.trim().toLowerCase() === payerName.trim().toLowerCase(),
    );
    if (!known && payment.senderName.trim().toLowerCase() !== payerName.trim().toLowerCase()) {
      await scope.create<Alias>('aliases', {
        id: randomBytes(12).toString('hex'),
        appName: payerName.slice(0, 50),
        etransferName: payment.senderName.slice(0, 50),
      });
    }
  }

  await releaseHoldIfSettled(scope, identity.memberId);

  const next: EtransferPayment = {
    ...payment,
    status: 'matched',
    reason: undefined,
    memberId: identity.memberId,
    payerName,
    allocations: landed,
    matchedBy: action.adminId,
    resolvedAt: now,
  };
  return (await scope.replace('payments', next)) ?? next;
}

/** The queue, the recent history, and whether the script is alive. */
export async function inboxSummary(groupId: string) {
  await ensurePayments();
  const scope = groupScope(groupId);
  const rows = await scope.query<EtransferPayment>('payments', { orderBy: 'c.receivedAt DESC', limit: 200 });
  const sorted = [...rows].sort((a, b) => (a.receivedAt < b.receivedAt ? 1 : -1));
  const settings = await readPaymentsSettings(groupId);
  // The kill criterion's readout (docs/plans/payments.md): of what arrived in
  // the last 28 days, how much matched with nobody touching it. Counted from
  // the same bounded read, so a club past 200 payments a month reads a floor.
  const since = Date.now() - 28 * 24 * 60 * 60 * 1000;
  const window = sorted.filter((p) => Date.parse(p.receivedAt) >= since);
  const threshold = settings?.holdAfterUnpaid ?? DEFAULT_HOLD_AFTER_UNPAID;
  return {
    configured: !!settings?.keyHash,
    keyCreatedAt: settings?.keyCreatedAt ?? null,
    lastReceivedAt: settings?.lastReceivedAt ?? null,
    review: sorted.filter((p) => p.status === 'review'),
    recent: sorted.filter((p) => p.status !== 'review').slice(0, 20),
    last28Days: {
      received: window.length,
      autoMatched: window.filter((p) => p.status === 'matched' && p.matchedBy === 'auto').length,
      adminMatched: window.filter((p) => p.status === 'matched' && p.matchedBy !== 'auto').length,
      ignored: window.filter((p) => p.status === 'ignored').length,
      waiting: window.filter((p) => p.status === 'review').length,
    },
    hold: {
      threshold,
      suggested: SUGGESTED_HOLD_AFTER_UNPAID,
      // Who it holds now, or — while off — who it WOULD hold if switched on.
      names: await wouldHold(groupId, threshold > 0 ? threshold : SUGGESTED_HOLD_AFTER_UNPAID),
    },
  };
}

/**
 * THE SOFT HOLD (docs/plans/payments.md): a member who owes for
 * `holdAfterUnpaid` (default 2) past sessions signs up onto the waitlist, with
 * `heldForUnpaid` saying why, until they settle. No fee — friends paying
 * friends. Stringing is not counted: the hold is about sessions.
 *
 * FAILS OPEN. A read error here lets the sign-up through as normal: a soft
 * money rule is not worth refusing someone their game over an outage.
 */
export async function signupHeldForUnpaid(scope: GroupScope, memberId: string): Promise<boolean> {
  try {
    const settings = await readPaymentsSettings(scope.groupId);
    const threshold = settings?.holdAfterUnpaid ?? DEFAULT_HOLD_AFTER_UNPAID;
    if (!(threshold > 0)) return false;
    return (await holdCount(scope, memberId)) >= threshold;
  } catch (err) {
    console.error('payments: hold check failed, letting the sign-up through', err);
    return false;
  }
}

/**
 * The sessions a hold counts: SETTLED (a frozen bill, not a live estimate of a
 * session nobody has finalized) and NOT self-reported. Someone who tapped
 * "I've sent it" gets the benefit of the doubt until the money is matched —
 * otherwise a slow match would hold exactly the people who paid.
 */
export async function holdCount(scope: GroupScope, memberId: string): Promise<number> {
  const identity = await resolveIdentity({ memberId }, scope.groupId);
  const { sessions } = await computeOwed(scope, identity);
  return sessions.filter((s) => s.settled && !s.selfReported).length;
}

/** Who a threshold WOULD hold today — shown before the admin switches it on. */
export async function wouldHold(groupId: string, threshold: number): Promise<string[]> {
  const scope = groupScope(groupId);
  const roster = await rosterMembers(groupId);
  const out: string[] = [];
  for (const { member } of roster) {
    if ((await holdCount(scope, member.id)) >= threshold) out.push(member.name);
  }
  return out;
}

export async function setHoldThreshold(groupId: string, holdAfterUnpaid: number): Promise<void> {
  await ensurePayments();
  const existing = await readPaymentsSettings(groupId);
  await groupScope(groupId).upsert<PaymentsSettingsDoc>('clubSettings', {
    ...(existing ?? { id: paymentsSettingsId(groupId) }),
    holdAfterUnpaid,
  });
}

/**
 * After a payment lands: if this member's active-session row is held and they
 * no longer owe enough to be held, take them off the waitlist — when there is
 * room. Full session: the hold reason is cleared and they stay on an ordinary
 * waitlist like anyone else who arrived after it filled.
 */
export async function releaseHoldIfSettled(scope: GroupScope, memberId: string | null): Promise<void> {
  if (!memberId) return;
  try {
    const sessionId = await getActiveSessionId(scope.groupId);
    if (!sessionId) return;
    const rows = await scope.query<Player & Record<string, unknown>>('players', {
      where: 'c.sessionId = @sessionId AND c.memberId = @memberId',
      params: [
        { name: '@sessionId', value: sessionId },
        { name: '@memberId', value: memberId },
      ],
    });
    const held = rows.find((r) => r.sessionId === sessionId && r.memberId === memberId && r.heldForUnpaid === true && r.removed !== true);
    if (!held) return;
    if (await signupHeldForUnpaid(scope, memberId)) return;
    const session = await scope.read<{ id: string; maxPlayers?: number }>('sessions', sessionId, sessionId);
    const active = await scope.query<Player>('players', {
      where: 'c.sessionId = @sessionId',
      params: [{ name: '@sessionId', value: sessionId }],
    });
    const inSession = active.filter((p) => p.sessionId === sessionId && !p.removed);
    const activeCount = inSession.filter((p) => !p.waitlisted).length;
    // Never past someone who was waiting first: an ordinary waitlister who
    // signed up before this person keeps their claim on the next spot.
    const aheadOnList = inSession.filter(
      (p) => p.waitlisted && p.id !== held.id && p.heldForUnpaid !== true && p.timestamp < held.timestamp,
    ).length;
    const room = activeCount + aheadOnList < (session?.maxPlayers ?? defaultMaxPlayers());
    await scope.replace('players', { ...held, heldForUnpaid: false, waitlisted: room ? false : true }, sessionId);
  } catch (err) {
    console.error('payments: releasing the hold failed', err);
  }
}
