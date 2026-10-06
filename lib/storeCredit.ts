/**
 * STORE CREDIT AND GIFT CARDS — the first slice of the Phase 2 ledger
 * (docs/plans/payments.md). Nothing here is throwaway: credit lives as
 * append-only `ledger` entries, which is the shape the full ledger needs;
 * sessions and payments join later as more entry kinds on the same rails.
 *
 *   grant   — an admin gives a member credit (or takes it back: negative).
 *   gift    — an admin mints a single-use code worth $X; any member of the
 *             club redeems it into their own credit.
 *   spend   — a member pays owed lines from their credit, oldest first, only
 *             lines the credit covers IN FULL (Grant's call: partial use waits
 *             for the full ledger, so no screen has to learn "half paid").
 *
 * IDEMPOTENCE IS IN THE IDS — within the right partition. A gift card is
 * claimed by a `clubSettings` doc whose id is the card (PK `/id`: unique
 * outright, so two different members cannot both claim it); a spend is
 * `spend:<lineRef>` in the member's own ledger partition (only that member
 * spends from it, so a double tap collides). Both are CREATED, never
 * upserted. A spend also re-reads the balance after inserting and refunds
 * itself if a concurrent spend took the balance below zero.
 */
import { createHash, randomBytes } from 'crypto';
import { ensureContainer } from './cosmos';
import { groupDocId, groupScope, type GroupScope } from './groupScope';
import { ensureClubSettings } from './stringingShop';
import { computeOwed, owedLines } from './owedBalance';
import { resolveIdentity } from './playerIdentity';
import type { LedgerEntry, Player, StringingJob } from './types';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
export const MAX_GRANT_CENTS = 50_000;
/**
 * A spend with no row update this long after it was written belongs to an
 * attempt that died. A live request writes both within a second; two minutes
 * keeps a slow request from being "rescued" out from under itself.
 */
export const UNFINISHED_SPEND_MS = 2 * 60 * 1000;

let ready: Promise<void> | null = null;
export function ensureLedger(): Promise<void> {
  if (!ready) {
    ready = Promise.all([ensureContainer('ledger', '/memberId'), ensureClubSettings()])
      .then(() => undefined)
      .catch((err) => {
        ready = null;
        throw err;
      });
  }
  return ready;
}

const isConflict = (err: unknown) => (err as { code?: number })?.code === 409;

/** A member's entries in this club, newest first. */
export async function ledgerFor(scope: GroupScope, memberId: string): Promise<LedgerEntry[]> {
  await ensureLedger();
  const rows = await scope.query<LedgerEntry>('ledger', {
    where: 'c.memberId = @memberId',
    params: [{ name: '@memberId', value: memberId }],
  });
  return rows.filter((e) => e.memberId === memberId).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export const balanceOf = (entries: readonly Pick<LedgerEntry, 'amountCents'>[]) =>
  entries.reduce((sum, e) => sum + e.amountCents, 0);

export class CreditError extends Error {
  constructor(readonly code: 'invalid_amount' | 'would_go_negative' | 'gift_not_found' | 'nothing_to_pay') {
    super(code);
  }
}

/** An admin gives (positive) or takes back (negative) credit. Never below zero. */
export async function grantCredit(
  groupId: string,
  input: { memberId: string; amountCents: number; note: string; adminId: string },
): Promise<LedgerEntry> {
  const { amountCents } = input;
  if (!Number.isInteger(amountCents) || amountCents === 0 || Math.abs(amountCents) > MAX_GRANT_CENTS) {
    throw new CreditError('invalid_amount');
  }
  const scope = groupScope(groupId);
  if (amountCents < 0 && balanceOf(await ledgerFor(scope, input.memberId)) + amountCents < 0) {
    throw new CreditError('would_go_negative');
  }
  return scope.create<LedgerEntry>('ledger', {
    id: `grant:${randomBytes(12).toString('hex')}`,
    memberId: input.memberId,
    kind: 'credit_grant',
    amountCents,
    note: input.note.trim().slice(0, 80),
    createdAt: new Date().toISOString(),
    createdBy: input.adminId,
  });
}

// ── Gift cards ─────────────────────────────────────────────────────────────

/** No 0/O, 1/I/L: a code is read off a screen or a card and typed by a person. */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export function newGiftCode(): string {
  // Rejection sampling: 256 is not a multiple of 31, so `byte % 31` would make
  // the first eight letters slightly likelier. Bytes at or above the largest
  // multiple are discarded and redrawn.
  const n = CODE_ALPHABET.length;
  const limit = 256 - (256 % n);
  const chars: string[] = [];
  while (chars.length < 8) {
    for (const b of randomBytes(16)) {
      if (b < limit && chars.length < 8) chars.push(CODE_ALPHABET[b % n]);
    }
  }
  return `BPM-${chars.slice(0, 4).join('')}-${chars.slice(4).join('')}`;
}
/** Case, spaces and dashes are not part of a code — "bpm 7k2q x9fa" redeems. */
export function normalizeGiftCode(raw: string): string {
  const s = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const body = s.startsWith('BPM') ? s.slice(3) : s;
  return body.length === 8 ? `BPM-${body.slice(0, 4)}-${body.slice(4)}` : '';
}
export function giftDocId(groupId: string, code: string): string {
  return groupDocId(groupId, `giftcard:${sha256(code)}`);
}

/**
 * A gift card, in the club's `clubSettings`, keyed by the HASH of its code —
 * the plaintext exists only in the mint response (the invite-code pattern), so
 * a database read cannot hand anyone a spendable card. Who redeemed it is NOT
 * stored here: that is the ledger entry `gift:<hash>`, which account deletion
 * already removes with the rest of the member's ledger.
 */
export interface GiftCardDoc {
  id: string;
  kind: 'giftcard';
  amountCents: number;
  note: string;
  /** The last four characters, so the admin can tell their cards apart. */
  hint: string;
  createdAt: string;
  createdBy: string;
  redeemedAt?: string;
}

export async function mintGiftCard(
  groupId: string,
  input: { amountCents: number; note: string; adminId: string },
): Promise<{ code: string; card: GiftCardDoc }> {
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0 || input.amountCents > MAX_GRANT_CENTS) {
    throw new CreditError('invalid_amount');
  }
  await ensureLedger();
  const code = newGiftCode();
  const card = await groupScope(groupId).create<GiftCardDoc>('clubSettings', {
    id: giftDocId(groupId, code),
    kind: 'giftcard',
    amountCents: input.amountCents,
    note: input.note.trim().slice(0, 80),
    hint: code.slice(-4),
    createdAt: new Date().toISOString(),
    createdBy: input.adminId,
  });
  return { code, card };
}

export async function listGiftCards(groupId: string): Promise<GiftCardDoc[]> {
  await ensureLedger();
  const rows = await groupScope(groupId).query<GiftCardDoc & { kind?: string }>('clubSettings', {
    where: "c.kind = 'giftcard'",
  });
  return rows.filter((r) => r.kind === 'giftcard').sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

/**
 * Redeem a code into `memberId`'s credit. Unknown, already-used and malformed
 * all answer the same `gift_not_found` — a different answer for "used" would
 * tell a guesser they had found a real code.
 */
export async function redeemGiftCard(groupId: string, rawCode: string, memberId: string): Promise<LedgerEntry> {
  const code = normalizeGiftCode(rawCode);
  if (!code) throw new CreditError('gift_not_found');
  await ensureLedger();
  const scope = groupScope(groupId);
  const card = await scope.read<GiftCardDoc>('clubSettings', giftDocId(groupId, code));
  if (!card || card.kind !== 'giftcard' || card.redeemedAt) throw new CreditError('gift_not_found');
  const at = new Date().toISOString();
  // THE CLAIM IS ITS OWN DOCUMENT, in `clubSettings` (PK `/id`), whose id IS
  // the card. Cosmos enforces a unique id only WITHIN a partition, and the
  // ledger is partitioned by member — so a `gift:<hash>` entry alone would
  // let Lin and Viktor, redeeming at the same moment, each insert one under
  // their own partition and both be credited. A doc that is its own partition
  // is unique outright: the second claimant, whoever they are, 409s here.
  // (The mock store ignores partition keys, which is why no test could see it.)
  try {
    await scope.create('clubSettings', { id: `${card.id}:claim`, kind: 'giftclaim', claimedAt: at });
  } catch (err) {
    if (isConflict(err)) throw new CreditError('gift_not_found');
    throw err;
  }
  let entry: LedgerEntry;
  try {
    // Same-member duplicates also collide on the ledger id (belt and braces).
    entry = await scope.create<LedgerEntry>('ledger', {
      id: `gift:${sha256(code)}`,
      memberId,
      kind: 'gift_redeem',
      amountCents: card.amountCents,
      note: card.note ? `Gift card · ${card.note}` : 'Gift card',
      createdAt: at,
      createdBy: memberId,
    });
  } catch (err) {
    if (isConflict(err)) throw new CreditError('gift_not_found');
    // The claim is in and the credit is not: release the claim, or the card
    // is burned with nothing to show for it and a retry says "not found".
    await scope.remove('clubSettings', `${card.id}:claim`).catch((e) => console.error('gift: claim not released', e));
    throw err;
  }
  await scope.replace<GiftCardDoc>('clubSettings', { ...card, redeemedAt: at });
  return entry;
}

// ── Spending ───────────────────────────────────────────────────────────────

/**
 * Pay this member's owed lines from their credit: oldest first, each line
 * only if what is left covers it in full. Returns what was paid.
 *
 * PER-LINE ACCOUNTING, so every failure is recoverable:
 *   - A line's spends are numbered: `spend:<ref>:<n>`, where n is how many
 *     spends that line has ever had. A double tap computes the same n and
 *     collides on insert; a line whose earlier spend was REFUNDED gets n+1
 *     and can be paid again (a fixed `spend:<ref>` id stranded it forever).
 *   - A line whose spends outweigh its refunds already has credit taken for
 *     it. If its row is still unpaid — the process died between the two
 *     writes — the row update is FINISHED, not skipped.
 *   - Any failure to mark the row writes `refund:<ref>:<n>` before giving up,
 *     so credit is never taken for a line that stays owed.
 *   - Two requests at once could each pay a different line from the same
 *     starting balance: the balance is re-read after each insert, and a spend
 *     that took it below zero refunds itself.
 */
export async function payWithCredit(groupId: string, memberId: string): Promise<{ paid: number; spentCents: number; balanceCents: number }> {
  const scope = groupScope(groupId);
  let ledger = await ledgerFor(scope, memberId);
  const identity = await resolveIdentity({ memberId }, groupId);
  const lines = owedLines(await computeOwed(scope, identity), identity.memberId);
  if (lines.length === 0) throw new CreditError('nothing_to_pay');

  let paid = 0;
  let spent = 0;
  const now = new Date().toISOString();

  const refund = async (line: (typeof lines)[number], n: number, note: string) => {
    try {
      await scope.create<LedgerEntry>('ledger', {
        id: `refund:${line.ref}:${n}`,
        memberId,
        kind: 'credit_refund',
        amountCents: line.amountCents,
        note,
        ref: { kind: line.kind, id: line.ref, pk: line.pk },
        createdAt: now,
        createdBy: memberId,
      });
    } catch (err) {
      if (!isConflict(err)) throw err; // already refunded — another request got there
    }
  };

  /**
   * Mark the row paid. `'paid'` — by this call. `'already'` — something else
   * paid it first (an e-transfer that just landed): the credit must go back.
   * `'gone'` — removed, covered or deleted: the credit must go back too.
   */
  const markPaid = async (line: (typeof lines)[number]): Promise<'paid' | 'already' | 'gone'> => {
    if (line.kind === 'session') {
      const row = await scope.read<Player & Record<string, unknown>>('players', line.ref, line.pk);
      if (!row || row.writtenOff === true) return 'gone';
      if (row.paid === true) return 'already';
      return (await scope.replace('players', { ...row, paid: true, paidAt: now, paidVia: 'credit' }, line.pk)) ? 'paid' : 'gone';
    }
    const job = await scope.read<StringingJob>('stringingJobs', line.ref, line.pk);
    if (!job) return 'gone';
    if (job.paidAt !== null) return 'already';
    return (await scope.replace('stringingJobs', { ...job, paidAt: now, updatedAt: now }, line.pk)) ? 'paid' : 'gone';
  };

  for (const line of lines) {
    const forLine = ledger.filter((e) => e.ref?.id === line.ref);
    const spends = forLine.filter((e) => e.kind === 'credit_spend').length;
    const net = forLine.reduce((sum, e) => sum + e.amountCents, 0);

    if (net < 0) {
      // Credit already taken for this line. If that spend is FRESH, another
      // request is mid-way through paying it (a double tap) — leave it be;
      // touching it would race that request and could refund a good payment.
      // If it is STALE, the attempt died between its two writes: finish it,
      // or give the credit back if the line was settled some other way.
      const last = forLine.filter((e) => e.kind === 'credit_spend').map((e) => Date.parse(e.createdAt)).sort().pop() ?? 0;
      if (Date.now() - last < UNFINISHED_SPEND_MS) continue;
      const outcome = await markPaid(line);
      if (outcome === 'paid') paid += 1;
      else await refund(line, spends - 1, 'Already settled — credit returned');
      ledger = await ledgerFor(scope, memberId);
      continue;
    }
    if (line.amountCents <= 0 || line.amountCents > balanceOf(ledger)) continue;

    const n = spends;
    try {
      await scope.create<LedgerEntry>('ledger', {
        id: `spend:${line.ref}:${n}`,
        memberId,
        kind: 'credit_spend',
        amountCents: -line.amountCents,
        note: line.kind === 'session' ? `Session ${line.at.slice(0, 10)}` : 'Stringing',
        ref: { kind: line.kind, id: line.ref, pk: line.pk },
        createdAt: now,
        createdBy: memberId,
      });
    } catch (err) {
      if (isConflict(err)) continue; // a double tap: the other request is paying this line
      throw err;
    }

    ledger = await ledgerFor(scope, memberId);
    if (balanceOf(ledger) < 0) {
      await refund(line, n, 'Not enough credit — returned');
      ledger = await ledgerFor(scope, memberId);
      continue;
    }

    let outcome: 'paid' | 'already' | 'gone';
    try {
      outcome = await markPaid(line);
    } catch (err) {
      await refund(line, n, 'Could not mark it paid — returned');
      throw err;
    }
    if (outcome !== 'paid') {
      await refund(line, n, 'Already settled — credit returned');
      ledger = await ledgerFor(scope, memberId);
      continue;
    }
    spent += line.amountCents;
    paid += 1;
  }
  if (paid === 0) throw new CreditError('nothing_to_pay');
  return { paid, spentCents: spent, balanceCents: balanceOf(await ledgerFor(scope, memberId)) };
}
