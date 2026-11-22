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
import { computeOwed, settledLines, type OwedLine } from './owedBalance';
import { resolveIdentity } from './playerIdentity';
import type { LedgerAccount, LedgerEntry, Player, StringingJob } from './types';
import { mirrorPaid, mirrorStringingChanged } from './ledgerMirror';
import { sourceRecord, type CreditUse } from './creditAttribution';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
export const MAX_GRANT_CENTS = 50_000;
/**
 * A spend with no row update this long after it was written belongs to an
 * attempt that died. A live request writes both within a second; two minutes
 * keeps a slow request from being "rescued" out from under itself.
 */
export const UNFINISHED_SPEND_MS = 2 * 60 * 1000;

export function ensureLedger(): Promise<void> {
  return Promise.all([ensureContainer('ledger', '/memberId'), ensureClubSettings()]).then(() => undefined);
}

const isConflict = (err: unknown) => (err as { code?: number })?.code === 409;

/** A member's entries in this club, newest first. */
export async function ledgerFor(scope: GroupScope, memberId: string): Promise<LedgerEntry[]> {
  await ensureLedger();
  const rows = await scope.query<LedgerEntry>('ledger', {
    where: 'c.memberId = @memberId',
    params: [{ name: '@memberId', value: memberId }],
    partitionKey: memberId,
  });
  return rows.filter((e) => e.memberId === memberId).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

/**
 * The account an entry belongs to. Entries from before Phase 2 carry none,
 * and every one of those is store credit.
 */
export const accountOf = (e: Pick<LedgerEntry, 'account'>): LedgerAccount => e.account ?? 'member_credit';

/**
 * The member's CREDIT history only — what the admin's credit card and the
 * member's own credit screen list. `ledgerFor` is the whole partition, and
 * since the Phase 2 mirror that partition also holds their charges, payments,
 * covers and voids (`member_owed`); listing those as "recent credit" would
 * scroll every real grant and spend out of view (review of #562).
 */
export async function creditLedgerFor(scope: GroupScope, memberId: string): Promise<LedgerEntry[]> {
  return (await ledgerFor(scope, memberId)).filter((e) => accountOf(e) === 'member_credit');
}

/** Σ over ONE account. Never sum a partition: it holds owed and credit both. */
export const sumAccount = (entries: readonly Pick<LedgerEntry, 'amountCents' | 'account'>[], account: LedgerAccount) =>
  entries.reduce((sum, e) => (accountOf(e) === account ? sum + e.amountCents : sum), 0);

/** The member's spendable credit. */
export const balanceOf = (entries: readonly Pick<LedgerEntry, 'amountCents' | 'account'>[]) =>
  sumAccount(entries, 'member_credit');

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
    account: 'member_credit',
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
  /** The member who minted it — an admin, or a member with `canGift`. */
  createdBy: string;
  redeemedAt?: string;
  /** The member it became credit for. Written at redemption since
   *  2026-10-09 (docs/plans/gift-card-ledger.md); an older card's redeemer is
   *  found from its `gift:<hash>` ledger entry by `giftCardRecords`. Additive. */
  redeemedBy?: string;
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
      account: 'member_credit',
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
  await scope.replace<GiftCardDoc>('clubSettings', { ...card, redeemedAt: at, redeemedBy: memberId });
  return entry;
}

/** The hash a card's doc id carries, so its ledger entry (`gift:<hash>`) can be named. */
export function giftHashOf(card: Pick<GiftCardDoc, 'id'>): string {
  return card.id.slice(card.id.lastIndexOf('giftcard:') + 'giftcard:'.length);
}

export interface GiftCardRecord extends GiftCardDoc {
  /** How much of THIS card has been drawn, by the oldest-source-first reading
   *  of the redeemer's credit (`lib/creditAttribution.ts`); null until
   *  redeemed, and null again when the redeemer's history no longer holds it
   *  (an account deleted since). */
  usedCents: number | null;
  remainingCents: number | null;
  uses: CreditUse[];
}

/**
 * The club's cards with each one's record: who redeemed it, and how much of
 * it has gone where. One ledger read per redeemer, not per card.
 */
export async function giftCardRecords(groupId: string): Promise<GiftCardRecord[]> {
  const cards = await listGiftCards(groupId);
  const scope = groupScope(groupId);
  // Older cards carry no `redeemedBy`: their ledger entry does.
  const resolved = await Promise.all(cards.map(async (card) => {
    if (!card.redeemedAt || card.redeemedBy) return card;
    const rows = await scope.query<LedgerEntry>('ledger', { where: 'c.id = @id', params: [{ name: '@id', value: `gift:${giftHashOf(card)}` }] });
    const entry = rows.find((r) => r.id === `gift:${giftHashOf(card)}`);
    return entry ? { ...card, redeemedBy: entry.memberId } : card;
  }));
  const histories = new Map<string, Promise<LedgerEntry[]>>();
  const historyOf = (memberId: string) => {
    let p = histories.get(memberId);
    if (!p) { p = creditLedgerFor(scope, memberId); histories.set(memberId, p); }
    return p;
  };
  return Promise.all(resolved.map(async (card): Promise<GiftCardRecord> => {
    if (!card.redeemedBy) return { ...card, usedCents: null, remainingCents: null, uses: [] };
    const source = sourceRecord(await historyOf(card.redeemedBy), `gift:${giftHashOf(card)}`);
    return source
      ? { ...card, usedCents: source.usedCents, remainingCents: source.remainingCents, uses: source.uses }
      : { ...card, usedCents: null, remainingCents: null, uses: [] };
  }));
}

// ── Spending ───────────────────────────────────────────────────────────────

/** The row a spend is about: enough to read it, mark it, and refund it. */
type SpendLine = Pick<OwedLine, 'kind' | 'ref' | 'pk' | 'amountCents'>;

/** `refund:<ref>:<n>`; a 409 means another request already returned it. */
async function writeRefund(scope: GroupScope, memberId: string, line: SpendLine, n: number, note: string): Promise<void> {
  try {
    await scope.create<LedgerEntry>('ledger', {
      id: `refund:${line.ref}:${n}`,
      memberId,
      account: 'member_credit',
      kind: 'credit_refund',
      amountCents: line.amountCents,
      note,
      ref: { kind: line.kind, id: line.ref, pk: line.pk },
      // Its own clock, not the request's `now`: a refund dated the same ms
      // as its spend reads in the history as if it came first. The
      // attribution tie-breaks by kind as well, because two writes can
      // still land in one ms.
      createdAt: new Date().toISOString(),
      createdBy: memberId,
    });
  } catch (err) {
    if (!isConflict(err)) throw err; // already refunded — another request got there
  }
}

/** One credit spend as the ledger holds it, sized to what is put against the row. */
type Spend = { id: string; n: number; amountCents: number; at: string };

/** `n` of a `spend:<ref>:<n>` / `refund:<ref>:<n>` id, or -1. */
const idNumber = (id: string, prefix: string, ref: string): number => {
  const head = `${prefix}:${ref}:`;
  if (!id.startsWith(head)) return -1;
  const n = Number(id.slice(head.length));
  return Number.isInteger(n) && n >= 0 ? n : -1;
};

/**
 * Put ONE credit spend onto its row (docs/plans/partial-credit.md), stamping
 * `paidAt` with the SPEND's time (the moment the credit was taken).
 *
 *   'paid'    — by this call, and the row is now paid in full.
 *   'part'    — by this call, and the row still owes the rest (a session
 *               row only: `paidAmount`, "paid $10 of $15").
 *   'credit'  — this spend had already landed: the row lists it in
 *               `creditSpends`, or (a row from before that field) it is paid
 *               with `paidVia: 'credit'`; a stringing job carries no list,
 *               so it is credit's when its `paidAt` IS the spend's time.
 *   'already' — paid some other way, or the spend no longer fits what the
 *               row owes (a bill lowered since): the credit must go back.
 *   'gone'    — covered, deleted, or removed before any bill froze on it:
 *               the credit must go back too.
 */
async function applyCreditToRow(
  scope: GroupScope,
  line: SpendLine,
  spend: Spend,
  now: string,
): Promise<'paid' | 'part' | 'credit' | 'already' | 'gone'> {
  if (line.kind === 'session') {
    const row = await scope.read<Player & Record<string, unknown>>('players', line.ref, line.pk);
    // A row removed AFTER its bill froze still owes it (Home shows it, and
    // "Remove without covering" means exactly that), so credit may pay it;
    // only a removal with no frozen bill on the row is "gone" (audit, 2026-11-05).
    if (!row || row.writtenOff === true || (row.removed === true && typeof row.settledAt !== 'string')) return 'gone';
    const landed = Array.isArray(row.creditSpends) ? (row.creditSpends as string[]) : null;
    if (landed?.includes(spend.id)) return 'credit';
    if (row.paid === true) return row.paidVia === 'credit' && landed === null ? 'credit' : 'already';
    const owedCents = Math.round(Number(row.owedAmount ?? 0) * 100);
    const receivedCents = Math.round(Number(row.paidAmount ?? 0) * 100);
    const remaining = owedCents - receivedCents;
    // Never more than the line still owes: more would be a guess.
    if (spend.amountCents <= 0 || spend.amountCents > remaining) return 'already';
    const full = spend.amountCents === remaining;
    const written = await scope.replace(
      'players',
      {
        ...row,
        paid: full,
        paidAt: spend.at,
        paidVia: 'credit',
        paidAmount: (receivedCents + spend.amountCents) / 100,
        creditSpends: [...(landed ?? []), spend.id],
      },
      line.pk,
    );
    if (!written) {
      // Changed under us: if another request landed THIS spend, it is done;
      // anything else and the credit goes back.
      const fresh = await scope.read<Player & Record<string, unknown>>('players', line.ref, line.pk);
      return Array.isArray(fresh?.creditSpends) && (fresh.creditSpends as string[]).includes(spend.id) ? 'credit' : 'gone';
    }
    // The owed side; the credit side is the spend entry.
    await mirrorPaid(scope, written as unknown as Player, spend.amountCents);
    return full ? 'paid' : 'part';
  }
  const job = await scope.read<StringingJob>('stringingJobs', line.ref, line.pk);
  if (!job) return 'gone';
  if (job.paidAt !== null) return job.paidVia === 'credit' || job.paidAt === spend.at ? 'credit' : 'already';
  const written = await scope.replace('stringingJobs', { ...job, paidAt: spend.at, paidVia: 'credit' as const, updatedAt: now }, line.pk);
  if (!written) {
    const fresh = await scope.read<StringingJob>('stringingJobs', line.ref, line.pk);
    return fresh?.paidAt === spend.at ? 'credit' : 'gone';
  }
  await mirrorStringingChanged(scope, job, written, 'credit');
  return 'paid';
}

/** A line's credit, read from the ledger: its spends and what of them is shown landed. */
function creditPicture(entries: readonly LedgerEntry[], refId: string, voided: ReadonlySet<string>) {
  const forLine = entries.filter(
    (e) => e.ref?.id === refId && accountOf(e) === 'member_credit' && (e.kind === 'credit_spend' || e.kind === 'credit_refund'),
  );
  const spends = forLine
    .filter((e) => e.kind === 'credit_spend')
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
  const refundedN = new Set(forLine.filter((e) => e.kind === 'credit_refund').map((e) => idNumber(e.id, 'refund', refId)));
  // The mirror's owed-side payment for a credit spend carries the spend's time.
  const mirrored = entries.filter((e) => e.kind === 'payment' && e.ref?.id === refId && e.meta?.via === 'credit' && !voided.has(e.id));
  const mirroredAt = new Set(mirrored.map((e) => e.createdAt));
  return {
    spends,
    refundedN,
    mirroredAt,
    /** Credit taken for the line and not returned. */
    takenCents: -forLine.reduce((sum, e) => sum + e.amountCents, 0),
    /** Of that, what the mirror shows landed. */
    mirroredCents: -mirrored.reduce((sum, e) => sum + e.amountCents, 0),
    /** A spend younger than UNFINISHED_SPEND_MS that nothing shows landed or returned: a request is mid-way through it. */
    inFlight: (nowMs: number) =>
      spends.some(
        (s) => nowMs - Date.parse(s.createdAt) < UNFINISHED_SPEND_MS && !mirroredAt.has(s.createdAt) && !refundedN.has(idNumber(s.id, 'spend', refId)),
      ),
  };
}

/**
 * Reconcile every STALE spend in this member's credit against its ROW —
 * whatever happened to the row since.
 *
 * A spend is written BEFORE its row records it, so a process that dies
 * between the two leaves credit taken for a line that still owes it. Finding
 * those by walking the member's OWED lines (what `payWithCredit` once did)
 * missed the worst case: a row since paid another way is no longer owed, so
 * it was never visited and its credit stayed taken forever. This walks the
 * LEDGER instead, line by line, and since a line may now hold several credit
 * payments (docs/plans/partial-credit.md), SPEND by spend:
 *
 *   - FRESH (the line's newest spend is younger than `UNFINISHED_SPEND_MS`):
 *     another request is paying it right now — left alone.
 *   - COMPLETED (the common case): the mirror's live credit payments on the
 *     line add up to the credit taken for it — answered with NO row read.
 *     Reading the row for each past credit payment on every balance read
 *     would have grown with the member's history forever.
 *   - Otherwise each spend nothing shows landed or returned is offered to its
 *     row (`applyCreditToRow`): it lands, it had landed (the row lists it), or
 *     it is refunded (`refund:<ref>:<n>`, the spend's own n). Never more than
 *     the credit taken and not shown landed: that is the BUDGET, so a missing
 *     pairing can only leave credit for a person to see, never move extra.
 *
 * Called at the top of every "Pay with credit" and, best-effort, from the
 * member's own balance read. The admin reconcile does NOT call it: that
 * stays no-auto-repair.
 */
export async function refundStaleSpends(
  scope: GroupScope,
  memberId: string,
  ledger?: LedgerEntry[],
): Promise<{ finished: number; refunded: number; ledger: LedgerEntry[] }> {
  let entries = ledger ?? (await ledgerFor(scope, memberId));
  const refs = new Map<string, { kind: SpendLine['kind']; pk: string }>();
  for (const e of entries) {
    // Credit spends only: the mirror writes a line's charge and payment under
    // member_owed in the same partition, and they are not spends.
    if (accountOf(e) !== 'member_credit' || e.kind !== 'credit_spend') continue;
    if (!e.ref || (e.ref.kind !== 'session' && e.ref.kind !== 'stringing')) continue;
    refs.set(e.ref.id, { kind: e.ref.kind, pk: e.ref.pk });
  }
  const voided = new Set(entries.filter((e) => e.kind === 'void').map((e) => e.id.slice('void:'.length)));
  let finished = 0;
  let refunded = 0;
  const now = new Date().toISOString();
  const nowMs = Date.now();
  for (const [refId, where] of refs) {
    const pic = creditPicture(entries, refId, voided);
    if (pic.takenCents <= 0) continue;
    const newest = pic.spends[pic.spends.length - 1];
    if (!newest || nowMs - Date.parse(newest.createdAt) < UNFINISHED_SPEND_MS) continue;
    let budget = pic.takenCents - pic.mirroredCents;
    if (budget <= 0) continue;
    // Newest first: a crash leaves the newest spend unfinished, and an older
    // spend whose payment a return-the-credit voided is not the one missing.
    for (const s of [...pic.spends].reverse()) {
      if (budget <= 0) break;
      const n = idNumber(s.id, 'spend', refId);
      if (n < 0 || pic.mirroredAt.has(s.createdAt) || pic.refundedN.has(n)) continue;
      // Refund or finish what was TAKEN (never above the budget), not what
      // the row says now: an owedAmount edited since is the row's business.
      const amountCents = Math.min(-s.amountCents, budget);
      if (amountCents <= 0) continue;
      const line: SpendLine = { kind: where.kind, ref: refId, pk: where.pk, amountCents };
      const outcome = await applyCreditToRow(scope, line, { id: s.id, n, amountCents, at: s.createdAt }, now);
      budget -= amountCents;
      if (outcome === 'credit') continue;
      if (outcome === 'paid' || outcome === 'part') {
        finished += 1;
      } else {
        await writeRefund(scope, memberId, line, n, 'Paid another way — credit returned');
        refunded += 1;
      }
    }
  }
  if (finished + refunded > 0) entries = await ledgerFor(scope, memberId);
  return { finished, refunded, ledger: entries };
}

/**
 * Pay this member's owed lines from their credit (docs/plans/partial-credit.md):
 *
 *   1. every FROZEN line the credit covers in full, oldest first;
 *   2. then whatever is left onto the oldest frozen SESSION line still owing,
 *      as a part-payment ("paid $10 of $15"). A stringing job is paid whole
 *      or not at all: a job has no amount received of its own.
 *
 * PER-SPEND ACCOUNTING, so every failure is recoverable:
 *   - A line's spends are numbered: `spend:<ref>:<n>`, where n is how many
 *     spends that line has ever had. A double tap computes the same n and
 *     collides on insert; a line paid in parts gets n+1 for each part.
 *   - `refundStaleSpends` runs FIRST and settles every spend a crash left
 *     half-done. A line with a FRESH spend nothing shows landed is being paid
 *     by another request right now, and is left to it.
 *   - Any failure to record the spend on its row writes `refund:<ref>:<n>`
 *     before giving up, so credit is never taken for a line that stays owed.
 *   - Two requests at once could each pay a different line from the same
 *     starting balance: the balance is re-read after each insert, and a spend
 *     that took it below zero refunds itself.
 */
export async function payWithCredit(
  groupId: string,
  memberId: string,
): Promise<{ paid: number; part: number; spentCents: number; balanceCents: number }> {
  const scope = groupScope(groupId);
  const stale = await refundStaleSpends(scope, memberId);
  let ledger = stale.ledger;
  const identity = await resolveIdentity({ memberId }, groupId);
  // Frozen lines only (`settledLines`): credit spent on a live estimate is
  // credit spent on a number that can still move. Each line's amount is what
  // it still owes, a part already received taken off.
  const lines = settledLines(await computeOwed(scope, identity), identity.memberId);
  if (lines.length === 0 && stale.finished === 0) throw new CreditError('nothing_to_pay');

  const voided = new Set(ledger.filter((e) => e.kind === 'void').map((e) => e.id.slice('void:'.length)));
  const nowMs = Date.now();
  const open = lines.filter((l) => l.amountCents > 0 && !creditPicture(ledger, l.ref, voided).inFlight(nowMs));

  // The plan: whole lines first, then one part with what is left.
  let left = balanceOf(ledger);
  const plan: { line: (typeof lines)[number]; amountCents: number }[] = [];
  for (const line of open) {
    if (line.amountCents > left) continue;
    plan.push({ line, amountCents: line.amountCents });
    left -= line.amountCents;
  }
  if (left > 0) {
    const partLine = open.find((l) => l.kind === 'session' && !plan.some((p) => p.line === l));
    if (partLine) plan.push({ line: partLine, amountCents: left });
  }

  let paid = stale.finished;
  let part = 0;
  let spent = 0;
  const now = new Date().toISOString();
  const refund = (line: SpendLine, n: number, note: string) => writeRefund(scope, memberId, line, n, note);

  for (const { line, amountCents } of plan) {
    const n = ledger.filter((e) => e.ref?.id === line.ref && accountOf(e) === 'member_credit' && e.kind === 'credit_spend').length;
    const id = `spend:${line.ref}:${n}`;
    const spendLine: SpendLine = { kind: line.kind, ref: line.ref, pk: line.pk, amountCents };
    try {
      await scope.create<LedgerEntry>('ledger', {
        id,
        memberId,
        account: 'member_credit',
        kind: 'credit_spend',
        amountCents: -amountCents,
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
      await refund(spendLine, n, 'Not enough credit — returned');
      ledger = await ledgerFor(scope, memberId);
      continue;
    }

    let outcome: Awaited<ReturnType<typeof applyCreditToRow>>;
    try {
      outcome = await applyCreditToRow(scope, spendLine, { id, n, amountCents, at: now }, now);
    } catch (err) {
      await refund(spendLine, n, 'Could not mark it paid — returned');
      throw err;
    }
    // 'credit': this very spend is already on the row (a retry that raced
    // itself). It landed; nothing goes back.
    if (outcome === 'credit') {
      spent += amountCents;
      continue;
    }
    if (outcome !== 'paid' && outcome !== 'part') {
      await refund(spendLine, n, 'Already settled — credit returned');
      ledger = await ledgerFor(scope, memberId);
      continue;
    }
    spent += amountCents;
    if (outcome === 'paid') paid += 1;
    else part += 1;
  }
  if (paid === 0 && part === 0) throw new CreditError('nothing_to_pay');
  return { paid, part, spentCents: spent, balanceCents: balanceOf(await ledgerFor(scope, memberId)) };
}
