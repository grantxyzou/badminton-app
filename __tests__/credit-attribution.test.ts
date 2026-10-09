import { describe, it, expect } from 'vitest';
import { attributeCredit, sourceRecord } from '@/lib/creditAttribution';
import type { LedgerEntry } from '@/lib/types';

/**
 * Which credit paid for what (docs/plans/gift-card-ledger.md): a reading
 * over one member's credit entries, oldest source first. The rule has to be
 * one a person can check against the entry list by hand.
 */

let n = 0;
const entry = (over: Partial<LedgerEntry> & { amountCents: number; kind: LedgerEntry['kind'] }): LedgerEntry => ({
  id: over.id ?? `e${++n}`,
  memberId: 'm1',
  account: 'member_credit',
  note: '',
  createdAt: `2026-10-0${Math.min(9, ++n)}T00:00:00Z`,
  createdBy: 'm1',
  ...over,
});

describe('attributeCredit', () => {
  it('draws a spend from the oldest source first, and a bigger spend spans two', () => {
    const gift = entry({ id: 'gift:a', kind: 'gift_redeem', amountCents: 2500, createdAt: '2026-10-01T00:00:00Z', note: 'Gift card' });
    const grant = entry({ id: 'grant:b', kind: 'credit_grant', amountCents: 1000, createdAt: '2026-10-02T00:00:00Z', note: 'Birthday' });
    const spend1 = entry({ id: 'spend:r1:0', kind: 'credit_spend', amountCents: -1200, createdAt: '2026-10-03T00:00:00Z', note: 'Session 2026-09-24', ref: { kind: 'session', id: 'r1', pk: 's' } });
    const spend2 = entry({ id: 'spend:r2:0', kind: 'credit_spend', amountCents: -1500, createdAt: '2026-10-04T00:00:00Z', note: 'Session 2026-10-01', ref: { kind: 'session', id: 'r2', pk: 's' } });
    const out = attributeCredit([spend2, grant, spend1, gift]); // order of input is irrelevant
    expect(out.map((s) => s.id)).toEqual(['gift:a', 'grant:b']);
    const [card, top] = out;
    expect(card).toMatchObject({ amountCents: 2500, usedCents: 2500, remainingCents: 0 });
    expect(card.uses.map((u) => [u.entryId, u.amountCents])).toEqual([['spend:r1:0', 1200], ['spend:r2:0', 1300]]);
    expect(top).toMatchObject({ amountCents: 1000, usedCents: 200, remainingCents: 800 });
    expect(top.uses).toEqual([expect.objectContaining({ entryId: 'spend:r2:0', amountCents: 200, at: '2026-10-04T00:00:00Z' })]);
  });

  it('a refund gives the spend back to the sources it came from and marks the use reversed', () => {
    const gift = entry({ id: 'gift:a', kind: 'gift_redeem', amountCents: 1000, createdAt: '2026-10-01T00:00:00Z' });
    const spend = entry({ id: 'spend:r1:0', kind: 'credit_spend', amountCents: -1000, createdAt: '2026-10-02T00:00:00Z', ref: { kind: 'session', id: 'r1', pk: 's' } });
    const refund = entry({ id: 'refund:r1:0', kind: 'credit_refund', amountCents: 1000, createdAt: '2026-10-02T00:00:01Z', ref: { kind: 'session', id: 'r1', pk: 's' } });
    const [card] = attributeCredit([gift, spend, refund]);
    expect(card).toMatchObject({ usedCents: 0, remainingCents: 1000 });
    expect(card.uses).toEqual([expect.objectContaining({ entryId: 'spend:r1:0', reversed: true })]);
    // The refund is not a second source.
    expect(attributeCredit([gift, spend, refund])).toHaveLength(1);
  });

  it('an admin taking credit back is a drain like any other', () => {
    const gift = entry({ id: 'gift:a', kind: 'gift_redeem', amountCents: 2000, createdAt: '2026-10-01T00:00:00Z' });
    const back = entry({ id: 'grant:c', kind: 'credit_grant', amountCents: -500, createdAt: '2026-10-02T00:00:00Z', note: 'Oops' });
    const [card] = attributeCredit([gift, back]);
    expect(card).toMatchObject({ usedCents: 500, remainingCents: 1500 });
    expect(card.uses[0]).toMatchObject({ kind: 'credit_grant', amountCents: 500, note: 'Oops' });
  });

  it('ignores owed-account entries, voids and a refund with nothing to match becomes a plain source', () => {
    const owed = entry({ id: 'charge:x', kind: 'charge', account: 'member_owed', amountCents: 1200 });
    const voided = entry({ id: 'void:grant:z', kind: 'void', amountCents: -300 });
    const orphan = entry({ id: 'refund:q:0', kind: 'credit_refund', amountCents: 300, ref: { kind: 'session', id: 'q', pk: 's' } });
    const out = attributeCredit([owed, voided, orphan]);
    expect(out).toEqual([expect.objectContaining({ id: 'refund:q:0', amountCents: 300, remainingCents: 300 })]);
  });

  it('sourceRecord finds one card, or null', () => {
    const gift = entry({ id: 'gift:a', kind: 'gift_redeem', amountCents: 1000 });
    expect(sourceRecord([gift], 'gift:a')?.remainingCents).toBe(1000);
    expect(sourceRecord([gift], 'gift:zzz')).toBeNull();
  });
});
