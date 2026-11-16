import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GET as reconcileGet, POST as reconcilePost } from '@/app/api/admin/ledger/reconcile/route';
import { POST as remind } from '@/app/api/payments/remind/route';
import { GET as inboxGet } from '@/app/api/admin/payments/route';
import { runLedgerBackfill } from '@/lib/ledgerBackfill';
import { runReconcile, reconcileAndRecord, lastReconcile } from '@/lib/ledgerReconcile';
import { computeOwedForRoster, computeOwed } from '@/lib/owedBalance';
import { mintPaymentsKey, readPaymentsSettings } from '@/lib/paymentsInbox';
import { resolveIdentity } from '@/lib/playerIdentity';
import { groupScope } from '@/lib/groupScope';
import type { LedgerEntry, Player, StringingJob } from '@/lib/types';
import { resetMockStore, getStore, seedPointer, seedSession, seedPlayer, seedMember, seedDoc, makeRequest, makeAdminRequest, setupAdminPin, seedTestAdminMember } from './helpers';

/**
 * The reconcile (Phase 2 stage 2) puts the FROZEN lines Home shows a person
 * beside the ledger's open balance for the same rows, and names every
 * disagreement with a reason. Backfilled history must reconcile CLEAN —
 * that is the equivalence the whole phase rests on — and each way the two
 * can drift must be found, with the right code and the right cents.
 */

const BASE = 'http://localhost:3000/api';
const settled = (at: string, courtTotal = 60) => ({ at, costPerPerson: 12, totalCost: courtTotal, courtTotal, birdTotal: 0, playerCount: 5, playerNames: [] });
const players = () => getStore()['players'] as Player[];
const jobs = () => getStore()['stringingJobs'] as StringingJob[];
const ledger = () => (getStore()['ledger'] ?? []) as LedgerEntry[];
const row = (name: string, sessionId: string) => players().find((p) => p.name === name && p.sessionId === sessionId)!;

let lin: { id: string };
let viktor: { id: string };
let kento: { id: string };
const flagsBefore = { stringing: process.env.NEXT_PUBLIC_FLAG_STRINGING, mirror: process.env.NEXT_PUBLIC_FLAG_LEDGER_MIRROR, payments: process.env.NEXT_PUBLIC_FLAG_PAYMENTS_AUTO };

beforeEach(async () => {
  resetMockStore();
  setupAdminPin();
  process.env.NEXT_PUBLIC_FLAG_LEDGER_MIRROR = 'true';
  process.env.NEXT_PUBLIC_FLAG_STRINGING = 'true';
  process.env.NEXT_PUBLIC_FLAG_PAYMENTS_AUTO = 'true';
  await seedTestAdminMember();
  seedPointer('session-2026-10-08');
  seedSession('session-2026-10-08', { datetime: '2026-10-08T19:00:00-04:00', costPerCourt: 30, courts: 2 });
  lin = seedMember('Lin');
  viktor = seedMember('Viktor');
  kento = seedMember('Kento');
  seedSession('session-2026-09-17', { settled: settled('2026-09-18T00:00:00Z'), datetime: '2026-09-17T19:00:00-04:00' });
  seedSession('session-2026-09-24', { settled: settled('2026-09-25T00:00:00Z'), datetime: '2026-09-24T19:00:00-04:00' });
  // Unsettled, past, with a cost: Home shows a LIVE ESTIMATE for it, which the ledger never records.
  seedSession('session-2026-10-01', { datetime: '2026-10-01T19:00:00-04:00', costPerCourt: 30, courts: 2 });
  seedPlayer('session-2026-09-17', 'Lin', { memberId: lin.id, owedAmount: 12, settledAt: '2026-09-18T00:00:00Z', paid: true }); // legacy paid
  seedPlayer('session-2026-09-17', 'Viktor', { memberId: viktor.id, owedAmount: 12, settledAt: '2026-09-18T00:00:00Z' }); // owes
  seedPlayer('session-2026-09-17', 'Old Row', { owedAmount: 12, settledAt: '2026-09-18T00:00:00Z' }); // no memberId, no such member
  seedPlayer('session-2026-09-24', 'Lin', { memberId: lin.id, owedAmount: 12, settledAt: '2026-09-25T00:00:00Z', paid: true, paidAt: '2026-09-26T10:00:00Z', paidVia: 'etransfer', paymentId: 'etx:abc' });
  seedPlayer('session-2026-09-24', 'Viktor', { memberId: viktor.id, owedAmount: 12, settledAt: '2026-09-25T00:00:00Z', writtenOff: true, coverMode: 'absorb' });
  seedPlayer('session-2026-09-24', 'Kento', { memberId: kento.id, owedAmount: 0, settledAt: '2026-09-25T00:00:00Z', writtenOff: true, coverMode: 'resplit' });
  seedPlayer('session-2026-10-01', 'Lin', { memberId: lin.id });
  seedPlayer('session-2026-10-01', 'Viktor', { memberId: viktor.id });
  seedDoc('stringingJobs', { id: 'job-1', groupId: 'bpm', memberId: lin.id, memberName: 'Lin', jobNo: 'J-0001', racketLabel: 'Astrox', stringLabel: 'BG65', status: 'picked_up', priceCents: 3000, paidAt: '2026-09-20T00:00:00Z', createdAt: '2026-09-19T00:00:00Z', updatedAt: '2026-09-20T00:00:00Z', history: [] });
  seedDoc('stringingJobs', { id: 'job-2', groupId: 'bpm', memberId: lin.id, memberName: 'Lin', jobNo: 'J-0002', racketLabel: 'Nanoflare', stringLabel: 'BG65', status: 'ready', priceCents: 2800, paidAt: null, createdAt: '2026-09-21T00:00:00Z', updatedAt: '2026-09-22T00:00:00Z', history: [] }); // billable, owed
});

afterEach(() => {
  for (const [k, v] of [['NEXT_PUBLIC_FLAG_STRINGING', flagsBefore.stringing], ['NEXT_PUBLIC_FLAG_LEDGER_MIRROR', flagsBefore.mirror], ['NEXT_PUBLIC_FLAG_PAYMENTS_AUTO', flagsBefore.payments]] as const) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
});

const backfill = () => runLedgerBackfill('bpm', { dryRun: false });

describe('the roster-wide balance', () => {
  it('answers, per member, exactly what the per-person path answers', async () => {
    const scope = groupScope('bpm');
    const roster = await computeOwedForRoster(scope);
    for (const name of ['Lin', 'Viktor', 'Kento']) {
      const identity = await resolveIdentity({ name }, 'bpm');
      const one = await computeOwed(scope, identity);
      const mine = roster.find((r) => r.memberId === identity.memberId)!;
      expect(mine.balance.sessions.map((s) => [s.playerId, s.owedAmount, s.settled])).toEqual(one.sessions.map((s) => [s.playerId, s.owedAmount, s.settled]));
      expect(mine.balance.stringing.map((c) => [c.jobId, c.amount])).toEqual(one.stringing.map((c) => [c.jobId, c.amount]));
    }
    // And the live estimate for the unsettled session IS there (Home shows it) — the reconcile must leave it out.
    expect(roster.find((r) => r.memberId === viktor.id)!.balance.sessions.some((s) => !s.settled && s.owedAmount > 0)).toBe(true);
  });
});

describe('a backfilled history reconciles clean', () => {
  it('zero mismatches, every frozen line checked, the unlisted row counted and not flagged', async () => {
    await backfill();
    const r = await runReconcile('bpm');
    expect(r.mismatches).toEqual([]);
    // Viktor's 09-17 row, Lin's job-2, and the unlinked Old Row are the open refs; Lin's paid rows net to zero and are not live.
    expect(r.checked).toBe(3);
    expect(r.unlisted).toBe(1);
    expect(r.truncated).toBe(false);
  });

  it('the live estimate for an unsettled session never counts as a missing charge', async () => {
    await backfill();
    const r = await runReconcile('bpm');
    expect(r.mismatches.filter((m) => m.ref.pk === 'session-2026-10-01')).toEqual([]);
  });
});

describe('each way the two can drift', () => {
  it('missing_charge: a settled row the mirror never saw', async () => {
    await backfill();
    seedPlayer('session-2026-09-17', 'Kento', { memberId: kento.id, owedAmount: 15, settledAt: '2026-09-18T00:00:00Z' });
    const r = await runReconcile('bpm');
    expect(r.mismatches.map((m) => [m.code, m.ref.kind, m.ledgerCents, m.liveCents])).toEqual([['missing_charge', 'session', 0, 1500]]);
  });

  it('missing_payment: the row says paid, the ledger still shows it open (a session row and a stringing job)', async () => {
    await backfill();
    row('Viktor', 'session-2026-09-17').paid = true;
    jobs().find((j) => j.id === 'job-2')!.paidAt = '2026-10-01T00:00:00Z';
    const r = await runReconcile('bpm');
    expect(r.mismatches.map((m) => [m.code, m.ref.kind, m.ledgerCents, m.liveCents]).sort()).toEqual([
      ['missing_payment', 'session', 1200, 0],
      ['missing_payment', 'stringing', 2800, 0],
    ]);
  });

  it('stale_charge: the row no longer owes — covered, or the bill was thawed — and the ledger was not told', async () => {
    await backfill();
    row('Viktor', 'session-2026-09-17').writtenOff = true;
    jobs().find((j) => j.id === 'job-2')!.status = 'strung'; // moved backwards: not billable any more
    const r = await runReconcile('bpm');
    expect(r.mismatches.map((m) => [m.code, m.ref.kind, m.ledgerCents, m.liveCents]).sort()).toEqual([
      ['stale_charge', 'session', 1200, 0],
      ['stale_charge', 'stringing', 2800, 0],
    ]);
  });

  it('amount_mismatch: both know the row and disagree on the number', async () => {
    await backfill();
    row('Viktor', 'session-2026-09-17').owedAmount = 20;
    const r = await runReconcile('bpm');
    expect(r.mismatches.map((m) => [m.code, m.memberId, m.ledgerCents, m.liveCents])).toEqual([['amount_mismatch', viktor.id, 1200, 2000]]);
  });

  it('a payment with no charge under it is reported, not summed away', async () => {
    await backfill();
    // Drop the charge entry: the ledger then holds a lone −1200 for the row.
    const store = getStore();
    store['ledger'] = ledger().filter((e) => !(e.kind === 'charge' && e.ref?.id === row('Lin', 'session-2026-09-24').id));
    const r = await runReconcile('bpm');
    expect(r.mismatches.map((m) => [m.code, m.ledgerCents, m.liveCents])).toEqual([['amount_mismatch', -1200, 0]]);
  });

  it('a REMOVED member still owing is not a mismatch — the row is the live side — but paid-and-not-mirrored still is (review of #570)', async () => {
    const gone = seedMember('Akane', { active: false });
    seedPlayer('session-2026-09-17', 'Akane', { memberId: gone.id, owedAmount: 12, settledAt: '2026-09-18T00:00:00Z' });
    await backfill();
    expect((await computeOwedForRoster(groupScope('bpm'))).some((r) => r.memberId === gone.id)).toBe(false); // off the roster
    let r = await runReconcile('bpm');
    expect(r.mismatches).toEqual([]);
    expect(r.unlisted).toBe(2); // Old Row and Akane
    row('Akane', 'session-2026-09-17').paid = true;
    r = await runReconcile('bpm');
    expect(r.mismatches.map((m) => [m.code, m.memberId, m.ledgerCents])).toEqual([['missing_payment', gone.id, 1200]]);
  });

  it('an unlinked row that was since paid is a mismatch too — the person is unknown, the money is not', async () => {
    await backfill();
    row('Old Row', 'session-2026-09-17').paid = true;
    const r = await runReconcile('bpm');
    expect(r.unlisted).toBe(0);
    expect(r.mismatches.map((m) => [m.code, m.memberId])).toEqual([['missing_payment', '~unlinked']]);
  });
});

describe('the daily run and what it leaves behind', () => {
  it('the remind route runs the check with reminders OFF, stores ids and cents, and answers counts only', async () => {
    await backfill();
    row('Viktor', 'session-2026-09-17').owedAmount = 20;
    const key = await mintPaymentsKey('bpm');
    const res = await remind(makeRequest('POST', `${BASE}/payments/remind`, {}, { 'x-payments-key': key }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.skipped).toBe('off');
    expect(body.reconcile).toEqual({ checked: 3, mismatches: 1 });
    expect(JSON.stringify(body)).not.toContain('Viktor');
    const s = await readPaymentsSettings('bpm');
    expect(s?.lastReconcileAt).toEqual(expect.any(String));
    expect(s?.lastReconcileMismatches).toEqual([{ memberId: viktor.id, ref: { kind: 'session', id: row('Viktor', 'session-2026-09-17').id, pk: 'session-2026-09-17' }, code: 'amount_mismatch', ledgerCents: 1200, liveCents: 2000 }]);
    expect(s?.lastReconcileTruncated).toBe(false);
    expect(JSON.stringify(s)).not.toContain('Viktor');
  });

  it('with the mirror off the remind route checks nothing and stores nothing', async () => {
    delete process.env.NEXT_PUBLIC_FLAG_LEDGER_MIRROR;
    const key = await mintPaymentsKey('bpm');
    const body = await (await remind(makeRequest('POST', `${BASE}/payments/remind`, {}, { 'x-payments-key': key }))).json();
    expect(body.reconcile).toBeNull();
    expect((await readPaymentsSettings('bpm'))?.lastReconcileAt).toBeUndefined();
    expect(await lastReconcile('bpm')).toBeNull();
  });

  it('the stored list is capped and says so', async () => {
    // 60 settled rows nobody mirrored → 60 missing charges, 50 stored.
    for (let i = 0; i < 60; i += 1) seedPlayer('session-2026-09-24', `Ghost ${i}`, { memberId: seedMember(`Ghost ${i}`).id, owedAmount: 1, settledAt: '2026-09-25T00:00:00Z' });
    const r = await reconcileAndRecord('bpm');
    expect(r.truncated).toBe(true);
    const s = await readPaymentsSettings('bpm');
    expect(s?.lastReconcileMismatches).toHaveLength(50);
    expect(s?.lastReconcileTruncated).toBe(true);
  });

  it('the inbox summary carries the counts the card warns on', async () => {
    await backfill();
    row('Viktor', 'session-2026-09-17').owedAmount = 20;
    let body = await (await inboxGet(makeAdminRequest('GET', `${BASE}/admin/payments`))).json();
    expect(body.reconcile).toEqual({ lastAt: null, mismatches: 0, truncated: false });
    await reconcileAndRecord('bpm');
    body = await (await inboxGet(makeAdminRequest('GET', `${BASE}/admin/payments`))).json();
    expect(body.reconcile).toEqual({ lastAt: expect.any(String), mismatches: 1, truncated: false });
  });
});

describe('the admin route', () => {
  it('GET is the last check with names joined; POST is "Check now"; both admin-only; 404 with the mirror off', async () => {
    expect((await reconcileGet(makeRequest('GET', `${BASE}/admin/ledger/reconcile`))).status).toBe(401);
    expect((await reconcilePost(makeRequest('POST', `${BASE}/admin/ledger/reconcile`, {}))).status).toBe(401);

    let body = await (await reconcileGet(makeAdminRequest('GET', `${BASE}/admin/ledger/reconcile`))).json();
    expect(body.lastAt).toBeNull();

    await backfill();
    row('Viktor', 'session-2026-09-17').paid = true;
    const posted = await reconcilePost(makeAdminRequest('POST', `${BASE}/admin/ledger/reconcile`, {}));
    expect(posted.status).toBe(200);
    body = await posted.json();
    expect(body.mismatches).toEqual([expect.objectContaining({ code: 'missing_payment', name: 'Viktor', memberId: viktor.id, ledgerCents: 1200 })]);
    expect(body.checked).toBe(3);

    body = await (await reconcileGet(makeAdminRequest('GET', `${BASE}/admin/ledger/reconcile`))).json();
    expect(body.lastAt).toEqual(expect.any(String));
    expect(body.mismatches.map((m: { name: string }) => m.name)).toEqual(['Viktor']);

    delete process.env.NEXT_PUBLIC_FLAG_LEDGER_MIRROR;
    expect((await reconcileGet(makeAdminRequest('GET', `${BASE}/admin/ledger/reconcile`))).status).toBe(404);
    expect((await reconcilePost(makeAdminRequest('POST', `${BASE}/admin/ledger/reconcile`, {}))).status).toBe(404);
  });
});

describe('a plus-one (docs/plans/plus-one.md)', () => {
  it("the guest's share is the host's line on the roster path, charged to the host, and reconciles clean", async () => {
    const guest = seedPlayer('session-2026-09-17', "Alex (Viktor's guest)", {
      guestOf: viktor.id, guestName: 'Alex', owedAmount: 12, settledAt: '2026-09-18T00:00:00Z',
    });
    const roster = await computeOwedForRoster(groupScope('bpm'));
    expect(roster.find((r) => r.memberId === viktor.id)!.balance.sessions.map((s) => s.playerId)).toContain(guest.id);

    await backfill();
    const charge = (getStore()['ledger'] as LedgerEntry[]).find((e) => e.ref?.id === guest.id && e.kind === 'charge');
    expect(charge?.memberId).toBe(viktor.id);
    const r = await runReconcile('bpm');
    expect(r.mismatches).toEqual([]);
    expect(r.unlisted).toBe(1); // still only the legacy Old Row
  });
});

/**
 * A stringing job PAID while it was not billable-shaped — at pickup before its
 * invoice went out, before Ready, or paid and then withdrawn — got a payment
 * and no charge, and a paid job deleted from the archive lost its charge and
 * kept its payment. Both read as "Grant · stringing · ledger −$40 · app $0"
 * on the Ledger check (2026-11-16).
 */
describe('a paid stringing job always has its charge', () => {
  const job = (over: Partial<StringingJob>): StringingJob =>
    ({
      id: 'job-9', groupId: 'bpm', memberId: lin.id, memberName: 'Lin', jobNo: 'J-0009', racketLabel: 'Astrox', stringLabel: 'BG80',
      status: 'ready', priceCents: 4000, paidAt: null, createdAt: '2026-11-16T01:00:00Z', updatedAt: '2026-11-16T01:00:00Z', history: [],
      billOn: 'invoice', ...over,
    }) as StringingJob;
  const live9 = () => ledger().filter((e) => e.ref?.id === 'job-9');
  const net9 = () => live9().reduce((n, e) => n + (e.account === 'member_owed' || e.account === undefined ? e.amountCents : 0), 0);

  beforeEach(async () => {
    await backfill();
  });

  it('paid at pickup before the invoice was sent: a charge and a payment, and the check is clean', async () => {
    const { mirrorStringingChanged } = await import('@/lib/ledgerMirror');
    const before = job({});
    seedDoc('stringingJobs', before as unknown as Record<string, unknown>);
    await mirrorStringingChanged(groupScope('bpm'), before, job({ paidAt: '2026-11-16T02:00:00Z' }));
    expect(live9().map((e) => [e.kind, e.amountCents])).toEqual([['charge', 4000], ['payment', -4000]]);
    expect(net9()).toBe(0);
  });

  it('paid before Ready, then withdrawn: still a charge under the payment', async () => {
    const { mirrorStringingChanged } = await import('@/lib/ledgerMirror');
    const a = job({ status: 'strung', billOn: undefined });
    const b = job({ status: 'strung', billOn: undefined, paidAt: '2026-11-16T02:00:00Z' });
    await mirrorStringingChanged(groupScope('bpm'), a, b);
    await mirrorStringingChanged(groupScope('bpm'), b, { ...b, cancelledAt: '2026-11-16T03:00:00Z' });
    expect(net9()).toBe(0);
  });

  it('un-paying it takes both back out', async () => {
    const { mirrorStringingChanged } = await import('@/lib/ledgerMirror');
    const paid = job({ paidAt: '2026-11-16T02:00:00Z' });
    await mirrorStringingChanged(groupScope('bpm'), job({}), paid);
    await mirrorStringingChanged(groupScope('bpm'), paid, job({}));
    expect(net9()).toBe(0);
    expect(live9().filter((e) => e.kind === 'void').length).toBe(2);
  });

  it('a job left with a lone payment heals the next time anyone touches it', async () => {
    const { mirrorStringingChanged } = await import('@/lib/ledgerMirror');
    const paid = job({ paidAt: '2026-11-16T02:00:00Z' });
    seedDoc('stringingJobs', paid as unknown as Record<string, unknown>);
    seedDoc('ledger', {
      id: 'payment:job-9:1763258400000', groupId: 'bpm', memberId: lin.id, account: 'member_owed', kind: 'payment', amountCents: -4000,
      ref: { kind: 'stringing', id: 'job-9', pk: lin.id }, createdAt: '2026-11-16T02:00:00Z',
    });
    expect((await runReconcile('bpm')).mismatches.map((m) => [m.code, m.ledgerCents])).toEqual([['amount_mismatch', -4000]]);
    await mirrorStringingChanged(groupScope('bpm'), paid, { ...paid, archivedAt: '2026-11-16T03:00:00Z' } as StringingJob);
    expect((await runReconcile('bpm')).mismatches).toEqual([]);
  });

  it('the backfill writes the charge too, for a paid job never invoiced', async () => {
    const { jobEntries } = await import('@/lib/ledgerBackfill');
    expect(jobEntries(job({ paidAt: '2026-11-16T02:00:00Z' })).map((e) => [e.kind, e.amountCents])).toEqual([['charge', 4000], ['payment', -4000]]);
    // Unpaid and not invoiced: nothing yet.
    expect(jobEntries(job({}))).toEqual([]);
  });

  it('deleting a PAID job keeps its charge and payment; an unpaid one loses its charge', async () => {
    const { mirrorStringingChanged, mirrorStringingDeleted } = await import('@/lib/ledgerMirror');
    const paid = job({ billOn: undefined, paidAt: '2026-11-16T02:00:00Z' });
    await mirrorStringingChanged(groupScope('bpm'), job({ billOn: undefined }), paid);
    await mirrorStringingDeleted(groupScope('bpm'), paid);
    expect(net9()).toBe(0);
    expect(live9().some((e) => e.kind === 'void')).toBe(false);

    const unpaid = { ...job({ billOn: undefined }), id: 'job-10' } as StringingJob;
    await mirrorStringingChanged(groupScope('bpm'), { ...unpaid, status: 'strung' } as StringingJob, unpaid);
    await mirrorStringingDeleted(groupScope('bpm'), unpaid);
    expect(ledger().filter((e) => e.ref?.id === 'job-10').reduce((n, e) => n + e.amountCents, 0)).toBe(0);
  });
});

describe('the Ledger check describes each line (GET / POST detail)', () => {
  it('a session line: the night, where the row stands, and its ledger entries', async () => {
    await backfill();
    row('Viktor', 'session-2026-09-17').paid = true;
    const body = await (await reconcilePost(makeAdminRequest('POST', `${BASE}/admin/ledger/reconcile`, {}))).json();
    const [m] = body.mismatches;
    expect(m.detail.subject).toEqual(expect.objectContaining({ kind: 'session', exists: true, date: '2026-09-17', paid: true, settled: true }));
    expect(m.detail.entries.map((e: { kind: string; amountCents: number; voided: boolean }) => [e.kind, e.amountCents, e.voided])).toEqual([['charge', 1200, false]]);
  });

  it('a stringing line: the job number and racket, and a voided charge marked as voided', async () => {
    await backfill();
    // job-2 (Lin, $28, ready, unpaid) loses its charge to a void: the app still shows it owed.
    const charge = ledger().find((e) => e.kind === 'charge' && e.ref?.id === 'job-2')!;
    seedDoc('ledger', { id: `void:${charge.id}`, groupId: 'bpm', memberId: lin.id, account: 'member_owed', kind: 'void', amountCents: -2800, note: 'Reversed: charge', ref: charge.ref, meta: { reason: 'job_deleted' }, createdAt: '2026-11-16T00:00:00Z' });
    const body = await (await reconcilePost(makeAdminRequest('POST', `${BASE}/admin/ledger/reconcile`, {}))).json();
    const m = body.mismatches.find((x: { ref: { id: string } }) => x.ref.id === 'job-2');
    expect(m.detail.subject).toEqual(expect.objectContaining({ kind: 'stringing', exists: true, jobNo: 'J-0002', racket: 'Nanoflare', status: 'ready', paidAt: null }));
    expect(m.detail.entries.map((e: { kind: string; voided: boolean; reason: string | null }) => [e.kind, e.voided, e.reason])).toEqual([
      ['charge', true, null],
      ['void', false, 'job_deleted'],
    ]);
  });
});
