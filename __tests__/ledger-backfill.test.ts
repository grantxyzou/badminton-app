import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GET as status, POST as backfill } from '@/app/api/admin/ledger-backfill/route';
import { POST as settle } from '@/app/api/session/settle/route';
import { PATCH as patchPurchase } from '@/app/api/birds/route';
import { runLedgerBackfill, ledgerBackfillStatus } from '@/lib/ledgerBackfill';
import { CLUB_LEDGER_ID, UNLINKED_LEDGER_ID, mirrorStringingChanged } from '@/lib/ledgerMirror';
import { groupScope } from '@/lib/groupScope';
import type { LedgerEntry, StringingJob } from '@/lib/types';
import {
  resetMockStore,
  getStore,
  seedPointer,
  seedSession,
  seedPlayer,
  seedMember,
  seedDoc,
  makeRequest,
  makeAdminRequest,
  setupAdminPin,
  seedTestAdminMember,
  adminCookieValue,
} from './helpers';

/**
 * The backfill writes what the mirror would have written for history it never
 * saw — and NOTHING more on a second run, because the ids are the same ones
 * the mirror derives. That equivalence is the whole point: a backfilled past
 * and a mirrored present must sum the same way.
 */

const BASE = 'http://localhost:3000/api';
const KEY = 'test-migration-key-with-16-chars';
const ledger = () => (getStore()['ledger'] ?? []) as LedgerEntry[];
const settled = (at: string, courtTotal = 60) => ({ at, costPerPerson: 12, totalCost: courtTotal, courtTotal, birdTotal: 0, playerCount: 5, playerNames: [] });

let lin: { id: string };
const keyBefore = process.env.MIGRATION_KEY;

beforeEach(async () => {
  resetMockStore();
  setupAdminPin();
  process.env.NEXT_PUBLIC_FLAG_LEDGER_MIRROR = 'true';
  process.env.MIGRATION_KEY = KEY;
  await seedTestAdminMember();
  seedPointer('session-2026-10-08');
  seedSession('session-2026-10-08', { datetime: '2026-10-08T19:00:00-04:00', costPerCourt: 30, courts: 2 });
  lin = seedMember('Lin');
  // Two settled sessions of history, one unsettled, with a mix of rows.
  seedSession('session-2026-09-17', { settled: settled('2026-09-18T00:00:00Z'), datetime: '2026-09-17T19:00:00-04:00' });
  seedSession('session-2026-09-24', { settled: settled('2026-09-25T00:00:00Z'), datetime: '2026-09-24T19:00:00-04:00' });
  seedSession('session-2026-10-01', { datetime: '2026-10-01T19:00:00-04:00' }); // unsettled: no entries
  seedPlayer('session-2026-09-17', 'Lin', { memberId: lin.id, owedAmount: 12, settledAt: '2026-09-18T00:00:00Z', paid: true }); // legacy paid: no paidAt
  seedPlayer('session-2026-09-17', 'Old Row', { owedAmount: 12, settledAt: '2026-09-18T00:00:00Z' }); // no memberId
  seedPlayer('session-2026-09-24', 'Lin', { memberId: lin.id, owedAmount: 12, settledAt: '2026-09-25T00:00:00Z', paid: true, paidAt: '2026-09-26T10:00:00Z', paidVia: 'etransfer', paymentId: 'etx:abc' });
  seedPlayer('session-2026-09-24', 'Viktor', { memberId: seedMember('Viktor').id, owedAmount: 12, settledAt: '2026-09-25T00:00:00Z', writtenOff: true, coverMode: 'absorb' });
  seedPlayer('session-2026-09-24', 'Kento', { memberId: seedMember('Kento').id, owedAmount: 0, settledAt: '2026-09-25T00:00:00Z', writtenOff: true, coverMode: 'resplit' });
  seedPlayer('session-2026-10-01', 'Lin', { memberId: lin.id });
  seedDoc('stringingJobs', { id: 'job-1', groupId: 'bpm', memberId: lin.id, memberName: 'Lin', jobNo: 'J-0001', racketLabel: 'Astrox', stringLabel: 'BG65', status: 'picked_up', priceCents: 3000, paidAt: '2026-09-20T00:00:00Z', createdAt: '2026-09-19T00:00:00Z', updatedAt: '2026-09-20T00:00:00Z', history: [] });
  seedDoc('stringingJobs', { id: 'job-2', groupId: 'bpm', memberId: lin.id, memberName: 'Lin', jobNo: 'J-0002', racketLabel: 'Nanoflare', stringLabel: 'BG65', status: 'strung', priceCents: 3000, paidAt: null, createdAt: '2026-09-21T00:00:00Z', updatedAt: '2026-09-21T00:00:00Z', history: [] }); // not billable yet
  seedDoc('birds', { id: 'p-1', groupId: 'bpm', name: 'Victor', tubes: 10, totalCost: 250, costPerTube: 25, date: '2026-09-01', createdAt: '2026-09-01T00:00:00Z' });
  seedDoc('birds', { id: 'adj-1', groupId: 'bpm', type: 'adjustment', delta: -1, createdAt: '2026-09-02T00:00:00Z' });
});

afterEach(() => {
  delete process.env.NEXT_PUBLIC_FLAG_LEDGER_MIRROR;
  if (keyBefore === undefined) delete process.env.MIGRATION_KEY; else process.env.MIGRATION_KEY = keyBefore;
});

const post = (body: Record<string, unknown>, key: string | null = KEY) =>
  backfill(makeRequest('POST', `${BASE}/admin/ledger-backfill`, body, { Cookie: `admin_session=${adminCookieValue()}`, ...(key ? { 'x-migration-key': key } : {}) }));

describe('the gate', () => {
  it('status is admin-only; a run needs the admin cookie AND the key; unset key is 503', async () => {
    expect((await status(makeRequest('GET', `${BASE}/admin/ledger-backfill`))).status).toBe(401);
    expect((await status(makeAdminRequest('GET', `${BASE}/admin/ledger-backfill`))).status).toBe(200);
    expect((await post({ dryRun: false }, null)).status).toBe(401);
    expect((await post({ dryRun: false }, 'wrong-key-wrong-key-wrong')).status).toBe(401);
    delete process.env.MIGRATION_KEY;
    expect((await post({ dryRun: false })).status).toBe(503);
  });
});

describe('what it writes', () => {
  it('a dry run writes nothing and counts everything; a real run writes it; a second run writes nothing', async () => {
    const dry = await runLedgerBackfill('bpm', { dryRun: true });
    expect(ledger()).toHaveLength(0);
    // sessions: Lin 09-17 charge+legacy payment, Old Row charge, court 09-17; Lin 09-24 charge+payment, Viktor charge+cover, Kento nothing, court 09-24 = 9
    expect(dry.written.sessions).toBe(9);
    expect(dry.written.stringingJobs).toBe(2); // job-1 charge + payment; job-2 not billable
    expect(dry.written.birds).toBe(1);
    expect(dry.remaining).toEqual({});

    const run = await runLedgerBackfill('bpm', { dryRun: false });
    expect(run.written).toEqual({ sessions: 9, stringingJobs: 2, birds: 1 });
    expect(run.failed).toEqual({ sessions: 0, stringingJobs: 0, birds: 0 });
    expect(ledger()).toHaveLength(12);

    const again = await runLedgerBackfill('bpm', { dryRun: false });
    expect(again.written).toEqual({ sessions: 0, stringingJobs: 0, birds: 0 });
    expect(again.existing).toEqual({ sessions: 9, stringingJobs: 2, birds: 1 });
    expect(ledger()).toHaveLength(12);
  });

  it('the entries are the mirror\'s: same ids, same accounts, same partitions', async () => {
    await runLedgerBackfill('bpm', { dryRun: false });
    const byId = new Map(ledger().map((e) => [e.id, e]));
    const linRows = (getStore()['players'] as Array<Record<string, unknown>>).filter((p) => p.name === 'Lin' && p.settledAt);
    const r17 = linRows.find((p) => p.sessionId === 'session-2026-09-17')!;
    const r24 = linRows.find((p) => p.sessionId === 'session-2026-09-24')!;
    expect(byId.get(`charge:${r17.id}:${Date.parse('2026-09-18T00:00:00Z')}`)).toMatchObject({ memberId: lin.id, account: 'member_owed', amountCents: 1200 });
    expect(byId.get(`payment:${r17.id}:legacy`)).toMatchObject({ amountCents: -1200, meta: { via: 'manual' }, createdAt: '2026-09-18T00:00:00Z' });
    expect(byId.get(`payment:${r24.id}:etx:abc`)).toMatchObject({ amountCents: -1200, meta: { via: 'etransfer', paymentId: 'etx:abc' } });
    const old = (getStore()['players'] as Array<Record<string, unknown>>).find((p) => p.name === 'Old Row')!;
    expect(byId.get(`charge:${old.id}:${Date.parse('2026-09-18T00:00:00Z')}`)).toMatchObject({ memberId: UNLINKED_LEDGER_ID });
    const viktor = (getStore()['players'] as Array<Record<string, unknown>>).find((p) => p.name === 'Viktor')!;
    expect(byId.get(`cover:${viktor.id}:${Date.parse('2026-09-25T00:00:00Z')}:0`)).toMatchObject({ amountCents: -1200 });
    expect(byId.get(`court:session-2026-09-24:${Date.parse('2026-09-25T00:00:00Z')}`)).toMatchObject({ memberId: CLUB_LEDGER_ID, account: 'club_outlay', amountCents: 6000 });
    expect(byId.get('charge:job-1:0')).toMatchObject({ amountCents: 3000 });
    expect(byId.get(`payment:job-1:${Date.parse('2026-09-20T00:00:00Z')}`)).toMatchObject({ amountCents: -3000 });
    expect(byId.get('shuttles:p-1')).toMatchObject({ memberId: CLUB_LEDGER_ID, amountCents: 25000 });
    expect([...byId.keys()].some((k) => k.includes('adj-1'))).toBe(false);
    expect([...byId.keys()].some((k) => k.includes('job-2'))).toBe(false);
  });

  it('a backfilled past and a mirrored present agree: settling a new session live, then backfilling, adds nothing', async () => {
    await runLedgerBackfill('bpm', { dryRun: false });
    const before = ledger().length;
    seedPlayer('session-2026-10-08', 'Lin', { memberId: lin.id }); // the active session, live through the mirror
    const live = await settle(makeAdminRequest('POST', `${BASE}/session/settle`));
    expect(live.status).toBe(200);
    const afterLive = ledger().length;
    expect(afterLive).toBeGreaterThan(before);
    const again = await runLedgerBackfill('bpm', { dryRun: false });
    expect(again.written).toEqual({ sessions: 0, stringingJobs: 0, birds: 0 });
    expect(ledger()).toHaveLength(afterLive);
  });

  it('a stringing job paid by e-transfer through the live mirror is not paid twice by the backfill', async () => {
    // Review of #562: a StringingJob has no paidVia/paymentId, so the backfill
    // cannot know HOW a job was paid. The mirror once keyed an e-transfer
    // payment on its paymentId and the backfill on ms(paidAt) — two ids, no
    // 409, the job's owed account ending at price − 2×price.
    const job = (getStore()['stringingJobs'] as StringingJob[]).find((j) => j.id === 'job-2')!;
    const paid: StringingJob = { ...job, status: 'picked_up', paidAt: '2026-09-27T12:00:00Z', updatedAt: '2026-09-27T12:00:00Z' };
    seedDoc('stringingJobs', paid as unknown as Record<string, unknown>);
    await mirrorStringingChanged(groupScope('bpm'), job, paid, 'etransfer', 'etx:job2');
    const livePayments = ledger().filter((e) => e.kind === 'payment' && e.ref?.id === 'job-2');
    expect(livePayments).toHaveLength(1);
    expect(livePayments[0].meta).toMatchObject({ via: 'etransfer', paymentId: 'etx:job2' });

    const r = await runLedgerBackfill('bpm', { dryRun: false });
    expect(r.existing.stringingJobs).toBeGreaterThanOrEqual(1);
    const payments = ledger().filter((e) => e.kind === 'payment' && e.ref?.id === 'job-2');
    expect(payments).toHaveLength(1);
    expect(payments[0].id).toBe(`payment:job-2:${Date.parse('2026-09-27T12:00:00Z')}`);
    const owed = ledger().filter((e) => e.ref?.id === 'job-2' && e.account === 'member_owed').reduce((s, e) => s + e.amountCents, 0);
    expect(owed).toBe(0);
  });

  it('a purchase edited after deploy but before the backfill is counted once, at its current cost', async () => {
    // Review of #562: the adjustment hook wrote only a DELTA and assumed the
    // base entry existed; before the backfill it did not, so the backfill's
    // base (from the current totalCost) plus the delta counted the edit twice.
    const res = await patchPurchase(makeAdminRequest('PATCH', `${BASE}/birds`, { id: 'p-1', totalCost: 300 }));
    expect(res.status).toBe(200);
    const forP1 = () => ledger().filter((e) => e.ref?.id === 'p-1');
    expect(forP1().map((e) => [e.id, e.amountCents])).toEqual([['shuttles:p-1', 30000]]);

    const r = await runLedgerBackfill('bpm', { dryRun: false });
    expect(r.existing.birds).toBe(1);
    expect(forP1().reduce((s, e) => s + e.amountCents, 0)).toBe(30000);

    // Once the base exists, a later edit is a delta on top of it.
    await patchPurchase(makeAdminRequest('PATCH', `${BASE}/birds`, { id: 'p-1', totalCost: 320 }));
    expect(forP1().find((e) => e.id === 'shuttles:p-1:adj:0')).toMatchObject({ kind: 'shuttle_adj', amountCents: 2000 });
    expect(forP1().reduce((s, e) => s + e.amountCents, 0)).toBe(32000);
  });

  it('limit and cursor: a page at a time, resumed from `remaining`', async () => {
    const first = await runLedgerBackfill('bpm', { dryRun: false, limit: 1 });
    expect(first.scanned.sessions).toBe(1);
    expect(first.remaining.sessions).toEqual({ after: '2026-09-17T19:00:00-04:00' });
    const second = await runLedgerBackfill('bpm', { dryRun: false, limit: 1, after: { sessions: first.remaining.sessions!.after, stringingJobs: first.remaining.stringingJobs?.after, birds: first.remaining.birds?.after } });
    expect(second.scanned.sessions).toBe(1);
    expect(second.remaining.sessions).toBeUndefined();
    expect(ledger().filter((e) => e.kind === 'charge' || e.kind === 'court_cost').length).toBeGreaterThanOrEqual(6);
  });

  it('a budget stops the run and says so', async () => {
    const r = await runLedgerBackfill('bpm', { dryRun: false, budget: 3 });
    expect(r.stoppedEarly).toBe('budget');
    expect(Object.keys(r.remaining).length).toBeGreaterThan(0);
  });
});

describe('status', () => {
  it('counts what is missing, and zero after a full run', async () => {
    const before = await ledgerBackfillStatus('bpm');
    expect(before).toMatchObject({ sessionsWithoutEntries: 2, jobsWithoutEntries: 1, purchasesWithoutEntries: 1, ledgerEntries: 0, truncated: false });
    await runLedgerBackfill('bpm', { dryRun: false });
    const after = await ledgerBackfillStatus('bpm');
    expect(after).toMatchObject({ sessionsWithoutEntries: 0, jobsWithoutEntries: 0, purchasesWithoutEntries: 0, ledgerEntries: 12 });
  });

  it('the route returns it', async () => {
    const res = await status(makeAdminRequest('GET', `${BASE}/admin/ledger-backfill`));
    expect(await res.json()).toMatchObject({ sessionsWithoutEntries: 2 });
  });
});
