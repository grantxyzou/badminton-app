import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { POST as settle } from '@/app/api/session/settle/route';
import { PATCH as patchPlayer } from '@/app/api/players/route';
import { PATCH as patchJob } from '@/app/api/stringing/jobs/[id]/route';
import { GET as inbox } from '@/app/api/admin/payments/route';
import { POST as assign } from '@/app/api/admin/payments/assign/route';
import { payWithCredit, refundStaleSpends, balanceOf, ledgerFor, UNFINISHED_SPEND_MS } from '@/lib/storeCredit';
import { groupScope } from '@/lib/groupScope';
import { runReconcile } from '@/lib/ledgerReconcile';
import type { EtransferPayment, LedgerEntry, StringingJob } from '@/lib/types';
import { resetMockStore, getStore, seedPointer, seedSession, seedPlayer, seedMember, seedDoc, makeAdminRequest, setupAdminPin, seedTestAdminMember } from './helpers';
import { vi } from 'vitest';

/**
 * UN-TICKING A CREDIT PAYMENT GOES THROUGH A REVIEW (docs/plans/money-audit.md,
 * gap 6; Grant, 2026-11-16). The un-tick is refused; with `review: true` it
 * files a row under "Needs a look" and changes nothing. There the organiser
 * returns the credit (un-tick + refund, one server action, idempotent) or
 * keeps it paid. Until then the row stands, so the member's next balance read
 * cannot quietly re-pay it — the bug this closes.
 */

const SID = 'session-2026-10-01';
const BASE = 'http://localhost:3000/api';
const rows = () => getStore()['players'] as Array<Record<string, unknown>>;
const rowOf = (name: string) => rows().find((p) => p.name === name)!;
const payments = () => ((getStore()['payments'] ?? []) as EtransferPayment[]).filter((p) => p.source === 'credit');
const ledger = () => (getStore()['ledger'] ?? []) as LedgerEntry[];
const job = () => (getStore()['stringingJobs'] as StringingJob[]).find((j) => j.id === 'job-1')!;
const scope = () => groupScope('bpm');
const codes = async () => (await runReconcile('bpm')).mismatches.map((m) => [m.code, m.ledgerCents, m.liveCents]);
const resolve = (body: Record<string, unknown>) => assign(makeAdminRequest('POST', `${BASE}/admin/payments/assign`, body));
const review = async () => ((await (await inbox(makeAdminRequest('GET', `${BASE}/admin/payments`))).json()) as { review: EtransferPayment[] }).review;
const livePayments = (ref: string) => {
  const voided = new Set(ledger().filter((e) => e.kind === 'void').map((e) => e.id.slice('void:'.length)));
  return ledger().filter((e) => e.kind === 'payment' && e.ref?.id === ref && !voided.has(e.id));
};

let lin: { id: string };

beforeEach(async () => {
  resetMockStore();
  setupAdminPin();
  for (const f of ['NEXT_PUBLIC_FLAG_LEDGER_MIRROR', 'NEXT_PUBLIC_FLAG_STRINGING']) process.env[f] = 'true';
  await seedTestAdminMember();
  seedPointer(SID);
  seedSession(SID, { costPerCourt: 30, courts: 2, datetime: '2026-10-01T19:00:00-04:00' });
  lin = seedMember('Lin');
  seedPlayer(SID, 'Lin', { memberId: lin.id });
  seedPlayer(SID, 'Viktor', { memberId: seedMember('Viktor').id });
  await settle(makeAdminRequest('POST', `${BASE}/session/settle`));
  seedDoc('ledger', { id: 'grant:t', groupId: 'bpm', memberId: lin.id, account: 'member_credit', kind: 'credit_grant', amountCents: 5000, note: 'Birthday', createdAt: '2026-10-01T00:00:00Z', createdBy: 'admin' });
});

afterEach(() => {
  vi.useRealTimers();
  for (const f of ['NEXT_PUBLIC_FLAG_LEDGER_MIRROR', 'NEXT_PUBLIC_FLAG_STRINGING']) delete process.env[f];
});

const balance = async () => balanceOf(await ledgerFor(scope(), lin.id));

describe('a session row paid with credit', () => {
  it('the plain un-tick is refused; with review it files a row and changes nothing', async () => {
    expect((await payWithCredit('bpm', lin.id)).paid).toBe(1);
    const id = String(rowOf('Lin').id);
    expect(await balance()).toBe(2000);

    const refused = await patchPlayer(makeAdminRequest('PATCH', `${BASE}/players`, { id, paid: false }));
    expect(refused.status).toBe(409);
    expect(await refused.json()).toEqual({ error: 'paid_with_credit' });
    expect(rowOf('Lin')).toMatchObject({ paid: true, paidVia: 'credit' });

    const filed = await patchPlayer(makeAdminRequest('PATCH', `${BASE}/players`, { id, paid: false, review: true }));
    expect(filed.status).toBe(202);
    expect(rowOf('Lin')).toMatchObject({ paid: true, paidVia: 'credit' });
    expect(livePayments(id)).toHaveLength(1);
    const [r] = payments();
    expect(r).toMatchObject({ source: 'credit', status: 'review', reason: 'credit_untick', amountCents: 3000, memberId: lin.id, senderName: 'Lin', credit: { kind: 'session', ref: id, pk: SID, memberId: lin.id, amountCents: 3000 } });
    expect((await review()).map((p) => p.id)).toEqual([r.id]);

    // A second un-tick finds the same row.
    await patchPlayer(makeAdminRequest('PATCH', `${BASE}/players`, { id, paid: false, review: true }));
    expect(payments()).toHaveLength(1);
  });

  it('RETURN: un-ticks the row, voids the payment, gives the credit back — and the next balance read does not re-pay it', async () => {
    await payWithCredit('bpm', lin.id);
    const id = String(rowOf('Lin').id);
    await patchPlayer(makeAdminRequest('PATCH', `${BASE}/players`, { id, paid: false, review: true }));
    const res = await resolve({ paymentId: payments()[0].id, action: 'return_credit' });
    expect(res.status).toBe(200);
    expect(rowOf('Lin').paid).toBe(false);
    expect(rowOf('Lin').paidVia).toBeUndefined();
    expect(livePayments(id)).toEqual([]);
    expect(ledger().filter((e) => e.kind === 'credit_refund').map((e) => [e.id, e.amountCents])).toEqual([[`refund:${id}:0`, 3000]]);
    expect(await balance()).toBe(5000);
    expect(payments()[0]).toMatchObject({ status: 'matched' });

    // Two minutes later Lin opens Home: the spend is fully refunded, so nothing is "stale".
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + UNFINISHED_SPEND_MS + 1000);
    const r = await refundStaleSpends(scope(), lin.id);
    vi.useRealTimers();
    expect([r.finished, r.refunded]).toEqual([0, 0]);
    expect(rowOf('Lin').paid).toBe(false);
    expect(await codes()).toEqual([]); // charge +30 open, live owes 30

    // Returning again does nothing more.
    expect((await resolve({ paymentId: payments()[0].id, action: 'return_credit' })).status).toBe(409);
    expect(await balance()).toBe(5000);
  });

  it('KEEP: dismiss leaves the row paid and the credit spent; assign is refused', async () => {
    await payWithCredit('bpm', lin.id);
    const id = String(rowOf('Lin').id);
    await patchPlayer(makeAdminRequest('PATCH', `${BASE}/players`, { id, paid: false, review: true }));
    const pid = payments()[0].id;
    expect((await resolve({ paymentId: pid, action: 'assign', name: 'Lin', refs: [id] })).status).toBe(409);
    expect((await resolve({ paymentId: pid, action: 'ignore' })).status).toBe(200);
    expect(rowOf('Lin')).toMatchObject({ paid: true, paidVia: 'credit' });
    expect(await balance()).toBe(2000);
    expect(payments()[0].status).toBe('ignored');
  });

  it('RETURN after the row was already un-ticked some other way still gives the credit back once', async () => {
    await payWithCredit('bpm', lin.id);
    const id = String(rowOf('Lin').id);
    await patchPlayer(makeAdminRequest('PATCH', `${BASE}/players`, { id, paid: false, review: true }));
    // An older client un-ticked it directly (no credit refund).
    Object.assign(rowOf('Lin'), { paid: false, paidAt: undefined, paidVia: undefined });
    const res = await resolve({ paymentId: payments()[0].id, action: 'return_credit' });
    expect(res.status).toBe(200);
    expect(await balance()).toBe(5000);
  });
});

describe('a stringing job paid with credit', () => {
  beforeEach(() => {
    seedDoc('stringingJobs', {
      id: 'job-1', groupId: 'bpm', memberId: lin.id, memberName: 'Lin', jobNo: 'J-0001', racketLabel: 'Astrox', stringLabel: 'BG65',
      status: 'ready', priceCents: 1500, paidAt: null, tensionMains: 24, tensionCrosses: 26, createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z',
      stringerId: null, stringerName: null, archivedAt: null, pendingEdit: null, acceptedAt: null, sessionId: null, history: [],
    });
  });
  const bench = (body: Record<string, unknown>) =>
    patchJob(makeAdminRequest('PATCH', `${BASE}/stringing/jobs/job-1`, { memberId: lin.id, ...body }), { params: Promise.resolve({ id: 'job-1' }) } as never);

  it('refused, filed, returned', async () => {
    expect((await payWithCredit('bpm', lin.id)).paid).toBe(2); // the session row and the job
    expect(job()).toMatchObject({ paidVia: 'credit' });
    expect((await bench({ paid: false })).status).toBe(409);
    expect((await bench({ paid: false, review: true })).status).toBe(202);
    expect(job().paidAt).not.toBeNull();
    const r = payments().find((p) => p.credit?.kind === 'stringing')!;
    expect(r).toMatchObject({ amountCents: 1500, credit: { ref: 'job-1', pk: lin.id } });
    expect((await resolve({ paymentId: r.id, action: 'return_credit' })).status).toBe(200);
    expect(job().paidAt).toBeNull();
    expect(job().paidVia).toBeUndefined();
    expect(livePayments('job-1')).toEqual([]);
    expect(await balance()).toBe(5000 - 3000); // the session row's credit is still spent
  });
});
