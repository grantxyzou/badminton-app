import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { POST as assign } from '@/app/api/admin/payments/assign/route';
import { applyAllocations } from '@/lib/paymentsInbox';
import { groupScope } from '@/lib/groupScope';
import type { EtransferPayment, LedgerEntry } from '@/lib/types';
import { resetMockStore, getStore, seedPointer, seedSession, seedPlayer, seedMember, seedDoc, makeAdminRequest, setupAdminPin, seedTestAdminMember } from './helpers';

/**
 * GAP 8 of docs/plans/money-audit.md — FIXED (2026-11-16): an e-transfer
 * allocation never pays a FROZEN line MORE than it owes. The window is
 * between `computeOwed` (which prices the lines) and the write; a re-settle
 * in it used to mark the row paid at the NEW amount for a transfer of the
 * old one. With `paidAmount` (docs/plans/paid-amount.md) a bill RAISED in
 * that window lands as a part-payment — $30 came for a $45 line, which is
 * the truth — and a bill LOWERED under the transfer leaves the payment in
 * the queue, because paying more than a line owes is a guess. The mock
 * below re-prices Lin's row inside that window.
 */

const SID = 'session-2026-10-01';
const BASE = 'http://localhost:3000/api';
const rows = () => getStore()['players'] as Array<Record<string, unknown>>;
const rowOf = (name: string) => rows().find((p) => p.name === name)!;
const payment = () => (getStore()['payments'] as EtransferPayment[])[0];
const ledger = () => (getStore()['ledger'] ?? []) as LedgerEntry[];

// After the real `computeOwed` has priced Lin's line at $30, the bill moves.
let moveAfterPricing: number | null = null;
vi.mock('@/lib/owedBalance', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/owedBalance')>();
  return {
    ...mod,
    computeOwed: async (...args: Parameters<typeof mod.computeOwed>) => {
      const out = await mod.computeOwed(...args);
      if (moveAfterPricing !== null) {
        Object.assign(rowOf('Lin'), { owedAmount: moveAfterPricing });
        moveAfterPricing = null;
      }
      return out;
    },
  };
});

let lin: { id: string };

beforeEach(async () => {
  resetMockStore();
  setupAdminPin();
  moveAfterPricing = null;
  process.env.NEXT_PUBLIC_FLAG_PAYMENTS_AUTO = 'true';
  process.env.NEXT_PUBLIC_FLAG_LEDGER_MIRROR = 'true';
  await seedTestAdminMember();
  seedPointer(SID);
  seedSession(SID, { datetime: '2026-10-01T19:00:00-04:00', settled: { at: '2026-10-02T00:00:00Z', costPerPerson: 30, totalCost: 60, courtTotal: 60, birdTotal: 0, playerCount: 2, playerNames: [] } });
  lin = seedMember('Lin');
  seedPlayer(SID, 'Lin', { memberId: lin.id, owedAmount: 30, settledAt: '2026-10-02T00:00:00Z' });
  seedDoc('payments', {
    id: 'pay-1', groupId: 'bpm', source: 'etransfer', senderName: 'LIN DAN', amountCents: 3000, memo: null, subject: 'x', receivedAt: '2026-10-03T12:00:00Z',
    authenticated: true, status: 'review', reason: 'unknown_sender', allocations: [], createdAt: '2026-10-03T12:00:00Z',
  });
});

afterEach(() => {
  delete process.env.NEXT_PUBLIC_FLAG_PAYMENTS_AUTO;
  delete process.env.NEXT_PUBLIC_FLAG_LEDGER_MIRROR;
});

const doAssign = () => assign(makeAdminRequest('POST', `${BASE}/admin/payments/assign`, { paymentId: 'pay-1', action: 'assign', memberId: lin.id }));

describe('an allocation pays a frozen line only at the amount it was matched for', () => {
  it('applyAllocations skips a row that owes less than the money, and a job whose price moved', async () => {
    const scope = groupScope('bpm');
    const id = String(rowOf('Lin').id);
    expect(await applyAllocations(scope, [{ kind: 'session', ref: id, pk: SID, amountCents: 4500, lineCents: 4500 }], 'pay-x')).toEqual([]);
    expect(rowOf('Lin')).toMatchObject({ paid: false });
    expect(rowOf('Lin').paidAmount).toBeUndefined();
    seedDoc('stringingJobs', { id: 'job-1', groupId: 'bpm', memberId: lin.id, memberName: 'Lin', status: 'ready', priceCents: 1500, paidAt: null, createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z', history: [] });
    expect(await applyAllocations(scope, [{ kind: 'stringing', ref: 'job-1', pk: lin.id, amountCents: 2000 }], 'pay-x')).toEqual([]);
    expect((getStore()['stringingJobs'] as Array<{ paidAt: string | null }>)[0].paidAt).toBeNull();
    // At the right amounts both land.
    expect(await applyAllocations(scope, [{ kind: 'session', ref: id, pk: SID, amountCents: 3000 }, { kind: 'stringing', ref: 'job-1', pk: lin.id, amountCents: 1500 }], 'pay-x')).toHaveLength(2);
  });

  it('a bill RAISED between pricing and writing lands as a part-payment: $30 received of $45, $15 still owed', async () => {
    moveAfterPricing = 45;
    const res = await doAssign();
    expect(res.status).toBe(200);
    expect(rowOf('Lin')).toMatchObject({ paid: false, owedAmount: 45, paidAmount: 30, paidVia: 'etransfer', paymentId: 'pay-1' });
    expect(payment()).toMatchObject({ status: 'matched', memberId: lin.id, allocations: [{ kind: 'session', amountCents: 3000, lineCents: 3000 }] });
    expect(ledger().filter((e) => e.kind === 'payment').map((e) => [e.id, e.amountCents])).toEqual([[`payment:${rowOf('Lin').id}:pay-1`, -3000]]);
  });

  it('a bill LOWERED under the transfer leaves the payment in the queue, the row owed, and nothing in the ledger', async () => {
    moveAfterPricing = 20;
    const res = await doAssign();
    expect(res.status).toBe(200);
    expect(rowOf('Lin')).toMatchObject({ paid: false, owedAmount: 20 });
    expect(rowOf('Lin').paidAmount).toBeUndefined();
    expect(payment()).toMatchObject({ status: 'review', reason: 'changed_while_matching', memberId: lin.id, payerName: 'Lin', allocations: [] });
    expect(payment().matchedBy).toBeUndefined();
    expect(ledger().filter((e) => e.kind === 'payment')).toEqual([]);

    // The organiser looks again: the $30 transfer is more than the $20 line, so no line matches the money.
    expect((await doAssign()).status).toBe(409);
    expect(await (await doAssign()).json()).toEqual({ error: 'not_owed' });
    expect(payment().status).toBe('review');
  });

  it('with no re-settle the same assign pays the line and resolves the payment', async () => {
    expect((await doAssign()).status).toBe(200);
    expect(rowOf('Lin')).toMatchObject({ paid: true, paidVia: 'etransfer', paymentId: 'pay-1' });
    expect(rowOf('Lin')).toMatchObject({ paidAmount: 30 });
    expect(payment()).toMatchObject({ status: 'matched', allocations: [{ kind: 'session', amountCents: 3000, lineCents: 3000 }] });
  });
});
