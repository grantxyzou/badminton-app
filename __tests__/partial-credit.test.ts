import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { POST as settle } from '@/app/api/session/settle/route';
import { PATCH as patchPlayer } from '@/app/api/players/route';
import { POST as assign } from '@/app/api/admin/payments/assign/route';
import { payWithCredit, refundStaleSpends, balanceOf, ledgerFor, CreditError } from '@/lib/storeCredit';
import { groupScope } from '@/lib/groupScope';
import { runReconcile } from '@/lib/ledgerReconcile';
import type { EtransferPayment, LedgerEntry } from '@/lib/types';
import { resetMockStore, getStore, seedPointer, seedSession, seedPlayer, seedMember, seedDoc, makeAdminRequest, setupAdminPin, seedTestAdminMember } from './helpers';

/**
 * CREDIT THAT DOES NOT COVER THE WHOLE BILL (docs/plans/partial-credit.md;
 * Grant, 2026-11-21). Whole lines first, then what is left goes onto the
 * oldest frozen session line as a part ("paid $10 of $30"). Every credit
 * spend is tracked on its own, so a line can take several, and a crash
 * half-way through one is finished or refunded without touching the others.
 */

const SID = 'session-2026-10-01';
const BASE = 'http://localhost:3000/api';
const OLD = '2026-10-05T00:00:00Z';
const rows = () => getStore()['players'] as Array<Record<string, unknown>>;
const lin = () => rows().find((p) => p.name === 'Lin')!;
const ledger = () => (getStore()['ledger'] ?? []) as LedgerEntry[];
const scope = () => groupScope('bpm');
const codes = async () => (await runReconcile('bpm')).mismatches.map((m) => [m.code, m.ledgerCents, m.liveCents]);
const reviews = () => ((getStore()['payments'] ?? []) as EtransferPayment[]).filter((p) => p.source === 'credit');
const livePayments = (ref: string) => {
  const voided = new Set(ledger().filter((e) => e.kind === 'void').map((e) => e.id.slice('void:'.length)));
  return ledger().filter((e) => e.kind === 'payment' && e.ref?.id === ref && !voided.has(e.id));
};

let linId: string;
let grants = 0;
const give = (amountCents: number) =>
  seedDoc('ledger', { id: `grant:${grants++}`, groupId: 'bpm', memberId: linId, account: 'member_credit', kind: 'credit_grant', amountCents, note: 'Birthday', createdAt: '2026-10-01T00:00:00Z', createdBy: 'admin' });
const balance = async () => balanceOf(await ledgerFor(scope(), linId));
/** A spend written by a request that died before it reached the row. */
const crashedSpend = (n: number, amountCents: number, createdAt = OLD) =>
  seedDoc('ledger', { id: `spend:${lin().id}:${n}`, groupId: 'bpm', memberId: linId, account: 'member_credit', kind: 'credit_spend', amountCents: -amountCents, note: '', ref: { kind: 'session', id: lin().id, pk: SID }, createdAt, createdBy: linId });
/** The first part lands at 00:00, the crashed second part is written at 01:00, the member looks again at 03:00. */
const atTimes = async (first: () => Promise<unknown>) => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-05T00:00:00Z'));
  await first();
  vi.setSystemTime(new Date('2026-10-05T03:00:00Z'));
};

beforeEach(async () => {
  resetMockStore();
  setupAdminPin();
  grants = 0;
  for (const f of ['NEXT_PUBLIC_FLAG_LEDGER_MIRROR', 'NEXT_PUBLIC_FLAG_STORE_CREDIT', 'NEXT_PUBLIC_FLAG_PAYMENTS_AUTO']) process.env[f] = 'true';
  await seedTestAdminMember();
  seedPointer(SID);
  seedSession(SID, { costPerCourt: 30, courts: 2, datetime: '2026-10-01T19:00:00-04:00' });
  linId = seedMember('Lin').id;
  seedPlayer(SID, 'Lin', { memberId: linId });
  seedPlayer(SID, 'Viktor', { memberId: seedMember('Viktor').id });
  await settle(makeAdminRequest('POST', `${BASE}/session/settle`)); // $30 each
});

afterEach(() => {
  vi.useRealTimers();
  for (const f of ['NEXT_PUBLIC_FLAG_LEDGER_MIRROR', 'NEXT_PUBLIC_FLAG_STORE_CREDIT', 'NEXT_PUBLIC_FLAG_PAYMENTS_AUTO']) delete process.env[f];
});

describe('credit short of the bill', () => {
  it('goes on the line as a part: paid $10 of $30, the rest still owed, the books clean', async () => {
    give(1000);
    expect(await payWithCredit('bpm', linId)).toMatchObject({ paid: 0, part: 1, spentCents: 1000, balanceCents: 0 });
    expect(lin()).toMatchObject({ paid: false, paidAmount: 10, paidVia: 'credit', creditSpends: [`spend:${lin().id}:0`] });
    expect(livePayments(String(lin().id)).map((e) => e.amountCents)).toEqual([-1000]);
    expect(await codes()).toEqual([]);
  });

  it('a second part finishes the line, each with its own spend and payment', async () => {
    give(1000);
    await payWithCredit('bpm', linId);
    give(2000);
    expect(await payWithCredit('bpm', linId)).toMatchObject({ paid: 1, part: 0, spentCents: 2000, balanceCents: 0 });
    const id = String(lin().id);
    expect(lin()).toMatchObject({ paid: true, paidAmount: 30, creditSpends: [`spend:${id}:0`, `spend:${id}:1`] });
    expect(livePayments(id).map((e) => e.amountCents).sort((a, b) => a - b)).toEqual([-2000, -1000]);
    expect(await codes()).toEqual([]);
  });

  it('more credit than the line owes takes only what it owes', async () => {
    give(5000);
    expect(await payWithCredit('bpm', linId)).toMatchObject({ paid: 1, part: 0, spentCents: 3000, balanceCents: 2000 });
    expect(lin()).toMatchObject({ paid: true, paidAmount: 30 });
  });

  it('the rest paid by the organiser\'s tap records only what was still owed', async () => {
    give(1000);
    await payWithCredit('bpm', linId);
    const id = String(lin().id);
    expect((await patchPlayer(makeAdminRequest('PATCH', `${BASE}/players`, { id, paid: true }))).status).toBe(200);
    expect(lin()).toMatchObject({ paid: true, paidAmount: 30 });
    expect(livePayments(id).map((e) => e.amountCents).sort((a, b) => a - b)).toEqual([-2000, -1000]);
    expect(await codes()).toEqual([]);
  });

  it('a stringing job is never part-paid: credit short of it is left alone', async () => {
    Object.assign(lin(), { paid: true, paidVia: 'manual', paidAmount: 30 });
    seedDoc('stringingJobs', {
      id: 'job-1', groupId: 'bpm', memberId: linId, memberName: 'Lin', jobNo: 'J-0001', racketLabel: 'Astrox', stringLabel: 'BG65',
      status: 'ready', priceCents: 2500, paidAt: null, tensionMains: 24, tensionCrosses: 26, createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z',
      stringerId: null, stringerName: null, archivedAt: null, pendingEdit: null, acceptedAt: null, sessionId: null, history: [],
    });
    process.env.NEXT_PUBLIC_FLAG_STRINGING = 'true';
    try {
      give(1000);
      await expect(payWithCredit('bpm', linId)).rejects.toBeInstanceOf(CreditError);
      expect(await balance()).toBe(1000);
    } finally {
      delete process.env.NEXT_PUBLIC_FLAG_STRINGING;
    }
  });
});

describe('a part a crash left half-done', () => {
  it('still owed: the part is finished on the row, never refunded', async () => {
    give(1000);
    crashedSpend(0, 1000);
    const out = await refundStaleSpends(scope(), linId);
    expect(out).toMatchObject({ finished: 1, refunded: 0 });
    expect(lin()).toMatchObject({ paid: false, paidAmount: 10, creditSpends: [`spend:${lin().id}:0`] });
    expect(await balance()).toBe(0);
    expect(await codes()).toEqual([]);
  });

  it('a SECOND part crashed after the first landed is finished too (the first does not hide it)', async () => {
    give(1000);
    await atTimes(() => payWithCredit('bpm', linId)); // part 0 lands: $10
    give(500);
    crashedSpend(1, 500, '2026-10-05T01:00:00Z'); // part 1 died before the row
    const out = await refundStaleSpends(scope(), linId);
    expect(out).toMatchObject({ finished: 1, refunded: 0 });
    expect(lin()).toMatchObject({ paid: false, paidAmount: 15 });
    expect(await balance()).toBe(0);
    expect(await codes()).toEqual([]);
  });

  it('paid another way meanwhile: the crashed part goes back, the landed one stays', async () => {
    give(1000);
    await atTimes(() => payWithCredit('bpm', linId)); // part 0 lands: $10
    give(500);
    crashedSpend(1, 500, '2026-10-05T01:00:00Z');
    // The organiser ticked the rest paid before the member looked again.
    expect((await patchPlayer(makeAdminRequest('PATCH', `${BASE}/players`, { id: lin().id, paid: true }))).status).toBe(200);
    const out = await refundStaleSpends(scope(), linId);
    expect(out).toMatchObject({ finished: 0, refunded: 1 });
    expect(ledger().find((e) => e.id === `refund:${lin().id}:1`)).toMatchObject({ amountCents: 500 });
    expect(await balance()).toBe(500);
    expect(lin()).toMatchObject({ paid: true, paidAmount: 30 });
  });

  it('a part the row records but the mirror never wrote is left as it is (the row says it landed)', async () => {
    delete process.env.NEXT_PUBLIC_FLAG_LEDGER_MIRROR;
    give(1000);
    await payWithCredit('bpm', linId);
    expect(livePayments(String(lin().id))).toHaveLength(0);
    // Long after: nothing is fresh any more, and still nothing moves.
    for (const e of ledger()) if (e.kind === 'credit_spend') e.createdAt = OLD;
    lin().paidAt = OLD;
    lin().creditSpends = [`spend:${lin().id}:0`];
    expect(await refundStaleSpends(scope(), linId)).toMatchObject({ finished: 0, refunded: 0 });
    expect(lin()).toMatchObject({ paid: false, paidAmount: 10 });
    expect(await balance()).toBe(0);
  });

  it('a crashed part bigger than what the line now owes goes back rather than over-paying', async () => {
    give(4000);
    crashedSpend(0, 4000); // more than the $30 bill
    const out = await refundStaleSpends(scope(), linId);
    expect(out).toMatchObject({ finished: 0, refunded: 1 });
    expect(await balance()).toBe(4000);
    expect(lin().paidAmount ?? 0).toBe(0);
  });
});

describe('un-ticking a line credit helped pay', () => {
  it('a part-credit row is refused, filed for review with what credit paid, and returning it clears the row and the credit', async () => {
    give(1000);
    await payWithCredit('bpm', linId);
    const id = String(lin().id);
    const refused = await patchPlayer(makeAdminRequest('PATCH', `${BASE}/players`, { id, paid: false }));
    expect(refused.status).toBe(409);
    expect(await refused.json()).toEqual({ error: 'paid_with_credit' });

    expect((await patchPlayer(makeAdminRequest('PATCH', `${BASE}/players`, { id, paid: false, review: true }))).status).toBe(202);
    expect(reviews()).toHaveLength(1);
    expect(reviews()[0]).toMatchObject({ amountCents: 1000, credit: { amountCents: 1000 } });
    expect(lin()).toMatchObject({ paidAmount: 10 }); // nothing changes until a person decides

    expect((await assign(makeAdminRequest('POST', `${BASE}/admin/payments/assign`, { paymentId: reviews()[0].id, action: 'return_credit' }))).status).toBe(200);
    expect(lin().paid).toBe(false);
    expect(lin().paidAmount).toBeUndefined();
    expect(lin().creditSpends).toBeUndefined();
    expect(livePayments(id)).toHaveLength(0);
    expect(await balance()).toBe(1000);
    // And nothing re-pays it behind the organiser's back.
    for (const e of ledger()) if (e.kind === 'credit_spend' || e.kind === 'credit_refund') e.createdAt = OLD;
    expect(await refundStaleSpends(scope(), linId)).toMatchObject({ finished: 0, refunded: 0 });
    expect(lin().paidAmount).toBeUndefined();
  });

  it('returning the credit after an earlier refund on the same night gives it back, and nothing re-pays it (review finding 2)', async () => {
    give(1000);
    await atTimes(() => payWithCredit('bpm', linId)); // part 0 lands: $10
    give(500);
    crashedSpend(1, 500, '2026-10-05T01:00:00Z');
    const id = String(lin().id);
    await patchPlayer(makeAdminRequest('PATCH', `${BASE}/players`, { id, paid: true }));
    await refundStaleSpends(scope(), linId); // refund:R:1 for the crashed $5
    expect(await balance()).toBe(500);

    expect((await patchPlayer(makeAdminRequest('PATCH', `${BASE}/players`, { id, paid: false, review: true }))).status).toBe(202);
    expect((await assign(makeAdminRequest('POST', `${BASE}/admin/payments/assign`, { paymentId: reviews()[0].id, action: 'return_credit' }))).status).toBe(200);
    expect(await balance()).toBe(1500);
    vi.setSystemTime(new Date('2026-10-06T00:00:00Z'));
    expect(await refundStaleSpends(scope(), linId)).toMatchObject({ finished: 0, refunded: 0 });
    expect(lin().paidAmount).toBeUndefined();
    expect(await balance()).toBe(1500);
  });

  it('a "Use credit" still mid-way is not returned with the rest: it lands or returns itself (review finding 3)', async () => {
    give(1000);
    await atTimes(() => payWithCredit('bpm', linId)); // part 0 lands: $10
    const id = String(lin().id);
    expect((await patchPlayer(makeAdminRequest('PATCH', `${BASE}/players`, { id, paid: false, review: true }))).status).toBe(202);
    // The member taps "Use credit" again just as the organiser returns it: spend 1 is written, not yet on the row.
    give(500);
    crashedSpend(1, 500, new Date().toISOString());
    expect((await assign(makeAdminRequest('POST', `${BASE}/admin/payments/assign`, { paymentId: reviews()[0].id, action: 'return_credit' }))).status).toBe(200);
    expect(ledger().find((e) => e.id === `refund:${id}:0`)).toMatchObject({ amountCents: 1000 });
    expect(ledger().some((e) => e.id === `refund:${id}:1`)).toBe(false);
    expect(await balance()).toBe(1000); // $10 back; the $5 in flight is the other request's
  });

  it('returning gives the credit back BEFORE it voids the payment, so a balance read in between can never land it again (second review)', async () => {
    give(1000);
    await payWithCredit('bpm', linId);
    const id = String(lin().id);
    expect((await patchPlayer(makeAdminRequest('PATCH', `${BASE}/players`, { id, paid: false, review: true }))).status).toBe(202);
    expect((await assign(makeAdminRequest('POST', `${BASE}/admin/payments/assign`, { paymentId: reviews()[0].id, action: 'return_credit' }))).status).toBe(200);
    // At every point a read could fall, the ledger showed the payment live or the refund written.
    const order = ledger().map((e) => e.id);
    const payment = `payment:${id}:spend:${id}:0`;
    expect(order.indexOf(`refund:${id}:0`)).toBeGreaterThan(-1);
    expect(order.indexOf(`refund:${id}:0`)).toBeLessThan(order.indexOf(`void:${payment}`));
  });

  it('a return that stopped after giving the credit back voids the payment on the retry, and gives nothing twice', async () => {
    give(1000);
    await payWithCredit('bpm', linId);
    const id = String(lin().id);
    expect((await patchPlayer(makeAdminRequest('PATCH', `${BASE}/players`, { id, paid: false, review: true }))).status).toBe(202);
    // The first run cleared the row and wrote the refund, then died before the voids.
    Object.assign(lin(), { paid: false, paidAt: undefined, paidVia: undefined, paymentId: undefined, paidAmount: undefined, creditSpends: undefined });
    seedDoc('ledger', { id: `refund:${id}:0`, groupId: 'bpm', memberId: linId, account: 'member_credit', kind: 'credit_refund', amountCents: 1000, note: '', ref: { kind: 'session', id, pk: SID }, createdAt: new Date().toISOString(), createdBy: 'admin' });
    expect(livePayments(id)).toHaveLength(1);
    expect((await assign(makeAdminRequest('POST', `${BASE}/admin/payments/assign`, { paymentId: reviews()[0].id, action: 'return_credit' }))).status).toBe(200);
    expect(livePayments(id)).toHaveLength(0);
    expect(await balance()).toBe(1000);
  });

  it('a row paid partly by credit and the rest by the organiser still goes through the review', async () => {
    give(1000);
    await payWithCredit('bpm', linId);
    const id = String(lin().id);
    await patchPlayer(makeAdminRequest('PATCH', `${BASE}/players`, { id, paid: true }));
    const refused = await patchPlayer(makeAdminRequest('PATCH', `${BASE}/players`, { id, paid: false }));
    expect(refused.status).toBe(409);
    expect(lin()).toMatchObject({ paid: true, paidAmount: 30 });
  });
});
