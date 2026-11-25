import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { POST as settle } from '@/app/api/session/settle/route';
import { PATCH as patchPlayer } from '@/app/api/players/route';
import { POST as assign } from '@/app/api/admin/payments/assign/route';
import { POST as inbound } from '@/app/api/payments/etransfer/route';
import { mintPaymentsKey } from '@/lib/paymentsInbox';
import { computeOwed } from '@/lib/owedBalance';
import { memberPayments } from '@/lib/memberPayments';
import { runReconcile } from '@/lib/ledgerReconcile';
import { groupScope } from '@/lib/groupScope';
import type { EtransferPayment, LedgerEntry, StringingJob } from '@/lib/types';
import { resetMockStore, getStore, seedPointer, seedSession, seedPlayer, seedMember, seedDoc, makeAdminRequest, makeRequest, setupAdminPin, seedTestAdminMember } from './helpers';

/**
 * WHAT WAS ACTUALLY RECEIVED (docs/plans/paid-amount.md, 2026-11-16). A
 * transfer an organiser assigns by hand that falls short of a line leaves
 * the row `paid: false` with `paidAmount` set: it owes the rest, Home says
 * "paid $30 of $45", the ledger holds a payment for what came, and the next
 * payment — a matched e-transfer, a tap — takes the remainder. `paid: true`
 * still means paid in full, so every row from before reads as it did.
 */

const SID = 'session-2026-10-01';
const BASE = 'http://localhost:3000/api';
const AUTH = 'mx.google.com; dkim=pass header.i=@payments.interac.ca header.s=s1; spf=pass smtp.mailfrom=notify@payments.interac.ca; dmarc=pass header.from=payments.interac.ca';
const rows = () => getStore()['players'] as Array<Record<string, unknown>>;
const rowOf = (name: string, sid = SID) => rows().find((p) => p.name === name && p.sessionId === sid)!;
const ledger = () => (getStore()['ledger'] ?? []) as LedgerEntry[];
const payments = () => (getStore()['payments'] ?? []) as EtransferPayment[];
const livePayments = (ref: string) => {
  const voided = new Set(ledger().filter((e) => e.kind === 'void').map((e) => e.id.slice('void:'.length)));
  return ledger().filter((e) => e.kind === 'payment' && e.ref?.id === ref && !voided.has(e.id)).map((e) => [e.id, e.amountCents]);
};
const codes = async () => (await runReconcile('bpm')).mismatches.map((m) => [m.code, m.ledgerCents, m.liveCents]);
const scope = () => groupScope('bpm');
// The pointer sits on a future week (so the October night is a past, unsettled estimate); settle names the night.
const doSettle = (sid = SID) => settle(makeAdminRequest('POST', `${BASE}/session/settle?sessionId=${sid}`));
const tap = (id: string, paid: boolean) => patchPlayer(makeAdminRequest('PATCH', `${BASE}/players`, { id, paid, sessionId: SID }));
const byRef = (paymentId: string, refs: string[]) => assign(makeAdminRequest('POST', `${BASE}/admin/payments/assign`, { paymentId, action: 'assign', memberId: lin.id, refs }));
const owed = async () => computeOwed(scope(), { memberId: lin.id, names: new Set(['Lin']) });
let msg = 0;
const email = (dollars: string) => ({
  messageId: `<m${++msg}@interac>`,
  from: '"Interac e-Transfer" <notify@payments.interac.ca>',
  subject: 'INTERAC e-Transfer: Lin sent you money.',
  body: `Hi Grant,\nLin has sent you $${dollars} (CAD).`,
  date: '2026-10-03T12:00:00Z',
  authResults: AUTH,
});

let lin: { id: string };
let key: string;

function seedTransfer(id: string, cents: number) {
  seedDoc('payments', {
    id, groupId: 'bpm', source: 'etransfer', senderName: 'LIN DAN', amountCents: cents, memo: null, subject: 'x', receivedAt: '2026-10-03T12:00:00Z',
    authenticated: true, status: 'review', reason: 'unknown_sender', allocations: [], createdAt: '2026-10-03T12:00:00Z',
  });
}

beforeEach(async () => {
  resetMockStore();
  setupAdminPin();
  for (const f of ['NEXT_PUBLIC_FLAG_LEDGER_MIRROR', 'NEXT_PUBLIC_FLAG_STRINGING']) process.env[f] = 'true';
  await seedTestAdminMember();
  seedPointer('session-2026-10-08');
  seedSession('session-2026-10-08', { datetime: '2026-10-08T19:00:00-04:00', maxPlayers: 12 });
  // $90 of courts split two ways: $45 each.
  seedSession(SID, { costPerCourt: 45, courts: 2, datetime: '2026-10-01T19:00:00-04:00' });
  lin = seedMember('Lin');
  // Lin's bank name is remembered (a roster name alone never auto-pays, F18).
  seedDoc('clubSettings', { id: 'alias-lin', kind: 'alias', appName: 'Lin', etransferName: 'Lin', memberId: lin.id, groupId: 'bpm' });
  seedPlayer(SID, 'Lin', { memberId: lin.id });
  seedPlayer(SID, 'Viktor', { memberId: seedMember('Viktor').id });
  key = await mintPaymentsKey('bpm');
});

afterEach(() => {
  for (const f of ['NEXT_PUBLIC_FLAG_LEDGER_MIRROR', 'NEXT_PUBLIC_FLAG_STRINGING']) delete process.env[f];
});

describe('a $30 transfer assigned by hand to a $45 line', () => {
  it('part-pays it: the row owes $15, Home says paid $30 of $45, the ledger holds −$30, the check is clean', async () => {
    await doSettle();
    const id = String(rowOf('Lin').id);
    seedTransfer('pay-1', 3000);
    expect((await byRef('pay-1', [id])).status).toBe(200);
    expect(rowOf('Lin')).toMatchObject({ paid: false, owedAmount: 45, paidAmount: 30, paidVia: 'etransfer', paymentId: 'pay-1' });
    expect(payments()[0]).toMatchObject({ status: 'matched', allocations: [{ ref: id, amountCents: 3000, lineCents: 4500 }] });
    const b = await owed();
    expect(b.sessions).toHaveLength(1);
    expect(b.sessions[0]).toMatchObject({ playerId: id, owedAmount: 15, paidAmount: 30, billedAmount: 45, settled: true });
    expect(livePayments(id)).toEqual([[`payment:${id}:pay-1`, -3000]]);
    expect(await codes()).toEqual([]); // charge +45, payment −30, live owes 15
    // Profile's "what you paid" counts the $30 that came, not the $45 bill.
    const months = await memberPayments(scope(), { memberId: lin.id, names: new Set(['Lin']) }, 12);
    expect(months.reduce((s, m) => s + m.sessions, 0)).toBe(3000);
  });

  it('the matched e-transfer for the remaining $15 pays it in full, under its own ledger entry; an un-tick voids both', async () => {
    await doSettle();
    const id = String(rowOf('Lin').id);
    seedTransfer('pay-1', 3000);
    await byRef('pay-1', [id]);
    const res = await inbound(makeRequest('POST', `${BASE}/payments/etransfer`, email('15.00'), { 'x-payments-key': key }));
    expect((await res.json()).status).toBe('matched');
    const second = payments().find((p) => p.id !== 'pay-1')!;
    expect(rowOf('Lin')).toMatchObject({ paid: true, paidAmount: 45, paidVia: 'etransfer', paymentId: second.id });
    expect(livePayments(id).sort()).toEqual([[`payment:${id}:${second.id}`, -1500], [`payment:${id}:pay-1`, -3000]].sort());
    expect((await owed()).sessions).toEqual([]);
    expect(await codes()).toEqual([]);

    expect((await tap(id, false)).status).toBe(200);
    expect(rowOf('Lin')).toMatchObject({ paid: false });
    expect(rowOf('Lin').paidAmount).toBeUndefined();
    expect(livePayments(id)).toEqual([]);
    expect((await owed()).sessions[0]).toMatchObject({ owedAmount: 45 });
    expect(await codes()).toEqual([]);
  });

  it('the admin tap after a part-payment records the whole bill and a payment for the $15 it was still owed', async () => {
    await doSettle();
    const id = String(rowOf('Lin').id);
    seedTransfer('pay-1', 3000);
    await byRef('pay-1', [id]);
    await new Promise((r) => setTimeout(r, 2));
    expect((await tap(id, true)).status).toBe(200);
    const row = rowOf('Lin');
    expect(row).toMatchObject({ paid: true, paidAmount: 45, paidVia: 'manual' });
    expect(row.paymentId).toBeUndefined();
    expect(livePayments(id).sort()).toEqual([[`payment:${id}:${Date.parse(String(row.paidAt))}`, -1500], [`payment:${id}:pay-1`, -3000]].sort());
    expect(await codes()).toEqual([]);
  });

  it('a plain tap on a never-part-paid row records the whole bill', async () => {
    await doSettle();
    const id = String(rowOf('Lin').id);
    await tap(id, true);
    expect(rowOf('Lin')).toMatchObject({ paid: true, paidAmount: 45 });
    expect(livePayments(id)).toEqual([[`payment:${id}:${Date.parse(String(rowOf('Lin').paidAt))}`, -4500]]);
    expect(await codes()).toEqual([]);
  });
});

describe('spread over the lines an organiser chose, oldest first', () => {
  it('$60 over two $45 sessions: the first in full, the second part-paid; a job is whole or left', async () => {
    const S0 = 'session-2026-09-24';
    seedSession(S0, { costPerCourt: 45, courts: 2, datetime: '2026-09-24T19:00:00-04:00' });
    const older = seedPlayer(S0, 'Lin', { memberId: lin.id });
    seedPlayer(S0, 'Viktor', { memberId: rows().find((p) => p.name === 'Viktor')!.memberId as string });
    await doSettle(S0);
    await new Promise((r) => setTimeout(r, 2));
    await doSettle();
    const newer = String(rowOf('Lin').id);
    // A finished, priced job, with the charge the mirror would have written when it became billable.
    seedDoc('stringingJobs', { id: 'job-1', groupId: 'bpm', memberId: lin.id, memberName: 'Lin', status: 'ready', priceCents: 2000, paidAt: null, createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z', history: [] });
    seedDoc('ledger', { id: 'charge:job-1:0', groupId: 'bpm', memberId: lin.id, account: 'member_owed', kind: 'charge', amountCents: 2000, note: 'Stringing J-0001', ref: { kind: 'stringing', id: 'job-1', pk: lin.id }, createdAt: '2026-10-01T00:00:00Z', createdBy: 'system' });
    seedTransfer('pay-1', 6000);
    expect((await byRef('pay-1', [older.id, newer, 'job-1'])).status).toBe(200);
    expect(rowOf('Lin', S0)).toMatchObject({ paid: true, paidAmount: 45 });
    expect(rowOf('Lin')).toMatchObject({ paid: false, paidAmount: 15 });
    expect((getStore()['stringingJobs'] as StringingJob[])[0].paidAt).toBeNull(); // $0 left: a job is never part-paid
    expect(payments()[0]).toMatchObject({ status: 'matched', allocations: [{ ref: older.id, amountCents: 4500 }, { ref: newer, amountCents: 1500 }] });
    const b = await owed();
    expect(b.sessions.map((s) => [s.playerId, s.owedAmount])).toEqual([[newer, 30]]);
    expect(b.stringing.map((j) => j.amount)).toEqual([20]);
    expect(await codes()).toEqual([]);
  });
});

describe('settle makes `paid` follow the money', () => {
  it('a row ticked paid at the estimate records the whole frozen bill', async () => {
    const id = String(rowOf('Lin').id);
    await tap(id, true);
    expect(rowOf('Lin').paidAmount).toBeUndefined(); // no bill yet
    await doSettle();
    expect(rowOf('Lin')).toMatchObject({ paid: true, owedAmount: 45, paidAmount: 45 });
    expect(livePayments(id)).toHaveLength(1);
    expect(await codes()).toEqual([]);
  });

  it('a short transfer assigned to an estimate: settle leaves the row owing the rest, and the ledger agrees', async () => {
    const id = String(rowOf('Lin').id);
    seedTransfer('pay-1', 3000);
    expect((await byRef('pay-1', [id])).status).toBe(200);
    expect(rowOf('Lin')).toMatchObject({ paid: false, paidAmount: 30 });
    expect(livePayments(id)).toEqual([]); // nothing in the ledger until the bill exists
    await doSettle();
    expect(rowOf('Lin')).toMatchObject({ paid: false, owedAmount: 45, paidAmount: 30 });
    expect(livePayments(id)).toEqual([[`payment:${id}:pay-1`, -3000]]);
    expect((await owed()).sessions[0]).toMatchObject({ owedAmount: 15, paidAmount: 30, billedAmount: 45 });
    expect(await codes()).toEqual([]);
  });

  it('a short transfer that turns out to cover the bill marks the row paid', async () => {
    const id = String(rowOf('Lin').id);
    seedTransfer('pay-1', 3000);
    await byRef('pay-1', [id]);
    const s = (getStore()['sessions'] as Array<Record<string, unknown>>).find((x) => x.id === SID)!;
    s.costPerCourt = 30; // $60 over two: $30 each
    await doSettle();
    expect(rowOf('Lin')).toMatchObject({ paid: true, owedAmount: 30, paidAmount: 30 });
    expect(livePayments(id)).toEqual([[`payment:${id}:pay-1`, -3000]]);
    expect(await codes()).toEqual([]);
  });
});
