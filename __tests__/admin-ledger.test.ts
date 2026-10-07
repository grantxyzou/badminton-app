import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GET } from '@/app/api/admin/ledger/route';
import { runLedgerBackfill } from '@/lib/ledgerBackfill';
import { reconcileAndRecord } from '@/lib/ledgerReconcile';
import { mintGiftCard } from '@/lib/storeCredit';
import { resetMockStore, setupAdminPin, seedTestAdminMember, makeAdminRequest, makeGetRequest, seedSession, seedPlayer, seedMember, seedDoc, seedPointer } from './helpers';

/**
 * GET /api/admin/ledger is the ONE money view (Phase 2 stage 3). Two sources,
 * never summed together: the ledger's frozen money (income, collected by
 * method, outlay, net, credit liability), and the rows' live answers
 * (`outstanding`, everyone, not range-bound; `unfinalized`, the estimate for
 * unsettled sessions, under its own key). The drill-in lists stay.
 */

setupAdminPin();

const BASE = 'http://localhost:3000/api/admin/ledger';
const DAY = 86_400_000;
const daysAgo = (d: number) => new Date(Date.now() - d * DAY).toISOString();

/** A session with a frozen settle snapshot `daysAgo` days back. */
function settledSession(id: string, days: number, totalCost: number, playerCount: number) {
  const dt = daysAgo(days);
  seedSession(id, {
    datetime: dt,
    settled: { at: dt, costPerPerson: playerCount > 0 ? totalCost / playerCount : 0, totalCost, courtTotal: totalCost, birdTotal: 0, playerCount, playerNames: [] },
  });
  return dt;
}

const get = async (range = '12w') => {
  const res = await GET(makeAdminRequest('GET', `${BASE}?range=${range}`));
  expect(res.status).toBe(200);
  return res.json();
};

const flagsBefore = { mirror: process.env.NEXT_PUBLIC_FLAG_LEDGER_MIRROR, stringing: process.env.NEXT_PUBLIC_FLAG_STRINGING };

describe('GET /api/admin/ledger', () => {
  beforeEach(async () => {
    resetMockStore();
    process.env.NEXT_PUBLIC_FLAG_LEDGER_MIRROR = 'true';
    process.env.NEXT_PUBLIC_FLAG_STRINGING = 'true';
    await seedTestAdminMember();
    seedPointer('session-active');
    seedSession('session-active', { datetime: new Date(Date.now() + 2 * DAY).toISOString(), costPerCourt: 30, courts: 2 });
  });
  afterEach(() => {
    for (const [k, v] of [['NEXT_PUBLIC_FLAG_LEDGER_MIRROR', flagsBefore.mirror], ['NEXT_PUBLIC_FLAG_STRINGING', flagsBefore.stringing]] as const) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  });

  it('returns 401 for a non-admin caller', async () => {
    expect((await GET(makeGetRequest(BASE))).status).toBe(401);
  });

  it('an empty club is all zeros, never-reconciled, nothing unfinalized', async () => {
    const body = await get();
    expect(body.range.key).toBe('12w');
    expect(body.income).toEqual({ sessions: 0, stringing: 0, total: 0 });
    expect(body.collected.total).toBe(0);
    expect(body.outstanding).toEqual({ sessions: 0, stringing: 0, total: 0, people: 0 });
    expect(body.credit).toEqual({ liability: 0, members: 0 });
    expect(body.giftCards).toEqual({ unredeemed: 0, amount: 0 });
    expect(body.outlay.total).toBe(0);
    expect(body.net).toBe(0);
    expect(body.unfinalized).toEqual({ count: 0, estimatedTotal: 0, sessions: [] });
    expect(body.reconcile).toBeNull();
    expect(body.bySession).toEqual([]);
    expect(body.byPlayer).toEqual([]);
  });

  it('the ledger buckets: income, collected by method, covered, outlay, net', async () => {
    const lin = seedMember('Lin');
    const viktor = seedMember('Viktor');
    const at = settledSession('session-a', 7, 30, 3); // dollars on the snapshot; cents in the view
    seedPlayer('session-a', 'Lin', { memberId: lin.id, owedAmount: 10, settledAt: at, paid: true, paidAt: at, paidVia: 'etransfer', paymentId: 'pay-1' });
    seedPlayer('session-a', 'Viktor', { memberId: viktor.id, owedAmount: 10, settledAt: at, writtenOff: true, coverMode: 'absorb' });
    seedPlayer('session-a', 'Kento', { memberId: seedMember('Kento').id, owedAmount: 10, settledAt: at, paid: true, paidAt: at, paidVia: 'manual' });
    seedDoc('payments', { id: 'pay-1', groupId: 'bpm', status: 'matched', matchedBy: 'auto', receivedAt: at });
    seedDoc('stringingJobs', { id: 'job-1', groupId: 'bpm', memberId: lin.id, memberName: 'Lin', jobNo: 'J-0001', racketLabel: 'Astrox', stringLabel: 'BG65', status: 'picked_up', priceCents: 3000, paidAt: daysAgo(5), createdAt: daysAgo(6), updatedAt: daysAgo(5), history: [] });
    seedDoc('birds', { id: 'p-1', groupId: 'bpm', name: 'Victor', tubes: 10, totalCost: 250, costPerTube: 25, date: daysAgo(3).slice(0, 10), createdAt: daysAgo(3) });
    await runLedgerBackfill('bpm', { dryRun: false });

    const body = await get();
    expect(body.income).toEqual({ sessions: 3000, stringing: 3000, total: 6000 });
    expect(body.collected).toEqual({ etransferAuto: 1000, etransferAdmin: 0, manual: 4000, credit: 0, total: 5000 });
    expect(body.covered).toBe(1000);
    expect(body.outlay).toEqual({ courts: 3000, shuttles: 25000, strings: 0, other: 0, total: 28000 });
    expect(body.net).toBe(5000 - 28000);
    // The drill-ins are unchanged in shape.
    expect(body.bySession[0]).toMatchObject({ sessionId: 'session-a', attendanceCount: 3, totalCost: 30, paidCount: 2, coveredCount: 1, unpaidCount: 0, unpaidAmount: 0 });
    expect(body.byPlayer).toEqual([]);
  });

  it('an unsettled past session is an ESTIMATE under its own key — income is untouched', async () => {
    const lin = seedMember('Lin');
    seedSession('session-u', { datetime: daysAgo(3), costPerCourt: 30, courts: 2 });
    seedPlayer('session-u', 'Lin', { memberId: lin.id });
    seedPlayer('session-u', 'Viktor', { memberId: seedMember('Viktor').id });
    seedSession('session-nocost', { datetime: daysAgo(2) }); // no cost → not listed
    seedPlayer('session-nocost', 'Lin', { memberId: lin.id });

    const body = await get();
    expect(body.income.sessions).toBe(0);
    expect(body.unfinalized).toEqual({ count: 1, estimatedTotal: 60, sessions: [{ sessionId: 'session-u', date: expect.any(String), estimatedTotal: 60, players: 2 }] });
    // And it is NOT in "still owed": that is frozen money only.
    expect(body.outstanding.total).toBe(0);
    expect(body.bySession).toEqual([]);
  });

  it('outstanding is live, frozen-only, everyone, and ignores the range', async () => {
    const lin = seedMember('Lin');
    const old = settledSession('session-old', 200, 2400, 2);
    seedPlayer('session-old', 'Lin', { memberId: lin.id, owedAmount: 12, settledAt: old });
    seedPlayer('session-old', 'Viktor', { memberId: seedMember('Viktor').id, owedAmount: 12, settledAt: old, paid: true });
    seedDoc('stringingJobs', { id: 'job-1', groupId: 'bpm', memberId: lin.id, memberName: 'Lin', jobNo: 'J-0001', racketLabel: 'Astrox', stringLabel: 'BG65', status: 'ready', priceCents: 2800, paidAt: null, createdAt: daysAgo(6), updatedAt: daysAgo(5), history: [] });

    const body = await get('30d');
    expect(body.income.sessions).toBe(0); // 200 days ago is outside 30d
    expect(body.bySession).toEqual([]);
    expect(body.outstanding).toEqual({ sessions: 1200, stringing: 2800, total: 4000, people: 1 });
    expect((await get('all')).income.sessions).toBe(0); // nothing backfilled; the rows alone don't make income
  });

  it('credit liability is positive balances only; gift cards are the unredeemed ones', async () => {
    const lin = seedMember('Lin');
    const viktor = seedMember('Viktor');
    seedDoc('ledger', { id: 'g1', groupId: 'bpm', memberId: lin.id, account: 'member_credit', kind: 'credit_grant', amountCents: 2000, note: '', createdAt: daysAgo(400), createdBy: 'a' });
    seedDoc('ledger', { id: 's1', groupId: 'bpm', memberId: lin.id, account: 'member_credit', kind: 'credit_spend', amountCents: -500, note: '', createdAt: daysAgo(399), createdBy: lin.id });
    seedDoc('ledger', { id: 'g2', groupId: 'bpm', memberId: viktor.id, account: 'member_credit', kind: 'credit_grant', amountCents: 1000, note: '', createdAt: daysAgo(1), createdBy: 'a' });
    seedDoc('ledger', { id: 's2', groupId: 'bpm', memberId: viktor.id, account: 'member_credit', kind: 'credit_spend', amountCents: -1500, note: '', createdAt: daysAgo(1), createdBy: viktor.id });
    await mintGiftCard('bpm', { amountCents: 2500, note: 'Birthday', adminId: 'a' });
    await mintGiftCard('bpm', { amountCents: 1000, note: 'Raffle', adminId: 'a' });

    const body = await get('30d');
    expect(body.credit).toEqual({ liability: 1500, members: 1 }); // Lin's 400-day-old credit still counts; Viktor's negative partition does not
    expect(body.giftCards).toEqual({ unredeemed: 2, amount: 3500 });
  });

  it('carries the last reconcile, and the range chips move the window', async () => {
    const lin = seedMember('Lin');
    const near = settledSession('session-near', 7, 1200, 1);
    seedPlayer('session-near', 'Lin', { memberId: lin.id, owedAmount: 12, settledAt: near });
    const far = settledSession('session-far', 60, 1200, 1);
    seedPlayer('session-far', 'Lin', { memberId: lin.id, owedAmount: 12, settledAt: far });
    await runLedgerBackfill('bpm', { dryRun: false });
    await reconcileAndRecord('bpm');

    const d30 = await get('30d');
    expect(d30.income.sessions).toBe(1200);
    expect(d30.bySession.map((s: { sessionId: string }) => s.sessionId)).toEqual(['session-near']);
    const all = await get('all');
    expect(all.income.sessions).toBe(2400);
    expect(all.bySession).toHaveLength(2);
    expect(all.reconcile).toEqual({ lastAt: expect.any(String), mismatches: 0, unlisted: 0, truncated: false });
    expect(all.byPlayer).toEqual([{ memberId: lin.id, name: 'Lin', sessionCount: 2, owedAmount: 24 }]);
  });

  it('defaults to 12 weeks when the range is absent or invalid', async () => {
    expect((await (await GET(makeAdminRequest('GET', BASE))).json()).range.key).toBe('12w');
    expect((await (await GET(makeAdminRequest('GET', `${BASE}?range=nope`))).json()).range.key).toBe('12w');
  });
});
