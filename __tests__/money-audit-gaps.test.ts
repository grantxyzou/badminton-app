import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { POST as settle, DELETE as unsettle } from '@/app/api/session/settle/route';
import { PATCH as patchPlayer, DELETE as deletePlayer } from '@/app/api/players/route';
import { POST as createJob } from '@/app/api/stringing/jobs/route';
import { runReconcile } from '@/lib/ledgerReconcile';
import { DELETE as deleteMe } from '@/app/api/members/me/route';
import { _resetMirrorFailures } from '@/lib/ledgerMirror';
import { payWithCredit, refundStaleSpends, UNFINISHED_SPEND_MS } from '@/lib/storeCredit';
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
  makeAdminRequest,
  makeRequest,
  memberCookieValue,
  setupAdminPin,
  seedTestAdminMember,
} from './helpers';

/**
 * EVIDENCE FOR docs/plans/money-audit.md — every test here pins TODAY's
 * answer for a gap the audit found, with exact cents, so the claim is proven
 * rather than asserted. Each one is the WRONG answer on purpose: when the
 * gap is fixed, the test fails, and the fix flips it to the right answer
 * (named in each test's comment). Nothing here changes app code.
 */

const SID = 'session-2026-10-01';
const BASE = 'http://localhost:3000/api';
const ledger = () => (getStore()['ledger'] ?? []) as LedgerEntry[];
const rows = () => getStore()['players'] as Array<Record<string, unknown>>;
const rowOf = (name: string) => rows().find((p) => p.name === name)!;
const live = (refId: string) => {
  const mine = ledger().filter((e) => e.ref?.id === refId && (e.account ?? 'member_credit') === 'member_owed');
  return mine.reduce((sum, e) => sum + e.amountCents, 0);
};
const codes = async () => (await runReconcile('bpm')).mismatches.map((m) => [m.code, m.ref.kind, m.ledgerCents, m.liveCents]);

const flags = ['NEXT_PUBLIC_FLAG_LEDGER_MIRROR', 'NEXT_PUBLIC_FLAG_STRINGING', 'NEXT_PUBLIC_FLAG_STRINGING_INVOICE', 'NEXT_PUBLIC_FLAG_STORE_CREDIT'] as const;
const before: Record<string, string | undefined> = {};

let lin: { id: string };

beforeEach(async () => {
  for (const f of flags) before[f] = process.env[f];
  resetMockStore();
  setupAdminPin();
  _resetMirrorFailures();
  process.env.NEXT_PUBLIC_FLAG_LEDGER_MIRROR = 'true';
  process.env.NEXT_PUBLIC_FLAG_STRINGING = 'true';
  await seedTestAdminMember();
  seedPointer(SID);
  // $60 of courts split two ways: $30 each.
  seedSession(SID, { costPerCourt: 30, courts: 2, datetime: '2026-10-01T19:00:00-04:00' });
  lin = seedMember('Lin');
  seedPlayer(SID, 'Lin', { memberId: lin.id });
  seedPlayer(SID, 'Viktor', { memberId: seedMember('Viktor').id });
});

afterEach(() => {
  for (const f of flags) {
    if (before[f] === undefined) delete process.env[f];
    else process.env[f] = before[f];
  }
});

const doSettle = () => settle(makeAdminRequest('POST', `${BASE}/session/settle`));
const pay = (id: string) => patchPlayer(makeAdminRequest('PATCH', `${BASE}/players`, { id, paid: true }));

describe('GAP 1 — FIXED: hard-deleting a PAID settled row leaves its charge and payment both standing', () => {
  it('purgeOne: the ledger still nets to zero for the row, and the Ledger check is clean', async () => {
    await doSettle();
    const id = String(rowOf('Lin').id);
    expect((await pay(id)).status).toBe(200);
    expect(live(id)).toBe(0); // charge +3000, payment −3000

    const res = await deletePlayer(makeAdminRequest('DELETE', `${BASE}/players`, { purgeOne: id }));
    expect(res.status).toBe(200);
    expect(live(id)).toBe(0);
    expect(ledger().filter((e) => e.kind === 'void')).toEqual([]);
    expect(await codes()).toEqual([]);
  });

  it('purgeAll: the same for every paid row; an unpaid row\'s charge is still voided', async () => {
    await doSettle();
    await pay(String(rowOf('Lin').id));
    const viktor = String(rowOf('Viktor').id);
    const res = await deletePlayer(makeAdminRequest('DELETE', `${BASE}/players`, { purgeAll: true }));
    expect(res.status).toBe(200);
    expect(ledger().filter((e) => e.kind === 'void').map((e) => e.id)).toEqual(ledger().filter((e) => e.kind === 'charge' && e.ref?.id === viktor).map((e) => `void:${e.id}`));
    expect(await codes()).toEqual([]);
  });
});

describe('GAP 2 — FIXED: "Edit the bill" after someone paid keeps their money and re-bills them honestly (docs/plans/paid-amount.md)', () => {
  it('a RAISED bill: Lin paid $30, the bill becomes $45, she owes $15 — and the books agree at every step', async () => {
    await doSettle();
    const id = String(rowOf('Lin').id);
    await pay(id);
    expect((await unsettle(makeAdminRequest('DELETE', `${BASE}/session/settle`))).status).toBe(200);
    expect(rowOf('Lin')).toMatchObject({ paid: true, paidAmount: 30 });
    expect(live(id)).toBe(-3000); // the charge is voided, her payment stands
    expect(await codes()).toEqual([]); // a bill being edited is not a gap
    const s = (getStore()['sessions'] as Array<Record<string, unknown>>).find((x) => x.id === SID)!;
    s.costPerCourt = 45;
    await new Promise((r) => setTimeout(r, 2));
    expect((await doSettle()).status).toBe(200);
    expect(rowOf('Lin')).toMatchObject({ paid: false, owedAmount: 45, paidAmount: 30 });
    expect(live(id)).toBe(1500);
    expect(await codes()).toEqual([]);
  });

  it('a LOWERED bill: Lin paid $30, the bill becomes $20, she stays paid and the club keeps $10 as income', async () => {
    await doSettle();
    const id = String(rowOf('Lin').id);
    await pay(id);
    await unsettle(makeAdminRequest('DELETE', `${BASE}/session/settle`));
    const s = (getStore()['sessions'] as Array<Record<string, unknown>>).find((x) => x.id === SID)!;
    s.costPerCourt = 20;
    await new Promise((r) => setTimeout(r, 2));
    expect((await doSettle()).status).toBe(200);
    expect(rowOf('Lin')).toMatchObject({ paid: true, owedAmount: 20, paidAmount: 30 });
    const kept = ledger().filter((e) => e.kind === 'overpaid');
    expect(kept.map((e) => [e.ref?.id, e.amountCents])).toEqual([[id, 1000]]);
    expect(live(id)).toBe(0); // charge +20, payment −30, kept +10
    expect(await codes()).toEqual([]);

    // Un-ticking her afterwards takes the payment AND what it kept back out,
    // and remembers the $30 she sent.
    expect((await patchPlayer(makeAdminRequest('PATCH', `${BASE}/players`, { id, paid: false }))).status).toBe(200);
    expect(rowOf('Lin')).toMatchObject({ paid: false, unpaidReceived: 30 });
    expect(live(id)).toBe(2000);
    expect(await codes()).toEqual([]);

    // Re-ticked, saying her $30 did come in: paid at $30, and the club's $10 is back.
    await new Promise((r) => setTimeout(r, 2));
    expect((await patchPlayer(makeAdminRequest('PATCH', `${BASE}/players`, { id, paid: true, restoreReceived: true }))).status).toBe(200);
    expect(rowOf('Lin')).toMatchObject({ paid: true, paidAmount: 30 });
    expect(rowOf('Lin').unpaidReceived).toBeUndefined();
    const voided = new Set(ledger().filter((e) => e.kind === 'void').map((e) => e.id.slice('void:'.length)));
    expect(ledger().filter((e) => e.kind === 'overpaid' && !voided.has(e.id)).map((e) => e.amountCents)).toEqual([1000]);
    expect(live(id)).toBe(0); // charge +20, payment −30, kept +10
    expect(await codes()).toEqual([]);
  });

  it('a plain re-tick after the un-tick records just the bill: the kept $10 stays out', async () => {
    await doSettle();
    const id = String(rowOf('Lin').id);
    await pay(id);
    await unsettle(makeAdminRequest('DELETE', `${BASE}/session/settle`));
    const s = (getStore()['sessions'] as Array<Record<string, unknown>>).find((x) => x.id === SID)!;
    s.costPerCourt = 20;
    await new Promise((r) => setTimeout(r, 2));
    await doSettle();
    await patchPlayer(makeAdminRequest('PATCH', `${BASE}/players`, { id, paid: false }));
    await new Promise((r) => setTimeout(r, 2));
    await pay(id);
    expect(rowOf('Lin')).toMatchObject({ paid: true, paidAmount: 20 });
    expect(rowOf('Lin').unpaidReceived).toBeUndefined();
    expect(live(id)).toBe(0); // charge +20, payment −20
    expect(await codes()).toEqual([]);
  });

  it('the way through: un-tick, edit, settle at the new price, tick again — every step leaves the books clean', async () => {
    await doSettle();
    const id = String(rowOf('Lin').id);
    await pay(id);
    expect((await patchPlayer(makeAdminRequest('PATCH', `${BASE}/players`, { id, paid: false }))).status).toBe(200);
    expect(live(id)).toBe(3000); // the payment is voided; Lin owes $30 again
    expect((await unsettle(makeAdminRequest('DELETE', `${BASE}/session/settle`))).status).toBe(200);
    expect(live(id)).toBe(0); // and now the charge is voided too
    const s = (getStore()['sessions'] as Array<Record<string, unknown>>).find((x) => x.id === SID)!;
    s.costPerCourt = 45;
    await new Promise((r) => setTimeout(r, 2));
    expect((await doSettle()).status).toBe(200);
    expect(rowOf('Lin')).toMatchObject({ paid: false, owedAmount: 45 });
    expect(live(id)).toBe(4500);
    expect(await codes()).toEqual([]);
    await new Promise((r) => setTimeout(r, 2));
    await pay(id);
    expect(rowOf('Lin')).toMatchObject({ paid: true, owedAmount: 45 });
    expect(live(id)).toBe(0); // charge +45, payment −45 under a new paidAt
    expect(await codes()).toEqual([]);
  });
});

describe('GAP 3 — FIXED: the admin "paid" tap writes under the etag, so two at once pay once', () => {
  const RealDate = Date;
  afterEach(() => {
    globalThis.Date = RealDate;
  });

  it('two taps on two phones: both answer 200, the row is paid once, the ledger holds ONE payment', async () => {
    await doSettle();
    const id = String(rowOf('Lin').id);
    // Each `new Date()` reads one ms later than the last, as two phones'
    // requests would: without this both taps stamp the same `paidAt` and the
    // second payment id would collide anyway, hiding whether the write raced.
    let tick = 0;
    globalThis.Date = class extends RealDate {
      constructor(...args: unknown[]) {
        if (args.length > 0) super(...(args as [number]));
        else super(RealDate.now() + tick++);
      }
      static now() {
        return RealDate.now() + tick++;
      }
    } as DateConstructor;

    const [a, b] = await Promise.all([pay(id), pay(id)]);
    globalThis.Date = RealDate;
    expect([a.status, b.status]).toEqual([200, 200]);
    // The loser re-read the row, found it already paid, and mirrored nothing.
    const payments = ledger().filter((e) => e.kind === 'payment' && e.ref?.id === id);
    expect(payments).toHaveLength(1);
    expect(live(id)).toBe(0); // charge +30, one payment −30
    expect(await codes()).toEqual([]);
  });
});

describe('GAP 4 — FIXED: an account owing for a finished stringing job cannot be deleted', () => {
  it('DELETE /api/members/me answers 409 balance_outstanding naming the club and the cents; the job and its charge stay', async () => {
    seedDoc('stringingJobs', {
      id: 'job-9', groupId: 'bpm', memberId: lin.id, memberName: 'Lin', jobNo: 'J-0009', racketLabel: 'Astrox', stringLabel: 'BG65',
      status: 'ready', priceCents: 2800, paidAt: null, createdAt: '2026-10-02T00:00:00Z', updatedAt: '2026-10-02T00:00:00Z', history: [],
    });
    seedDoc('ledger', {
      id: 'charge:job-9:0', groupId: 'bpm', memberId: lin.id, account: 'member_owed', kind: 'charge', amountCents: 2800,
      note: 'Stringing · Astrox', ref: { kind: 'stringing', id: 'job-9', pk: lin.id }, createdAt: '2026-10-02T00:00:00Z', createdBy: 'system',
    });
    const res = await deleteMe(makeRequest('DELETE', `${BASE}/members/me`, { confirm: true }, { Cookie: `member_session=${memberCookieValue('Lin', lin.id)}` }));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'balance_outstanding', cents: 2800, clubs: [{ groupId: 'bpm', cents: 2800 }] });
    expect((getStore()['stringingJobs'] as StringingJob[]).find((j) => j.id === 'job-9')).toBeDefined();
    expect(await codes()).toEqual([]);
  });
});

describe('GAP 5 — a job CREATED already finished and priced gets no charge until someone touches it (invoice flag off)', () => {
  it('missing_charge until the next PATCH heals it', async () => {
    delete process.env.NEXT_PUBLIC_FLAG_STRINGING_INVOICE; // bills at Ready, as every pre-invoice job did
    const res = await createJob(makeAdminRequest('POST', `${BASE}/stringing/jobs`, {
      memberId: lin.id, memberName: 'Lin', racketLabel: 'Astrox', stringLabel: 'BG65', tensionMains: 24, tensionCrosses: 26, status: 'ready', priceCents: 2800,
    }));
    expect(res.status).toBe(201);
    const job = (await res.json()).job as StringingJob;
    // TODAY: POST /api/stringing/jobs calls no mirror. FIXED: it calls
    // mirrorStringingChanged(prev = an empty job, next = created).
    expect(ledger().filter((e) => e.ref?.id === job.id)).toEqual([]);
    expect(await codes()).toEqual([['missing_charge', 'stringing', 0, 2800]]);
  });

  it('with the invoice flag ON (production) the same job owes nothing until its invoice, which mirrors — no gap', async () => {
    process.env.NEXT_PUBLIC_FLAG_STRINGING_INVOICE = 'true';
    const res = await createJob(makeAdminRequest('POST', `${BASE}/stringing/jobs`, {
      memberId: lin.id, memberName: 'Lin', racketLabel: 'Astrox', stringLabel: 'BG65', tensionMains: 24, tensionCrosses: 26, status: 'ready', priceCents: 2800,
    }));
    expect(res.status).toBe(201);
    expect(await codes()).toEqual([]);
  });
});

describe('GAP 6 — FIXED: an organiser un-ticks a row paid with store credit through a review', () => {
  it('the un-tick is refused; filed for review it changes nothing, and the next balance read cannot re-pay it', async () => {
    process.env.NEXT_PUBLIC_FLAG_STORE_CREDIT = 'true';
    await doSettle();
    const id = String(rowOf('Lin').id);
    seedDoc('ledger', {
      id: 'grant:test', groupId: 'bpm', memberId: lin.id, account: 'member_credit', kind: 'credit_grant', amountCents: 5000,
      note: 'Birthday', createdAt: '2026-10-01T00:00:00Z', createdBy: 'admin',
    });
    expect((await payWithCredit('bpm', lin.id)).paid).toBe(1);

    const refused = await patchPlayer(makeAdminRequest('PATCH', `${BASE}/players`, { id, paid: false }));
    expect(refused.status).toBe(409);
    expect(await refused.json()).toEqual({ error: 'paid_with_credit' });
    const filed = await patchPlayer(makeAdminRequest('PATCH', `${BASE}/players`, { id, paid: false, review: true }));
    expect(filed.status).toBe(202);
    expect(rowOf('Lin')).toMatchObject({ paid: true, paidVia: 'credit' });
    expect(live(id)).toBe(0); // the payment stands until a person decides

    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + UNFINISHED_SPEND_MS + 1000);
    let r: Awaited<ReturnType<typeof refundStaleSpends>>;
    try {
      r = await refundStaleSpends(groupScope('bpm'), lin.id);
    } finally {
      vi.useRealTimers();
    }
    expect([r.finished, r.refunded]).toEqual([0, 0]);
    expect(await codes()).toEqual([]);
  });
});

describe('GAP 7 — FIXED: "paid" cannot clear a resplit cover past the guard an uncover meets', () => {
  // The clock is pinned and stepped. A charge's ledger id is derived from the
  // row and its settledAt MILLISECOND (`charge:<row>:<ms>`, lib/ledgerMirror.ts),
  // and the ledger is append-only, so a re-settle that lands in the same
  // millisecond as the settle reuses the first charge's id: the $60 charge is
  // refused as a duplicate of the $30 one and the reconcile reads
  // amount_mismatch. On real time that happened in about 1 run in 3. A person
  // cannot settle twice inside a millisecond, so this is a test-timing fault,
  // not an app one.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-18T10:00:00.000Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('on a settled bill someone has paid, paid: true on the resplit-covered row answers 409 paid_would_change and the row keeps its cover', async () => {
    await doSettle();
    const linId = String(rowOf('Lin').id);
    // Lin is covered by resplit: Viktor carries the whole $60.
    expect((await patchPlayer(makeAdminRequest('PATCH', `${BASE}/players`, { id: linId, writtenOff: true, coverMode: 'resplit' }))).status).toBe(200);
    vi.setSystemTime(Date.now() + 1000); // the re-settle is a later moment
    expect((await settle(makeAdminRequest('POST', `${BASE}/session/settle`, { resettle: true }))).status).toBe(200);
    expect(rowOf('Viktor').owedAmount).toBe(60);
    expect(rowOf('Lin')).toMatchObject({ owedAmount: 0, writtenOff: true, coverMode: 'resplit' });
    await pay(String(rowOf('Viktor').id));

    // An uncover is refused here (the bill Viktor paid would move); so is the
    // paid tap, which clears the cover through the paid mutex — the same move.
    expect((await patchPlayer(makeAdminRequest('PATCH', `${BASE}/players`, { id: linId, writtenOff: false }))).status).toBe(409);
    const res = await patchPlayer(makeAdminRequest('PATCH', `${BASE}/players`, { id: linId, paid: true }));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'paid_would_change' });
    expect(rowOf('Lin')).toMatchObject({ paid: false, writtenOff: true, coverMode: 'resplit', owedAmount: 0 });
    expect(await codes()).toEqual([]);
  });
});
