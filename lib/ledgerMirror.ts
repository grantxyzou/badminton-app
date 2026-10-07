/**
 * THE LEDGER MIRROR — Phase 2 of docs/plans/payments.md, stage 1.
 *
 * Every money event the app already records on its own rows (a bill frozen
 * at settle, a payment landing by any route, a cover, a stringing price, a
 * shuttle purchase) ALSO writes an append-only `ledger` entry here. The rows
 * stay the truth; the ledger is a mirror a reconcile can check them against,
 * and the one place the club's whole money picture can be summed from.
 *
 * THREE RULES, each with a reason:
 *
 *   NEVER FAIL THE PRIMARY WRITE. A mirror is called after the row is saved.
 *   If the ledger write throws, the admin's tap still succeeded and must say
 *   so; the gap is logged, counted (`mirrorFailures`) and found by the
 *   reconcile. A mirror that could 500 a payment would make the mirror the
 *   truth by accident.
 *
 *   IDS ARE DERIVED, NEVER MINTED. An entry's id is the row it mirrors plus
 *   that row's OWN timestamp for the state (`charge:<row>:<ms(settledAt)>`),
 *   so a live write, a retried request, the backfill and a repair all compute
 *   the same id, and a second write 409s — which this file treats as success.
 *   A random id would make the backfill and the mirror write the same charge
 *   twice.
 *
 *   NOTHING IS EVER DELETED OR EDITED. A reversal is `void:<id>`, the exact
 *   negation, keyed on the id it reverses so a double void 409s and a
 *   void-of-void cannot be expressed. Unsettle, unpay, uncover, a price change,
 *   a deleted purchase: all voids.
 *
 * Partitions: a member's entries live under their id. The club's outlay has
 * no member and lives under `~club`; a legacy row with no memberId under
 * `~unlinked`; a purged member's charges under `~anon`. `~` can never begin a
 * real member id (24 hex from randomBytes), and purge refuses it.
 */
import { randomBytes } from 'crypto';
import { isFlagOn } from './flags';
import { ensureLedger } from './storeCredit';
import type { GroupScope } from './groupScope';
import type { BirdPurchase, LedgerEntry, Player, Session, SettledSnapshot, StringingJob } from './types';

export const CLUB_LEDGER_ID = '~club';
export const UNLINKED_LEDGER_ID = '~unlinked';
export const ANON_LEDGER_ID = '~anon';
export const isSentinelLedgerId = (id: string) => id.startsWith('~');

const SYSTEM = 'system';

/** Mirror writes that threw since the process started. Reported by the reconcile. */
let mirrorFailures = 0;
export const getMirrorFailures = () => mirrorFailures;
/** Tests only. */
export const _resetMirrorFailures = () => {
  mirrorFailures = 0;
};

const on = () => isFlagOn('NEXT_PUBLIC_FLAG_LEDGER_MIRROR');
const isConflict = (err: unknown) => (err as { code?: number })?.code === 409;
const cents = (dollars: number | undefined | null) => Math.round((dollars ?? 0) * 100);
const ms = (iso: string | undefined | null) => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? String(t) : 'legacy';
};

export type NewEntry = Omit<LedgerEntry, 'groupId' | 'createdAt' | 'createdBy'> & { createdAt?: string; createdBy?: string };

/**
 * Write one entry. `'written'`, `'existing'` (409 — already mirrored) or
 * `'failed'`. Never throws; `failed` is logged and counted. The one exported
 * writer, so the backfill and the mirror share the id rules above.
 */
export async function appendEntry(scope: GroupScope, entry: NewEntry): Promise<'written' | 'existing' | 'failed'> {
  if (entry.amountCents === 0) return 'existing'; // zero-amount entries are never written
  try {
    await ensureLedger();
    await scope.create<LedgerEntry>('ledger', {
      createdAt: new Date().toISOString(),
      createdBy: SYSTEM,
      ...entry,
    });
    return 'written';
  } catch (err) {
    if (isConflict(err)) return 'existing';
    mirrorFailures += 1;
    console.error('[ledger-mirror] write failed', { id: entry.id, kind: entry.kind });
    return 'failed';
  }
}

/** The void of an entry: same account, ref and partition, negated amount, keyed on the id it reverses. */
export function voidOf(entry: Pick<LedgerEntry, 'id' | 'memberId' | 'account' | 'kind' | 'amountCents' | 'ref'>, reason: string): NewEntry {
  return {
    id: `void:${entry.id}`,
    memberId: entry.memberId,
    account: entry.account ?? 'member_credit',
    kind: 'void',
    amountCents: -entry.amountCents,
    note: `Reversed: ${entry.kind}`,
    ref: entry.ref,
    meta: { reason },
  };
}

// ── Entry builders (pure) ──────────────────────────────────────────────────

const memberOf = (row: Pick<Player, 'memberId'>) => row.memberId ?? UNLINKED_LEDGER_ID;

/** The charge a settled row carries. `null` when it carries none (resplit-covered → 0). */
export function chargeEntry(row: Pick<Player, 'id' | 'sessionId' | 'memberId' | 'owedAmount' | 'settledAt'>, session: Pick<Session, 'datetime'>): NewEntry | null {
  const amountCents = cents(row.owedAmount);
  if (amountCents <= 0 || !row.settledAt) return null;
  return {
    id: `charge:${row.id}:${ms(row.settledAt)}`,
    memberId: memberOf(row),
    account: 'member_owed',
    kind: 'charge',
    amountCents,
    note: `Session ${session.datetime.slice(0, 10)}`,
    ref: { kind: 'session', id: row.id, pk: row.sessionId },
    createdAt: row.settledAt,
  };
}

/** A payment against a settled row. Keyed by the e-transfer's payment doc, else by when it was marked, else `legacy`. */
export function paymentEntry(row: Pick<Player, 'id' | 'sessionId' | 'memberId' | 'owedAmount' | 'paidAt' | 'paidVia' | 'paymentId'>): NewEntry | null {
  const amountCents = cents(row.owedAmount);
  if (amountCents <= 0) return null;
  const via = row.paidVia ?? 'manual';
  const key = via === 'etransfer' && row.paymentId ? row.paymentId : ms(row.paidAt);
  return {
    id: `payment:${row.id}:${key}`,
    memberId: memberOf(row),
    account: 'member_owed',
    kind: 'payment',
    amountCents: -amountCents,
    note: via === 'etransfer' ? 'E-transfer' : via === 'credit' ? 'Paid with credit' : 'Marked paid',
    ref: { kind: 'session', id: row.id, pk: row.sessionId },
    meta: { via, ...(row.paymentId ? { paymentId: row.paymentId } : {}) },
    ...(row.paidAt ? { createdAt: row.paidAt } : {}),
  };
}

/** An absorb cover: the admin ate this share. `n` = how many covers this row has had before. */
export function coverEntry(row: Pick<Player, 'id' | 'sessionId' | 'memberId' | 'owedAmount' | 'settledAt' | 'coverMode'>, n: number): NewEntry | null {
  const amountCents = cents(row.owedAmount);
  if (amountCents <= 0) return null;
  return {
    id: `cover:${row.id}:${ms(row.settledAt)}:${n}`,
    memberId: memberOf(row),
    account: 'member_owed',
    kind: 'cover',
    amountCents: -amountCents,
    note: 'Covered by the admin',
    ref: { kind: 'session', id: row.id, pk: row.sessionId },
    meta: { coverMode: row.coverMode ?? 'absorb' },
  };
}

/** The club's court outlay for a settled session, from the frozen snapshot. */
export function courtCostEntry(session: Pick<Session, 'id' | 'datetime'>, snapshot: Pick<SettledSnapshot, 'at' | 'courtTotal'>): NewEntry | null {
  const amountCents = cents(snapshot.courtTotal);
  if (amountCents <= 0) return null;
  return {
    id: `court:${session.id}:${ms(snapshot.at)}`,
    memberId: CLUB_LEDGER_ID,
    account: 'club_outlay',
    kind: 'court_cost',
    amountCents,
    note: `Courts ${session.datetime.slice(0, 10)}`,
    ref: { kind: 'court', id: session.id, pk: session.id },
    createdAt: snapshot.at,
  };
}

/** A billable stringing job's charge. `n` = prior charges for the job (a price change voids and re-charges). */
export function stringingChargeEntry(job: Pick<StringingJob, 'id' | 'memberId' | 'priceCents' | 'racketLabel' | 'updatedAt'>, n: number): NewEntry | null {
  if (typeof job.priceCents !== 'number' || job.priceCents <= 0) return null;
  return {
    id: `charge:${job.id}:${n}`,
    memberId: job.memberId,
    account: 'member_owed',
    kind: 'charge',
    amountCents: Math.round(job.priceCents),
    note: `Stringing · ${job.racketLabel}`,
    ref: { kind: 'stringing', id: job.id, pk: job.memberId },
  };
}

export function stringingPaymentEntry(job: Pick<StringingJob, 'id' | 'memberId' | 'priceCents' | 'paidAt'>, via: 'manual' | 'etransfer' | 'credit' = 'manual', paymentId?: string): NewEntry | null {
  if (typeof job.priceCents !== 'number' || job.priceCents <= 0 || !job.paidAt) return null;
  const key = via === 'etransfer' && paymentId ? paymentId : ms(job.paidAt);
  return {
    id: `payment:${job.id}:${key}`,
    memberId: job.memberId,
    account: 'member_owed',
    kind: 'payment',
    amountCents: -Math.round(job.priceCents),
    note: via === 'etransfer' ? 'E-transfer' : via === 'credit' ? 'Paid with credit' : 'Marked paid',
    ref: { kind: 'stringing', id: job.id, pk: job.memberId },
    meta: { via, ...(paymentId ? { paymentId } : {}) },
    createdAt: job.paidAt,
  };
}

export function shuttlePurchaseEntry(p: Pick<BirdPurchase, 'id' | 'totalCost' | 'date' | 'name'>): NewEntry | null {
  const amountCents = cents(p.totalCost);
  if (amountCents <= 0) return null;
  return {
    id: `shuttles:${p.id}`,
    memberId: CLUB_LEDGER_ID,
    account: 'club_outlay',
    kind: 'shuttle_purchase',
    amountCents,
    note: `Shuttles · ${p.name ?? ''}`.trim(),
    ref: { kind: 'purchase', id: p.id, pk: p.id },
    meta: { date: p.date },
  };
}

export function expenseEntry(input: { amountCents: number; note: string; date: string; category: 'court' | 'shuttles' | 'strings' | 'other' }, adminId: string): NewEntry {
  return {
    id: `expense:${randomBytes(12).toString('hex')}`,
    memberId: CLUB_LEDGER_ID,
    account: 'club_outlay',
    kind: 'expense',
    amountCents: input.amountCents,
    note: input.note,
    ref: { kind: 'expense', id: '', pk: CLUB_LEDGER_ID },
    meta: { category: input.category, date: input.date },
    createdBy: adminId,
  };
}

// ── Reading what is already there (for voids and counters) ─────────────────

async function entriesFor(scope: GroupScope, memberId: string, refId: string): Promise<LedgerEntry[]> {
  await ensureLedger();
  const rows = await scope.query<LedgerEntry>('ledger', {
    where: 'c.memberId = @memberId',
    params: [{ name: '@memberId', value: memberId }],
  });
  return rows.filter((e) => e.memberId === memberId && e.ref?.id === refId);
}

/** The live (un-voided) entries of a kind for a ref. */
function live(entries: LedgerEntry[], kind: LedgerEntry['kind']): LedgerEntry[] {
  const voided = new Set(entries.filter((e) => e.kind === 'void').map((e) => e.id.slice('void:'.length)));
  return entries.filter((e) => e.kind === kind && !voided.has(e.id));
}

async function voidLive(scope: GroupScope, memberId: string, refId: string, kind: LedgerEntry['kind'], reason: string): Promise<void> {
  for (const e of live(await entriesFor(scope, memberId, refId), kind)) await appendEntry(scope, voidOf(e, reason));
}

// ── Hooks: one per money event, each a no-op with the flag off ─────────────

/** After `POST /api/session/settle`: a charge per stamped row, the court cost once. */
export async function mirrorSettle(scope: GroupScope, session: Pick<Session, 'id' | 'datetime'>, snapshot: Pick<SettledSnapshot, 'at' | 'courtTotal'>, rows: Player[]): Promise<void> {
  if (!on()) return;
  try {
    for (const row of rows) {
      const e = chargeEntry(row, session);
      if (e) await appendEntry(scope, e);
      // A row already covered when the bill is frozen (re-settle after a
      // cover) carries its cover forward.
      if (row.writtenOff === true && (row.coverMode ?? 'absorb') === 'absorb') {
        const c = coverEntry(row, 0);
        if (c) await appendEntry(scope, c);
      }
    }
    const court = courtCostEntry(session, snapshot);
    if (court) await appendEntry(scope, court);
  } catch (err) {
    mirrorFailures += 1;
    console.error('[ledger-mirror] mirrorSettle failed', { sessionId: session.id, err });
  }
}

/** After `DELETE /api/session/settle`: void every live charge/cover of the rows that were settled, and the court cost. */
export async function mirrorUnsettle(scope: GroupScope, session: Pick<Session, 'id'>, rows: Pick<Player, 'id' | 'memberId'>[]): Promise<void> {
  if (!on()) return;
  try {
    for (const row of rows) {
      await voidLive(scope, memberOf(row), row.id, 'charge', 'unsettled');
      await voidLive(scope, memberOf(row), row.id, 'cover', 'unsettled');
    }
    await voidLive(scope, CLUB_LEDGER_ID, session.id, 'court_cost', 'unsettled');
  } catch (err) {
    mirrorFailures += 1;
    console.error('[ledger-mirror] mirrorUnsettle failed', { sessionId: session.id, err });
  }
}

/** After a row went paid false→true, by any route. `row` is the row AS WRITTEN (paidAt/paidVia set). */
export async function mirrorPaid(scope: GroupScope, row: Player): Promise<void> {
  if (!on()) return;
  const e = paymentEntry(row);
  if (e) await appendEntry(scope, e);
}

/** After a row went paid true→false. `prev` is the row BEFORE the write (it still names its paidAt/paymentId). */
export async function mirrorUnpaid(scope: GroupScope, prev: Player): Promise<void> {
  if (!on()) return;
  try {
    await voidLive(scope, memberOf(prev), prev.id, 'payment', 'unpaid');
  } catch (err) {
    mirrorFailures += 1;
    console.error('[ledger-mirror] mirrorUnpaid failed', { rowId: prev.id, err });
  }
}

/** After a row went writtenOff false→true with absorb. (Resplit is followed by a re-settle, which re-charges.) */
export async function mirrorCover(scope: GroupScope, row: Player): Promise<void> {
  if (!on()) return;
  try {
    if ((row.coverMode ?? 'absorb') !== 'absorb' || !row.settledAt) return;
    const n = (await entriesFor(scope, memberOf(row), row.id)).filter((e) => e.kind === 'cover').length;
    const e = coverEntry(row, n);
    if (e) await appendEntry(scope, e);
  } catch (err) {
    mirrorFailures += 1;
    console.error('[ledger-mirror] mirrorCover failed', { rowId: row.id, err });
  }
}

export async function mirrorUncover(scope: GroupScope, prev: Player): Promise<void> {
  if (!on()) return;
  try {
    await voidLive(scope, memberOf(prev), prev.id, 'cover', 'uncovered');
  } catch (err) {
    mirrorFailures += 1;
    console.error('[ledger-mirror] mirrorUncover failed', { rowId: prev.id, err });
  }
}

/** A settled row hard-deleted (purgeAll / purgeOne): its charge is void; a received payment is real money and stays. */
export async function mirrorRowDeleted(scope: GroupScope, row: Pick<Player, 'id' | 'memberId'>): Promise<void> {
  if (!on()) return;
  try {
    await voidLive(scope, memberOf(row), row.id, 'charge', 'row_deleted');
    await voidLive(scope, memberOf(row), row.id, 'cover', 'row_deleted');
  } catch (err) {
    mirrorFailures += 1;
    console.error('[ledger-mirror] mirrorRowDeleted failed', { rowId: row.id, err });
  }
}

const BILLABLE = new Set(['ready', 'picked_up']);
const billableShaped = (j: Pick<StringingJob, 'priceCents' | 'status'>) => typeof j.priceCents === 'number' && j.priceCents > 0 && BILLABLE.has(j.status);

/**
 * After a stringing job changed (price, status, paid). A charge exists only
 * while the job is billable-shaped; a price change or a status moving
 * backwards voids the old one. `prev` is the job before the write.
 */
export async function mirrorStringingChanged(scope: GroupScope, prev: StringingJob, next: StringingJob, via: 'manual' | 'etransfer' | 'credit' = 'manual', paymentId?: string): Promise<void> {
  if (!on()) return;
  try {
    const was = billableShaped(prev);
    const is = billableShaped(next);
    const priceChanged = prev.priceCents !== next.priceCents;
    if (was && (!is || priceChanged)) await voidLive(scope, prev.memberId, prev.id, 'charge', priceChanged ? 'price_changed' : 'not_billable');
    if (is && (!was || priceChanged)) {
      const n = (await entriesFor(scope, next.memberId, next.id)).filter((e) => e.kind === 'charge').length;
      const e = stringingChargeEntry(next, n);
      if (e) await appendEntry(scope, e);
    }
    if (!prev.paidAt && next.paidAt) {
      const e = stringingPaymentEntry(next, via, paymentId);
      if (e) await appendEntry(scope, e);
    }
    if (prev.paidAt && !next.paidAt) await voidLive(scope, prev.memberId, prev.id, 'payment', 'unpaid');
  } catch (err) {
    mirrorFailures += 1;
    console.error('[ledger-mirror] mirrorStringingChanged failed', { jobId: next.id, err });
  }
}

export async function mirrorStringingDeleted(scope: GroupScope, job: Pick<StringingJob, 'id' | 'memberId'>): Promise<void> {
  if (!on()) return;
  try {
    await voidLive(scope, job.memberId, job.id, 'charge', 'job_deleted');
  } catch (err) {
    mirrorFailures += 1;
    console.error('[ledger-mirror] mirrorStringingDeleted failed', { jobId: job.id, err });
  }
}

export async function mirrorShuttlePurchase(scope: GroupScope, p: BirdPurchase): Promise<void> {
  if (!on()) return;
  const e = shuttlePurchaseEntry(p);
  if (e) await appendEntry(scope, e);
}

/** A purchase's cost changed: void the old entry, write the new one as an adjustment keyed by count. */
export async function mirrorShuttleAdjusted(scope: GroupScope, prev: BirdPurchase, next: BirdPurchase): Promise<void> {
  if (!on()) return;
  try {
    const delta = cents(next.totalCost) - cents(prev.totalCost);
    if (delta === 0) return;
    const n = (await entriesFor(scope, CLUB_LEDGER_ID, next.id)).filter((e) => e.kind === 'shuttle_adj').length;
    await appendEntry(scope, {
      id: `shuttles:${next.id}:adj:${n}`,
      memberId: CLUB_LEDGER_ID,
      account: 'club_outlay',
      kind: 'shuttle_adj',
      amountCents: delta,
      note: 'Purchase cost changed',
      ref: { kind: 'purchase', id: next.id, pk: next.id },
    });
  } catch (err) {
    mirrorFailures += 1;
    console.error('[ledger-mirror] mirrorShuttleAdjusted failed', { purchaseId: next.id, err });
  }
}

export async function mirrorShuttleDeleted(scope: GroupScope, p: Pick<BirdPurchase, 'id'>): Promise<void> {
  if (!on()) return;
  try {
    await voidLive(scope, CLUB_LEDGER_ID, p.id, 'shuttle_purchase', 'purchase_deleted');
    await voidLive(scope, CLUB_LEDGER_ID, p.id, 'shuttle_adj', 'purchase_deleted');
  } catch (err) {
    mirrorFailures += 1;
    console.error('[ledger-mirror] mirrorShuttleDeleted failed', { purchaseId: p.id, err });
  }
}
