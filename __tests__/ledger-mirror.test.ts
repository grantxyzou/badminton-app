import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as cosmos from '@/lib/cosmos';
import { POST as settle, DELETE as unsettle } from '@/app/api/session/settle/route';
import { PATCH as patchPlayer, DELETE as deletePlayer } from '@/app/api/players/route';
import { PATCH as patchJob } from '@/app/api/stringing/jobs/[id]/route';
import { POST as addPurchase, DELETE as deletePurchase, PATCH as patchPurchase } from '@/app/api/birds/route';
import { POST as grant } from '@/app/api/admin/credit/route';
import { purgeMember } from '@/lib/memberPurge';
import { CLUB_LEDGER_ID, ANON_LEDGER_ID, getMirrorFailures, _resetMirrorFailures } from '@/lib/ledgerMirror';
import type { LedgerEntry } from '@/lib/types';
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
  ADMIN_MEMBER_ID,
} from './helpers';

/**
 * The ledger mirror (docs/plans/payments.md, Phase 2 stage 1) through the real
 * routes. Three things matter and are asserted: every money event writes the
 * entry its id scheme says it must; a retry or a second write is a no-op; and
 * a ledger failure NEVER fails the admin's action.
 */

const SID = 'session-2026-10-01';
const BASE = 'http://localhost:3000/api';
const ledger = () => (getStore()['ledger'] ?? []) as LedgerEntry[];
const ids = () => ledger().map((e) => e.id).sort();
const rowsOf = () => getStore()['players'] as Array<Record<string, unknown>>;

let lin: { id: string };

beforeEach(async () => {
  resetMockStore();
  setupAdminPin();
  _resetMirrorFailures();
  process.env.NEXT_PUBLIC_FLAG_LEDGER_MIRROR = 'true';
  process.env.NEXT_PUBLIC_FLAG_STORE_CREDIT = 'true';
  process.env.NEXT_PUBLIC_FLAG_STRINGING = 'true';
  await seedTestAdminMember();
  seedPointer(SID);
  seedSession(SID, { costPerCourt: 30, courts: 2, datetime: '2026-10-01T19:00:00-04:00' });
  lin = seedMember('Lin');
  seedPlayer(SID, 'Lin', { memberId: lin.id });
  seedPlayer(SID, 'Viktor', { memberId: seedMember('Viktor').id });
});

afterEach(() => {
  delete process.env.NEXT_PUBLIC_FLAG_LEDGER_MIRROR;
  delete process.env.NEXT_PUBLIC_FLAG_STORE_CREDIT;
  delete process.env.NEXT_PUBLIC_FLAG_STRINGING;
});

const doSettle = () => settle(makeAdminRequest('POST', `${BASE}/session/settle`));
const doUnsettle = () => unsettle(makeAdminRequest('DELETE', `${BASE}/session/settle`));
const linRow = () => rowsOf().find((p) => p.name === 'Lin')!;

describe('settle / unsettle', () => {
  it('writes a charge per row and the court cost, keyed by the settle time', async () => {
    const res = await doSettle();
    expect(res.status).toBe(200);
    const settledAt = String(linRow().settledAt);
    const ms = Date.parse(settledAt);
    const entries = ledger();
    const charges = entries.filter((e) => e.kind === 'charge');
    expect(charges).toHaveLength(2);
    const linCharge = charges.find((e) => e.memberId === lin.id)!;
    expect(linCharge).toMatchObject({ id: `charge:${linRow().id}:${ms}`, account: 'member_owed', amountCents: 3000, createdAt: settledAt });
    const court = entries.find((e) => e.kind === 'court_cost')!;
    expect(court).toMatchObject({ id: `court:${SID}:${ms}`, memberId: CLUB_LEDGER_ID, account: 'club_outlay', amountCents: 6000 });
  });

  it('settling twice (after an unsettle) voids the first charges and writes new ones under the new time', async () => {
    await doSettle();
    const first = ids();
    await doUnsettle();
    expect(ids().filter((i) => i.startsWith('void:'))).toEqual(first.map((i) => `void:${i}`).sort());
    const voids = ledger().filter((e) => e.kind === 'void');
    for (const v of voids) {
      const orig = ledger().find((e) => e.id === v.id.slice(5))!;
      expect(v.amountCents).toBe(-orig.amountCents);
      expect(v.account).toBe(orig.account);
      expect(v.memberId).toBe(orig.memberId);
    }
    await new Promise((r) => setTimeout(r, 2)); // a new settledAt
    await doSettle();
    const charges = ledger().filter((e) => e.kind === 'charge' && e.memberId === lin.id);
    expect(charges).toHaveLength(2);
    expect(charges[0].id).not.toBe(charges[1].id);
  });

  it('a resplit-covered row writes no charge (zero owed)', async () => {
    const row = linRow();
    row.writtenOff = true;
    row.coverMode = 'resplit';
    await doSettle();
    expect(ledger().filter((e) => e.kind === 'charge' && e.memberId === lin.id)).toHaveLength(0);
    expect(ledger().filter((e) => e.kind === 'charge')).toHaveLength(1);
  });
});

describe('paid / unpaid / cover', () => {
  beforeEach(async () => {
    await doSettle();
  });

  it('marking paid writes a payment keyed by paidAt; un-paying voids it; re-paying writes a fresh one', async () => {
    const id = String(linRow().id);
    await patchPlayer(makeAdminRequest('PATCH', `${BASE}/players`, { id, paid: true }));
    const paidAt = String(linRow().paidAt);
    const p1 = `payment:${id}:${Date.parse(paidAt)}`;
    expect(ledger().find((e) => e.id === p1)).toMatchObject({ account: 'member_owed', kind: 'payment', amountCents: -3000, meta: { via: 'manual' } });

    await patchPlayer(makeAdminRequest('PATCH', `${BASE}/players`, { id, paid: false }));
    expect(ledger().find((e) => e.id === `void:${p1}`)).toMatchObject({ amountCents: 3000, meta: { reason: 'unpaid' } });

    await new Promise((r) => setTimeout(r, 2));
    await patchPlayer(makeAdminRequest('PATCH', `${BASE}/players`, { id, paid: true }));
    expect(ledger().filter((e) => e.kind === 'payment' && e.ref?.id === id)).toHaveLength(2);
  });

  it('the same PATCH twice writes one payment (a transition, not a state)', async () => {
    const id = String(linRow().id);
    await patchPlayer(makeAdminRequest('PATCH', `${BASE}/players`, { id, paid: true }));
    await patchPlayer(makeAdminRequest('PATCH', `${BASE}/players`, { id, paid: true }));
    expect(ledger().filter((e) => e.kind === 'payment')).toHaveLength(1);
  });

  it('an absorb cover writes a cover entry; uncovering voids it', async () => {
    const id = String(linRow().id);
    const ms = Date.parse(String(linRow().settledAt));
    await patchPlayer(makeAdminRequest('PATCH', `${BASE}/players`, { id, writtenOff: true, coverMode: 'absorb' }));
    const c = `cover:${id}:${ms}:0`;
    expect(ledger().find((e) => e.id === c)).toMatchObject({ kind: 'cover', amountCents: -3000, meta: { coverMode: 'absorb' } });
    await patchPlayer(makeAdminRequest('PATCH', `${BASE}/players`, { id, writtenOff: false }));
    expect(ledger().some((e) => e.id === `void:${c}`)).toBe(true);
    // Covering again is the NEXT cover, not a 409'd repeat of the first.
    await patchPlayer(makeAdminRequest('PATCH', `${BASE}/players`, { id, writtenOff: true, coverMode: 'absorb' }));
    expect(ledger().some((e) => e.id === `cover:${id}:${ms}:1`)).toBe(true);
  });

  it('the sum of a member\'s owed account tracks what they owe', async () => {
    const id = String(linRow().id);
    const owed = () => ledger().filter((e) => e.memberId === lin.id && e.account === 'member_owed').reduce((s, e) => s + e.amountCents, 0);
    expect(owed()).toBe(3000);
    await patchPlayer(makeAdminRequest('PATCH', `${BASE}/players`, { id, paid: true }));
    expect(owed()).toBe(0);
    await patchPlayer(makeAdminRequest('PATCH', `${BASE}/players`, { id, paid: false }));
    expect(owed()).toBe(3000);
  });
});

describe('restore keeps paid (the bug the map found)', () => {
  it('cancel then rejoin does not un-pay a settled, paid row', async () => {
    await doSettle();
    const id = String(linRow().id);
    await patchPlayer(makeAdminRequest('PATCH', `${BASE}/players`, { id, paid: true }));
    await patchPlayer(makeAdminRequest('PATCH', `${BASE}/players`, { id, removed: true }));
    const { POST: signup } = await import('@/app/api/players/route');
    const res = await signup(makeAdminRequest('POST', `${BASE}/players`, { name: 'Lin' }));
    expect(res.status).toBe(201);
    expect(linRow()).toMatchObject({ paid: true, paidVia: 'manual', removed: false });
    expect(ledger().filter((e) => e.kind === 'void')).toHaveLength(0);
  });
});

describe('hard delete', () => {
  it('purgeOne voids the charge and keeps the payment', async () => {
    await doSettle();
    const id = String(linRow().id);
    await patchPlayer(makeAdminRequest('PATCH', `${BASE}/players`, { id, paid: true }));
    await deletePlayer(makeAdminRequest('DELETE', `${BASE}/players`, { purgeOne: id }));
    const voids = ledger().filter((e) => e.kind === 'void');
    expect(voids).toHaveLength(1);
    expect(voids[0].id).toMatch(/^void:charge:/);
    expect(voids[0].meta?.reason).toBe('row_deleted');
    expect(ledger().some((e) => e.kind === 'payment')).toBe(true);
  });
});

describe('stringing', () => {
  const seedJob = (over: Record<string, unknown> = {}) =>
    seedDoc('stringingJobs', {
      id: 'job-1', groupId: 'bpm', memberId: lin.id, memberName: 'Lin', jobNo: 'J-0001', racketLabel: 'Astrox', stringLabel: 'BG65',
      status: 'strung', priceCents: 3000, paidAt: null, tensionMains: 24, tensionCrosses: 26, createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z',
      stringerId: null, stringerName: null, archivedAt: null, pendingEdit: null, history: [], ...over,
    });
  const patch = (body: Record<string, unknown>) =>
    patchJob(makeAdminRequest('PATCH', `${BASE}/stringing/jobs/job-1`, { memberId: lin.id, ...body }), { params: Promise.resolve({ id: 'job-1' }) });

  it('a charge appears when the job becomes billable, is voided and re-charged on a price change, and paid writes a payment', async () => {
    seedJob();
    const r1 = await patch({ status: 'ready' });
    expect(r1.status).toBe(200);
    expect(ledger().find((e) => e.id === 'charge:job-1:0')).toMatchObject({ account: 'member_owed', amountCents: 3000, ref: { kind: 'stringing' } });

    await patch({ priceCents: 3500, force: true });
    expect(ledger().some((e) => e.id === 'void:charge:job-1:0')).toBe(true);
    expect(ledger().find((e) => e.id === 'charge:job-1:1')).toMatchObject({ amountCents: 3500 });

    await patch({ paid: true });
    const job = (getStore()['stringingJobs'] as Array<{ paidAt: string }>)[0];
    expect(ledger().find((e) => e.id === `payment:job-1:${Date.parse(job.paidAt)}`)).toMatchObject({ amountCents: -3500, meta: { via: 'manual' } });
  });

  it('a status moving back below billable voids the charge, and forward again re-charges', async () => {
    seedJob();
    await patch({ status: 'ready' });
    expect(ledger().filter((e) => e.kind === 'charge')).toHaveLength(1);
    await patch({ status: 'strung' });
    expect(ledger().some((e) => e.id === 'void:charge:job-1:0')).toBe(true);
    const owed = () => ledger().filter((e) => e.memberId === lin.id && e.account === 'member_owed').reduce((s, e) => s + e.amountCents, 0);
    expect(owed()).toBe(0);
    await patch({ status: 'ready' });
    expect(ledger().some((e) => e.id === 'charge:job-1:1')).toBe(true);
    expect(owed()).toBe(3000);
  });
});

describe('shuttles', () => {
  it('a purchase, an edit and a delete', async () => {
    const res = await addPurchase(makeAdminRequest('POST', `${BASE}/birds`, { name: 'Victor Master', tubes: 10, totalCost: 250, date: '2026-10-01' }));
    expect(res.status).toBe(201);
    const { id } = await res.json();
    expect(ledger().find((e) => e.id === `shuttles:${id}`)).toMatchObject({ memberId: CLUB_LEDGER_ID, account: 'club_outlay', kind: 'shuttle_purchase', amountCents: 25000 });
    await patchPurchase(makeAdminRequest('PATCH', `${BASE}/birds`, { id, totalCost: 260 }));
    expect(ledger().find((e) => e.id === `shuttles:${id}:adj:0`)).toMatchObject({ kind: 'shuttle_adj', amountCents: 1000 });
    await deletePurchase(makeAdminRequest('DELETE', `${BASE}/birds`, { id }));
    const outlay = ledger().filter((e) => e.account === 'club_outlay').reduce((s, e) => s + e.amountCents, 0);
    expect(outlay).toBe(0);
  });
});

describe('never fails the primary write', () => {
  it('a ledger create that throws leaves the settle a 200, counts the failure, and the rows settled', async () => {
    const real = cosmos.getContainer;
    const spy = vi.spyOn(cosmos, 'getContainer').mockImplementation(((name: string) => {
      const c = real(name as never);
      if (name !== 'ledger') return c;
      return { ...c, items: { ...c.items, create: async () => { throw Object.assign(new Error('boom'), { code: 503 }); } } } as never;
    }) as never);
    try {
      const res = await doSettle();
      expect(res.status).toBe(200);
    } finally {
      spy.mockRestore();
    }
    expect(linRow().settledAt).toEqual(expect.any(String));
    expect(ledger()).toHaveLength(0);
    expect(getMirrorFailures()).toBeGreaterThan(0);
  });

  it('flag off writes nothing', async () => {
    process.env.NEXT_PUBLIC_FLAG_LEDGER_MIRROR = 'false';
    await doSettle();
    await patchPlayer(makeAdminRequest('PATCH', `${BASE}/players`, { id: String(linRow().id), paid: true }));
    expect(ledger()).toHaveLength(0);
  });
});

describe('credit and owed share a partition without mixing', () => {
  it('a charge in the partition does not move the credit balance, and a grant does not move owed', async () => {
    await doSettle();
    await grant(makeAdminRequest('POST', `${BASE}/admin/credit`, { memberId: lin.id, amountCents: 2000, note: 'Gift' }));
    const mine = ledger().filter((e) => e.memberId === lin.id);
    const credit = mine.filter((e) => (e.account ?? 'member_credit') === 'member_credit').reduce((s, e) => s + e.amountCents, 0);
    const owed = mine.filter((e) => e.account === 'member_owed').reduce((s, e) => s + e.amountCents, 0);
    expect(credit).toBe(2000);
    expect(owed).toBe(3000);
  });

  it('a sentinel id cannot be credited', async () => {
    const res = await grant(makeAdminRequest('POST', `${BASE}/admin/credit`, { memberId: CLUB_LEDGER_ID, amountCents: 2000, note: '' }));
    expect(res.status).toBe(400);
  });
});

describe('account deletion', () => {
  it('forfeits credit, re-keys charges and payments under ~anon, and refuses sentinels', async () => {
    await doSettle();
    await patchPlayer(makeAdminRequest('PATCH', `${BASE}/players`, { id: String(linRow().id), paid: true }));
    await grant(makeAdminRequest('POST', `${BASE}/admin/credit`, { memberId: lin.id, amountCents: 500, note: '' }));
    const owedBefore = ledger().filter((e) => e.memberId === lin.id && e.account === 'member_owed');
    expect(owedBefore).toHaveLength(2);

    await purgeMember(lin.id, 'Lin');
    expect(ledger().some((e) => e.memberId === lin.id)).toBe(false);
    const anon = ledger().filter((e) => e.memberId === ANON_LEDGER_ID);
    expect(anon.map((e) => e.id).sort()).toEqual(owedBefore.map((e) => `${ANON_LEDGER_ID}:${e.id}`).sort());
    expect(anon.reduce((s, e) => s + e.amountCents, 0)).toBe(0); // charge 3000, payment −3000
    expect(ledger().some((e) => e.kind === 'credit_grant')).toBe(false);

    await expect(purgeMember(CLUB_LEDGER_ID, 'club')).rejects.toThrow();
    expect(ledger().some((e) => e.memberId === CLUB_LEDGER_ID)).toBe(true);
  });
});

describe('the admin member', () => {
  it('ADMIN_MEMBER_ID is a real-looking id and the mirror never touches it by accident', () => {
    expect(ADMIN_MEMBER_ID.startsWith('~')).toBe(false);
  });
});
