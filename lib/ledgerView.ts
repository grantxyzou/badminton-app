/**
 * THE MONEY VIEW'S BUCKETS — Phase 2 of docs/plans/payments.md, stage 3. Pure.
 *
 * One pass over the club's ledger entries sorts every cent into the buckets
 * the Ledger page shows: income (charges), collected (payments, by how they
 * arrived), covered, club outlay (by category), credit liability, and net.
 *
 * THE WINDOW IS APPLIED HERE, IN JS. The mock store ignores a date parameter
 * it does not know, so a SQL range would be a filter that production applies
 * and tests never see; one projected scan of a few thousand rows is cheap
 * next to that trap.
 *
 * AN ENTRY'S DATE is the money's own date, not the write's: an expense carries
 * the day it was spent in `meta.date`; a charge's `createdAt` is the settle;
 * a payment's is `paidAt`. A VOID takes the date of the entry it reverses — a
 * March charge unsettled in May must cancel inside March, or a 30-day view
 * would show a phantom negative in May and the March total would stand.
 *
 * CREDIT LIABILITY ignores the window. Money the club owes back is owed
 * today whenever it was granted; it is the sum of every member's POSITIVE
 * credit balance (a member cannot owe credit, so a negative partition — an
 * unfinished spend, a refund race — is not an asset).
 */
import type { LedgerEntry } from './types';

export interface MoneyView {
  /** Charges net of voids, cents, in window. */
  income: { sessions: number; stringing: number; total: number };
  /** Payments net of voids, cents, in window, by how they arrived. */
  collected: { etransferAuto: number; etransferAdmin: number; manual: number; credit: number; total: number };
  /** Absorb covers net of voids, cents, in window — what the admin ate. */
  covered: number;
  /** Club outlay net of voids, cents, in window. `shuttles` includes price adjustments. */
  outlay: { courts: number; shuttles: number; strings: number; other: number; total: number };
  /** Collected minus outlay. */
  net: number;
  /** Credit the club owes back, right now (not windowed). */
  credit: { liability: number; members: number };
}

const empty = (): MoneyView => ({
  income: { sessions: 0, stringing: 0, total: 0 },
  collected: { etransferAuto: 0, etransferAdmin: 0, manual: 0, credit: 0, total: 0 },
  covered: 0,
  outlay: { courts: 0, shuttles: 0, strings: 0, other: 0, total: 0 },
  net: 0,
  credit: { liability: 0, members: 0 },
});

type Entry = Pick<LedgerEntry, 'id' | 'memberId' | 'account' | 'kind' | 'amountCents' | 'ref' | 'meta' | 'createdAt'>;

/** The date the money belongs to (ISO), with a void borrowing its original's. A day-only date is anchored at 00:00Z. */
export function effectiveDate(e: Entry, byId: Map<string, Entry>): string {
  if (e.kind === 'void') {
    const original = byId.get(e.id.slice('void:'.length));
    if (original) return effectiveDate(original, byId);
  }
  return e.meta?.date ? `${e.meta.date}T00:00:00.000Z` : e.createdAt;
}

/** Does the money carry only a calendar day (an expense's `meta.date`), with no clock? */
function isDayOnly(e: Entry, byId: Map<string, Entry>): boolean {
  if (e.kind === 'void') {
    const original = byId.get(e.id.slice('void:'.length));
    if (original) return isDayOnly(original, byId);
  }
  return !!e.meta?.date;
}

/**
 * A DAY-ONLY DATE GETS A DAY OF SLACK AT THE TOP OF THE WINDOW. The admin
 * types the day they spent it, in their own calendar; the window ends at
 * `now`, a UTC instant. Anchored anywhere inside that day, "today" can sit
 * in the FUTURE of a `now` that is earlier in UTC (an admin east of
 * Greenwich, before noon — review of #572), and the expense would show in
 * the list and be missing from the totals it sits under. So a day counts
 * once it has begun anywhere on Earth.
 */
const DAY_SLACK_MS = 24 * 60 * 60 * 1000;

/** The kind a void counts against: its original's. */
function effectiveKind(e: Entry, byId: Map<string, Entry>): Entry['kind'] {
  if (e.kind !== 'void') return e.kind;
  const original = byId.get(e.id.slice('void:'.length));
  return original ? effectiveKind(original, byId) : 'void';
}

function effectiveMeta(e: Entry, byId: Map<string, Entry>): Entry['meta'] {
  if (e.kind !== 'void') return e.meta;
  const original = byId.get(e.id.slice('void:'.length));
  return original ? effectiveMeta(original, byId) : e.meta;
}

const accountOf = (e: Pick<LedgerEntry, 'account'>) => e.account ?? 'member_credit';

export function summarizeLedger(
  entries: readonly Entry[],
  window: { from: number; to: number },
  /** `payments` doc id → how it was matched (`'auto'`, or anything else for an admin's tap). */
  matchedBy: ReadonlyMap<string, string | undefined> = new Map(),
): MoneyView {
  const v = empty();
  const byId = new Map<string, Entry>();
  for (const e of entries) byId.set(e.id, e);

  const creditByMember = new Map<string, number>();

  for (const e of entries) {
    const account = accountOf(e);
    if (account === 'member_credit') {
      creditByMember.set(e.memberId, (creditByMember.get(e.memberId) ?? 0) + e.amountCents);
      continue;
    }
    const t = Date.parse(effectiveDate(e, byId));
    const top = window.to + (isDayOnly(e, byId) ? DAY_SLACK_MS : 0);
    if (!Number.isFinite(t) || t < window.from || t > top) continue;
    const kind = effectiveKind(e, byId);
    const meta = effectiveMeta(e, byId);
    const cents = e.amountCents;

    if (account === 'member_owed') {
      if (kind === 'charge') {
        if (e.ref?.kind === 'stringing') v.income.stringing += cents;
        else v.income.sessions += cents;
      } else if (kind === 'payment') {
        // A payment is negative in the owed account; collected is positive money in.
        const got = -cents;
        if (meta?.via === 'credit') v.collected.credit += got;
        else if (meta?.via === 'etransfer') {
          if (meta.paymentId && matchedBy.get(meta.paymentId) === 'auto') v.collected.etransferAuto += got;
          else v.collected.etransferAdmin += got;
        } else v.collected.manual += got;
      } else if (kind === 'cover') {
        v.covered += -cents;
      }
      continue;
    }

    // club_outlay: money out is positive.
    if (kind === 'court_cost') v.outlay.courts += cents;
    else if (kind === 'shuttle_purchase' || kind === 'shuttle_adj') v.outlay.shuttles += cents;
    else if (kind === 'expense') {
      const c = meta?.category;
      if (c === 'court') v.outlay.courts += cents;
      else if (c === 'shuttles') v.outlay.shuttles += cents;
      else if (c === 'strings') v.outlay.strings += cents;
      else v.outlay.other += cents;
    }
  }

  v.income.total = v.income.sessions + v.income.stringing;
  v.collected.total = v.collected.etransferAuto + v.collected.etransferAdmin + v.collected.manual + v.collected.credit;
  v.outlay.total = v.outlay.courts + v.outlay.shuttles + v.outlay.strings + v.outlay.other;
  v.net = v.collected.total - v.outlay.total;
  for (const bal of creditByMember.values()) {
    if (bal > 0) {
      v.credit.liability += bal;
      v.credit.members += 1;
    }
  }
  return v;
}

export type RangeKey = '30d' | '12w' | 'all';

export function rangeWindow(range: RangeKey, now: number): { from: number; to: number } {
  if (range === 'all') return { from: 0, to: now };
  if (range === '30d') return { from: now - 30 * 86_400_000, to: now };
  return { from: now - 84 * 86_400_000, to: now };
}
