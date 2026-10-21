import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PATCH as patchJob } from '@/app/api/stringing/jobs/[id]/route';
import { sumAccount } from '@/lib/storeCredit';
import type { LedgerEntry, StringingJob } from '@/lib/types';
import {
  resetMockStore,
  getStore,
  seedMember,
  seedDoc,
  makeAdminRequest,
  setupAdminPin,
  seedTestAdminMember,
} from './helpers';

/**
 * A PAID stringing job cannot be re-priced (review of money accuracy,
 * 2026-10-21).
 *
 * The ledger's payment entry is `payment:<job>:<ms(paidAt)>` at the price
 * paid, and ids are derived, never minted — so a forced re-price of a paid job
 * left that entry at the old amount beside a new charge: the job's owed
 * account netted to new − old while the row said paid, and the reconcile
 * reported it every day with no repair. The route refuses; the correction is
 * unpaid → re-price → paid, which this file walks end to end.
 */

const BASE = 'http://localhost:3000/api';
const ledger = () => (getStore()['ledger'] ?? []) as LedgerEntry[];
const jobRow = () => (getStore()['stringingJobs'] as StringingJob[]).find((j) => j.id === 'job-1')!;
const owedForJob = () =>
  sumAccount(ledger().filter((e) => e.ref?.kind === 'stringing' && e.ref.id === 'job-1'), 'member_owed');

let lin: { id: string };
const PAID_AT = '2026-10-02T18:00:00.000Z';

beforeEach(async () => {
  resetMockStore();
  setupAdminPin();
  process.env.NEXT_PUBLIC_FLAG_LEDGER_MIRROR = 'true';
  process.env.NEXT_PUBLIC_FLAG_STRINGING = 'true';
  await seedTestAdminMember();
  lin = seedMember('Lin');
});

afterEach(() => {
  delete process.env.NEXT_PUBLIC_FLAG_LEDGER_MIRROR;
  delete process.env.NEXT_PUBLIC_FLAG_STRINGING;
});

/** A billable job, already told its price, with the ledger as the live mirror would have left it. */
function seedPaidJob(over: Record<string, unknown> = {}) {
  seedDoc('stringingJobs', {
    id: 'job-1', groupId: 'bpm', memberId: lin.id, memberName: 'Lin', jobNo: 'J-0001', racketLabel: 'Astrox', stringLabel: 'BG65',
    status: 'ready', priceCents: 3000, paidAt: PAID_AT, tensionMains: 24, tensionCrosses: 26,
    createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z',
    stringerId: null, stringerName: null, archivedAt: null, pendingEdit: null, history: [], ...over,
  });
  seedDoc('ledger', {
    id: 'charge:job-1:0', groupId: 'bpm', memberId: lin.id, account: 'member_owed', kind: 'charge', amountCents: 3000,
    note: 'Stringing · Astrox', ref: { kind: 'stringing', id: 'job-1', pk: lin.id }, createdAt: '2026-10-01T00:00:00Z',
  });
  seedDoc('ledger', {
    id: `payment:job-1:${Date.parse(PAID_AT)}`, groupId: 'bpm', memberId: lin.id, account: 'member_owed', kind: 'payment', amountCents: -3000,
    note: 'Marked paid', ref: { kind: 'stringing', id: 'job-1', pk: lin.id }, meta: { via: 'manual' }, createdAt: PAID_AT,
  });
}

const patch = (body: Record<string, unknown>) =>
  patchJob(makeAdminRequest('PATCH', `${BASE}/stringing/jobs/job-1`, { memberId: lin.id, ...body }), {
    params: Promise.resolve({ id: 'job-1' }),
  });

describe('a paid job cannot be re-priced', () => {
  it('refuses a forced price change with 409 job_paid and leaves the job and the ledger untouched', async () => {
    seedPaidJob();
    const before = { ...jobRow() };
    const ledgerBefore = ledger().map((e) => e.id).sort();

    const res = await patch({ priceCents: 3500, force: true });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('job_paid');

    expect(jobRow()).toEqual(before);
    expect(ledger().map((e) => e.id).sort()).toEqual(ledgerBefore);
    expect(owedForJob()).toBe(0);
  });

  it('refuses the same change without force too — job_paid, not confirm_required', async () => {
    seedPaidJob();
    const res = await patch({ priceCents: 3500 });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('job_paid');
  });

  it('refuses asking the player to agree to a new price on a paid bill', async () => {
    seedPaidJob();
    const res = await patch({ propose: { priceCents: 3500 } });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('job_paid');
    expect(jobRow().pendingEdit).toBeNull();
  });

  it('still lets a paid job be edited in every other way, and re-sent its OWN price', async () => {
    seedPaidJob();
    // The detail screen spreads its whole body, so the current price riding
    // along with a status tap must not trip the guard.
    const r1 = await patch({ status: 'picked_up', priceCents: 3000 });
    expect(r1.status).toBe(200);
    expect(jobRow().status).toBe('picked_up');
    // A proposal that changes the string but not the price is a question
    // about the racket, not the bill.
    const r2 = await patch({ propose: { stringLabel: 'BG80' } });
    expect(r2.status).toBe(200);
    expect(jobRow().pendingEdit?.stringLabel).toBe('BG80');
  });
});

describe('the correction path: unpaid → re-price → paid', () => {
  it('leaves the ledger with the voided old charge and payment, a new charge and a new payment, netting to zero', async () => {
    seedPaidJob();

    const r1 = await patch({ paid: false });
    expect(r1.status).toBe(200);
    expect(ledger().some((e) => e.id === `void:payment:job-1:${Date.parse(PAID_AT)}`)).toBe(true);
    expect(owedForJob()).toBe(3000);

    const r2 = await patch({ priceCents: 3500, force: true });
    expect(r2.status).toBe(200);
    expect(ledger().some((e) => e.id === 'void:charge:job-1:0')).toBe(true);
    expect(ledger().find((e) => e.id === 'charge:job-1:1')).toMatchObject({ account: 'member_owed', amountCents: 3500 });
    expect(owedForJob()).toBe(3500);

    const r3 = await patch({ paid: true });
    expect(r3.status).toBe(200);
    const paidAt = jobRow().paidAt!;
    expect(paidAt).not.toBe(PAID_AT);
    const newPayment = ledger().find((e) => e.id === `payment:job-1:${Date.parse(paidAt)}`)!;
    expect(newPayment).toMatchObject({ account: 'member_owed', kind: 'payment', amountCents: -3500 });
    expect(owedForJob()).toBe(0);
  });

  it('accepts `paid: false` and the new price in ONE call — the mirror sees both transitions', async () => {
    seedPaidJob();

    const res = await patch({ paid: false, priceCents: 3500, force: true });
    expect(res.status).toBe(200);
    expect(jobRow()).toMatchObject({ paidAt: null, priceCents: 3500 });
    const ids = ledger().map((e) => e.id);
    expect(ids).toContain(`void:payment:job-1:${Date.parse(PAID_AT)}`);
    expect(ids).toContain('void:charge:job-1:0');
    expect(ledger().find((e) => e.id === 'charge:job-1:1')).toMatchObject({ amountCents: 3500 });
    expect(owedForJob()).toBe(3500);

    await patch({ paid: true });
    expect(ledger().find((e) => e.id === `payment:job-1:${Date.parse(jobRow().paidAt!)}`)).toMatchObject({ amountCents: -3500 });
    expect(owedForJob()).toBe(0);
  });

  it('does NOT read a re-sent `paid: true` as permission: the old payment would stand at the old price', async () => {
    seedPaidJob();
    const res = await patch({ paid: true, priceCents: 3500, force: true });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('job_paid');
    expect(jobRow().priceCents).toBe(3000);
  });
});
