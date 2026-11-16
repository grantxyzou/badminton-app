import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { POST as settle, DELETE as unsettle } from '@/app/api/session/settle/route';
import { PATCH as patchPlayer, DELETE as deletePlayer } from '@/app/api/players/route';
import { POST as createJob } from '@/app/api/stringing/jobs/route';
import { runReconcile } from '@/lib/ledgerReconcile';
import { purgeMember } from '@/lib/memberPurge';
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

describe('GAP 1 — hard-deleting a PAID settled row keeps its payment and voids its charge', () => {
  it('purgeOne: the ledger is left holding −$30 for a row that no longer exists, and the Ledger check flags it', async () => {
    await doSettle();
    const id = String(rowOf('Lin').id);
    expect((await pay(id)).status).toBe(200);
    expect(live(id)).toBe(0); // charge +3000, payment −3000

    const res = await deletePlayer(makeAdminRequest('DELETE', `${BASE}/players`, { purgeOne: id }));
    expect(res.status).toBe(200);

    // TODAY: the charge is voided, the payment stays → −$30 with nothing under it.
    // FIXED: mirrorRowDeleted leaves a PAID row's books alone (as #951 did for
    // stringing), so this reads 0 and the reconcile is clean.
    expect(live(id)).toBe(-3000);
    expect(await codes()).toEqual([['amount_mismatch', 'session', -3000, 0]]);
  });

  it('purgeAll does the same to every paid row of the session', async () => {
    await doSettle();
    await pay(String(rowOf('Lin').id));
    await pay(String(rowOf('Viktor').id));
    const res = await deletePlayer(makeAdminRequest('DELETE', `${BASE}/players`, { purgeAll: true }));
    expect(res.status).toBe(200);
    // TODAY: two −$30 lines. FIXED: none.
    expect((await codes()).sort()).toEqual([
      ['amount_mismatch', 'session', -3000, 0],
      ['amount_mismatch', 'session', -3000, 0],
    ]);
  });
});

describe('GAP 2 — unsettling a session someone already paid keeps their payment and voids their charge', () => {
  it('DELETE /api/session/settle: −$30 open for a row that still says paid', async () => {
    await doSettle();
    const id = String(rowOf('Lin').id);
    await pay(id);
    expect((await unsettle(makeAdminRequest('DELETE', `${BASE}/session/settle`))).status).toBe(200);
    expect(rowOf('Lin').paid).toBe(true); // the route keeps `paid` on purpose
    // TODAY: flagged daily until someone re-settles.
    expect(live(id)).toBe(-3000);
    expect(await codes()).toEqual([['amount_mismatch', 'session', -3000, 0]]);
  });

  it('and a fresh settle at a DIFFERENT price leaves the paid row at a figure nobody paid (the re-settle guard is skipped)', async () => {
    await doSettle();
    const id = String(rowOf('Lin').id);
    await pay(id);
    await unsettle(makeAdminRequest('DELETE', `${BASE}/session/settle`));
    // The admin fixes the court cost: $60 → $90 of courts, $45 each.
    const s = (getStore()['sessions'] as Array<Record<string, unknown>>).find((x) => x.id === SID)!;
    s.costPerCourt = 45;
    await new Promise((r) => setTimeout(r, 2));
    // A plain POST (not `resettle: true`) never runs the `paid_would_change` check.
    expect((await doSettle()).status).toBe(200);
    expect(rowOf('Lin')).toMatchObject({ paid: true, owedAmount: 45 });
    // TODAY: new charge +$45, old payment −$30 (its id is keyed on paidAt, so
    // the settle's payment write 409s) → +$15 open on a row that says paid.
    // FIXED: POST settle refuses `paid_would_change` whenever a row is paid,
    // not only on a re-settle — so this settle answers 409.
    expect(live(id)).toBe(1500);
    expect(await codes()).toEqual([['missing_payment', 'session', 1500, 0]]);
  });
});

describe('GAP 3 — the admin "paid" tap is an unconditional upsert, so two at once both write', () => {
  const RealDate = Date;
  afterEach(() => {
    globalThis.Date = RealDate;
  });

  it('two taps on two phones: the row is paid once and the ledger holds TWO payments', async () => {
    await doSettle();
    const id = String(rowOf('Lin').id);
    // Each `new Date()` reads one ms later than the last, as two phones'
    // requests would. Without this both taps stamp the same `paidAt`, the
    // second payment id collides with the first, and the race hides.
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
    const payments = ledger().filter((e) => e.kind === 'payment' && e.ref?.id === id);
    // TODAY: both requests read `paid !== true`, both upserted, both mirrored
    // under their own `paidAt` → −$60 against a $30 charge.
    // FIXED: PATCH writes with `replace` (etag) like the inbox, card and
    // credit paths; the loser re-reads `paid: true` and writes nothing.
    expect(payments).toHaveLength(2);
    expect(live(id)).toBe(-3000);
    expect(await codes()).toEqual([['amount_mismatch', 'session', -3000, 0]]);
  });
});

describe('GAP 4 — deleting an account with an UNPAID finished stringing job', () => {
  it('the job is deleted, its charge moves to ~anon, and the Ledger check reports it as stale every day with no repair', async () => {
    seedDoc('stringingJobs', {
      id: 'job-9', groupId: 'bpm', memberId: lin.id, memberName: 'Lin', jobNo: 'J-0009', racketLabel: 'Astrox', stringLabel: 'BG65',
      status: 'ready', priceCents: 2800, paidAt: null, createdAt: '2026-10-02T00:00:00Z', updatedAt: '2026-10-02T00:00:00Z', history: [],
    });
    // The charge the mirror wrote when the job reached Ready.
    seedDoc('ledger', {
      id: 'charge:job-9:0', groupId: 'bpm', memberId: lin.id, account: 'member_owed', kind: 'charge', amountCents: 2800,
      note: 'Stringing · Astrox', ref: { kind: 'stringing', id: 'job-9', pk: lin.id }, createdAt: '2026-10-02T00:00:00Z', createdBy: 'system',
    });
    expect(await codes()).toEqual([]);

    await purgeMember(lin.id, 'Lin');
    expect((getStore()['stringingJobs'] as StringingJob[]).find((j) => j.id === 'job-9')).toBeUndefined();
    // TODAY: `rowState` reads the deleted job as gone → stale_charge, forever.
    // FIXED: the reconcile treats a `~anon` ref whose row is gone as unlisted
    // (the club's history, nobody to show it to) — or the purge voids an
    // unpaid stringing charge, since the bill leaves with the account.
    expect(await codes()).toEqual([['stale_charge', 'stringing', 2800, 0]]);
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

describe('GAP 6 — an admin un-ticks a row paid with store credit', () => {
  it('the member\'s next balance read pays it again with the same credit, and the payment cannot be re-mirrored', async () => {
    process.env.NEXT_PUBLIC_FLAG_STORE_CREDIT = 'true';
    await doSettle();
    const id = String(rowOf('Lin').id);
    seedDoc('ledger', {
      id: 'grant:test', groupId: 'bpm', memberId: lin.id, account: 'member_credit', kind: 'credit_grant', amountCents: 5000,
      note: 'Birthday', createdAt: '2026-10-01T00:00:00Z', createdBy: 'admin',
    });
    expect((await payWithCredit('bpm', lin.id)).paid).toBe(1);
    expect(rowOf('Lin')).toMatchObject({ paid: true, paidVia: 'credit' });

    // The admin un-ticks it ("that was a mistake").
    expect((await patchPlayer(makeAdminRequest('PATCH', `${BASE}/players`, { id, paid: false }))).status).toBe(200);
    expect(rowOf('Lin').paid).toBe(false);
    expect(live(id)).toBe(3000); // the payment is voided: the ledger says Lin owes $30

    // Two minutes later Lin opens Home; the balance read reconciles stale spends.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + UNFINISHED_SPEND_MS + 1000);
    let r: Awaited<ReturnType<typeof refundStaleSpends>>;
    try {
      r = await refundStaleSpends(groupScope('bpm'), lin.id);
    } finally {
      vi.useRealTimers();
    }

    // TODAY: the spend is read as a payment that never finished, so the row
    // is marked paid by credit AGAIN (the admin's un-tick is undone without
    // anyone seeing it), and the mirror's payment id — keyed on the spend's
    // time — is the one already written and voided, so it 409s: the row says
    // paid, the ledger says $30 owed.
    // FIXED (Grant to choose): either an un-tick of a credit payment refunds
    // the credit at the same moment (`refund:<ref>:<n>`), or the finish
    // writes its payment under a fresh id.
    expect(r.finished).toBe(1);
    expect(rowOf('Lin')).toMatchObject({ paid: true, paidVia: 'credit' });
    expect(live(id)).toBe(3000);
    expect(await codes()).toEqual([['missing_payment', 'session', 3000, 0]]);
  });
});
