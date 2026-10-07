import { describe, it, expect } from 'vitest';
import { summarizeLedger, effectiveDate, rangeWindow } from '@/lib/ledgerView';
import type { LedgerEntry } from '@/lib/types';

/**
 * The money view's buckets are pure arithmetic over ledger entries, and the
 * places that arithmetic can lie are specific: a void landing in the wrong
 * window, a cover counted as money in, a negative credit partition counted
 * as a liability, an out-of-window entry leaking in.
 */

const DAY = 86_400_000;
const T0 = Date.parse('2026-10-01T00:00:00Z');
const at = (days: number) => new Date(T0 + days * DAY).toISOString();

let n = 0;
function entry(over: Partial<LedgerEntry> & Pick<LedgerEntry, 'kind' | 'amountCents'>): LedgerEntry {
  n += 1;
  return {
    id: over.id ?? `e${n}`,
    memberId: 'm1',
    account: 'member_owed',
    note: '',
    createdAt: at(0),
    createdBy: 'system',
    ...over,
  };
}

const window = { from: T0 - 15 * DAY, to: T0 + 15 * DAY };

describe('summarizeLedger', () => {
  it('sorts charges, payments by method, covers and outlay into their buckets', () => {
    const matchedBy = new Map([['pay-auto', 'auto'], ['pay-admin', 'admin']]);
    const v = summarizeLedger(
      [
        entry({ kind: 'charge', amountCents: 1200, ref: { kind: 'session', id: 'r1', pk: 's1' } }),
        entry({ kind: 'charge', amountCents: 3000, ref: { kind: 'stringing', id: 'j1', pk: 'm1' } }),
        entry({ kind: 'payment', amountCents: -1200, meta: { via: 'etransfer', paymentId: 'pay-auto' } }),
        entry({ kind: 'payment', amountCents: -500, meta: { via: 'etransfer', paymentId: 'pay-admin' } }),
        entry({ kind: 'payment', amountCents: -700, meta: { via: 'etransfer' } }), // no doc → an admin's tap
        entry({ kind: 'payment', amountCents: -300, meta: { via: 'manual' } }),
        entry({ kind: 'payment', amountCents: -400 }), // legacy, no meta → manual
        entry({ kind: 'payment', amountCents: -600, meta: { via: 'credit' } }),
        entry({ kind: 'cover', amountCents: -1200, meta: { coverMode: 'absorb' } }),
        entry({ kind: 'court_cost', amountCents: 6000, memberId: '~club', account: 'club_outlay' }),
        entry({ kind: 'shuttle_purchase', amountCents: 25000, memberId: '~club', account: 'club_outlay' }),
        entry({ kind: 'shuttle_adj', amountCents: -1000, memberId: '~club', account: 'club_outlay' }),
        entry({ kind: 'expense', amountCents: 1500, memberId: '~club', account: 'club_outlay', meta: { category: 'strings', date: '2026-10-03' } }),
        entry({ kind: 'expense', amountCents: 800, memberId: '~club', account: 'club_outlay', meta: { category: 'other', date: '2026-10-03' } }),
        entry({ kind: 'expense', amountCents: 2000, memberId: '~club', account: 'club_outlay', meta: { category: 'court', date: '2026-10-03' } }),
      ],
      window,
      matchedBy,
    );
    expect(v.income).toEqual({ sessions: 1200, stringing: 3000, total: 4200 });
    expect(v.collected).toEqual({ etransferAuto: 1200, etransferAdmin: 1200, manual: 700, credit: 600, total: 3700 });
    expect(v.covered).toBe(1200);
    expect(v.outlay).toEqual({ courts: 8000, shuttles: 24000, strings: 1500, other: 800, total: 34300 });
    expect(v.net).toBe(3700 - 34300);
  });

  it('a void lands in the window of the entry it reverses, not the day it was written', () => {
    const charge = entry({ id: 'charge:r1:1', kind: 'charge', amountCents: 1200, createdAt: at(-10) });
    const lateVoid = entry({ id: 'void:charge:r1:1', kind: 'void', amountCents: -1200, createdAt: at(40) }); // written far outside
    const inWindow = summarizeLedger([charge, lateVoid], window);
    expect(inWindow.income.sessions).toBe(0); // netted inside the window
    const later = summarizeLedger([charge, lateVoid], { from: T0 + 30 * DAY, to: T0 + 50 * DAY });
    expect(later.income.sessions).toBe(0); // and not a phantom −1200 later
    // A void whose original is unknown falls back to its own date.
    expect(effectiveDate(lateVoid, new Map())).toBe(at(40));
  });

  it('an expense is dated by the day it was spent, not the day it was typed in', () => {
    const e = entry({ kind: 'expense', amountCents: 500, memberId: '~club', account: 'club_outlay', createdAt: at(0), meta: { category: 'other', date: '2026-09-01' } });
    expect(summarizeLedger([e], window).outlay.other).toBe(0);
    expect(summarizeLedger([e], { from: Date.parse('2026-08-25T00:00:00Z'), to: Date.parse('2026-09-05T00:00:00Z') }).outlay.other).toBe(500);
  });

  it('out-of-window entries stay out, and the credit liability ignores the window', () => {
    const v = summarizeLedger(
      [
        entry({ kind: 'charge', amountCents: 1200, createdAt: at(-100) }),
        entry({ kind: 'credit_grant', amountCents: 2000, account: 'member_credit', memberId: 'm1', createdAt: at(-400) }),
        entry({ kind: 'credit_spend', amountCents: -500, account: 'member_credit', memberId: 'm1', createdAt: at(-399) }),
        entry({ kind: 'credit_grant', amountCents: 1000, account: 'member_credit', memberId: 'm2', createdAt: at(1) }),
        entry({ kind: 'credit_spend', amountCents: -1500, account: 'member_credit', memberId: 'm2', createdAt: at(2) }), // negative partition: not an asset
        entry({ kind: 'credit_grant', amountCents: 700, memberId: 'm3', account: undefined, createdAt: at(1) }), // no account → legacy credit
      ],
      window,
    );
    expect(v.income.sessions).toBe(0);
    expect(v.credit).toEqual({ liability: 2200, members: 2 });
  });

  it('an empty ledger is all zeros', () => {
    const v = summarizeLedger([], window);
    expect(v.income.total).toBe(0);
    expect(v.collected.total).toBe(0);
    expect(v.outlay.total).toBe(0);
    expect(v.net).toBe(0);
    expect(v.credit).toEqual({ liability: 0, members: 0 });
  });

  it('rangeWindow: 30 days, 12 weeks, or everything', () => {
    const now = T0;
    expect(rangeWindow('30d', now)).toEqual({ from: now - 30 * DAY, to: now });
    expect(rangeWindow('12w', now)).toEqual({ from: now - 84 * DAY, to: now });
    expect(rangeWindow('all', now)).toEqual({ from: 0, to: now });
  });
});
