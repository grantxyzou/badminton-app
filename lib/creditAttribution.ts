import type { LedgerEntry } from './types';
import { accountOf } from './storeCredit';

/**
 * WHICH CREDIT PAID FOR WHAT — a reading over a member's credit history, not
 * a second ledger (docs/plans/gift-card-ledger.md).
 *
 * A member's credit is ONE pool: a gift card, a grant and a refund all add to
 * it and a spend draws from it, and `balanceOf` is just the sum. Grant's ask
 * — "remaining balance and when and how much it's used", per CARD — needs
 * each drain assigned to a source, so this walks the entries in time order
 * and draws every spend from the OLDEST source that still has something
 * left. That is the only rule a person could check by hand against the
 * entry list, which is what makes it documentation rather than a guess.
 *
 *   - A SOURCE is a positive entry: a gift redemption or a credit grant.
 *   - A DRAIN is a negative entry: a spend, or a negative grant (an admin
 *     taking credit back). It is drawn oldest-source-first and may span two
 *     sources; each source records its share as a `use`.
 *   - A REFUND (`credit_refund`) reverses the spend that shares its `ref`:
 *     that spend's uses are given back to the sources they came from and
 *     marked `reversed`, so a card whose spend bounced reads as unused. A
 *     refund with no spend to match is treated as a plain source.
 *
 * Pure, and deterministic for a given entry list: the same history always
 * attributes the same way, so the admin's record of a card never changes
 * under them except when a new entry lands.
 */

export interface CreditUse {
  /** The draining entry's id. */
  entryId: string;
  at: string;
  /** Positive: how much of THIS source the drain took. */
  amountCents: number;
  kind: LedgerEntry['kind'];
  note: string;
  /** Set when a refund gave this use back. */
  reversed?: boolean;
}

export interface CreditSource {
  /** The source entry's id — `gift:<hash>` for a card, `grant:<hex>` for a grant. */
  id: string;
  kind: LedgerEntry['kind'];
  createdAt: string;
  note: string;
  amountCents: number;
  /** Σ of uses not reversed. */
  usedCents: number;
  remainingCents: number;
  uses: CreditUse[];
}

interface Live extends CreditSource {
  remaining: number;
}

export function attributeCredit(entries: readonly LedgerEntry[]): CreditSource[] {
  const credit = entries
    .filter((e) => accountOf(e) === 'member_credit' && e.kind !== 'void')
    .slice()
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : 1));

  const sources: Live[] = [];
  // Every drain's allocation, by the drain's ref id, so a refund can find it.
  const byRef = new Map<string, Array<{ source: Live; use: CreditUse }>>();

  const addSource = (e: LedgerEntry) => {
    sources.push({ id: e.id, kind: e.kind, createdAt: e.createdAt, note: e.note, amountCents: e.amountCents, usedCents: 0, remainingCents: e.amountCents, uses: [], remaining: e.amountCents });
  };

  for (const e of credit) {
    if (e.amountCents > 0) {
      const refId = e.ref?.id;
      const matched = e.kind === 'credit_refund' && refId ? byRef.get(refId) : undefined;
      if (matched && matched.length > 0) {
        // Give the spend back, to the sources it was drawn from.
        let left = e.amountCents;
        for (const { source, use } of matched) {
          if (left <= 0) break;
          const back = Math.min(use.amountCents, left);
          source.remaining += back;
          use.reversed = true;
          left -= back;
        }
        byRef.delete(refId!);
        if (left > 0) addSource({ ...e, amountCents: left });
      } else {
        addSource(e);
      }
      continue;
    }
    if (e.amountCents < 0) {
      let left = -e.amountCents;
      const allocation: Array<{ source: Live; use: CreditUse }> = [];
      for (const s of sources) {
        if (left <= 0) break;
        if (s.remaining <= 0) continue;
        const take = Math.min(s.remaining, left);
        s.remaining -= take;
        left -= take;
        const use: CreditUse = { entryId: e.id, at: e.createdAt, amountCents: take, kind: e.kind, note: e.note };
        s.uses.push(use);
        allocation.push({ source: s, use });
      }
      // Overdrawn (a spend that outran the balance before its refund landed):
      // nothing left to attribute; the refund that follows matches by ref.
      if (e.ref?.id && allocation.length > 0) byRef.set(e.ref.id, allocation);
    }
  }

  return sources.map(({ remaining, ...s }) => {
    const usedCents = s.uses.reduce((sum, u) => sum + (u.reversed ? 0 : u.amountCents), 0);
    return { ...s, usedCents, remainingCents: remaining };
  });
}

/** The record for one source, or null when the member's history does not hold it. */
export function sourceRecord(entries: readonly LedgerEntry[], sourceId: string): CreditSource | null {
  return attributeCredit(entries).find((s) => s.id === sourceId) ?? null;
}
