import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { POST as repair } from '@/app/api/admin/ledger/repair/route';
import { runReconcile } from '@/lib/ledgerReconcile';
import type { LedgerEntry } from '@/lib/types';
import { resetMockStore, getStore, seedDoc, seedMember, makeRequest, makeAdminRequest, setupAdminPin, seedTestAdminMember } from './helpers';

/**
 * "Restore the charge" (lib/ledgerRepair.ts): a paid stringing job deleted
 * from the archive kept its payment and lost its charge, so the Ledger check
 * read "stringing job (deleted) · ledger −$40 · app $0" with nothing left to
 * touch (Grant, 2026-11-16: "its missing", "deleted").
 */
const BASE = 'http://localhost:3000/api';
const ledger = () => (getStore()['ledger'] ?? []) as LedgerEntry[];
const before = process.env.NEXT_PUBLIC_FLAG_LEDGER_MIRROR;
let grant: { id: string };

function entry(over: Partial<LedgerEntry> & { id: string }) {
  return {
    groupId: 'bpm', memberId: grant.id, account: 'member_owed', amountCents: 0, note: '',
    ref: { kind: 'stringing', id: 'job-6', pk: grant.id }, createdAt: '2026-11-15T20:00:00Z', ...over,
  } as unknown as Record<string, unknown>;
}

/** The deleted job's books as the old delete left them: charge, its void, the payment. */
function seedDeletedPaidJob(groupId = 'bpm') {
  seedDoc('ledger', { ...entry({ id: 'charge:job-6:0', kind: 'charge', amountCents: 4000, note: 'Stringing · Astrox 88D Pro', createdAt: '2026-11-15T19:00:00Z' }), groupId });
  seedDoc('ledger', { ...entry({ id: 'payment:job-6:1763236800000', kind: 'payment', amountCents: -4000, note: 'Card' }), groupId });
  seedDoc('ledger', { ...entry({ id: 'void:charge:job-6:0', kind: 'void', amountCents: -4000, note: 'Reversed: charge', createdAt: '2026-11-16T01:00:00Z' }), groupId });
}

const tap = (body: Record<string, unknown>) => repair(makeAdminRequest('POST', `${BASE}/admin/ledger/repair`, body));

beforeEach(async () => {
  resetMockStore();
  setupAdminPin();
  process.env.NEXT_PUBLIC_FLAG_LEDGER_MIRROR = 'true';
  await seedTestAdminMember();
  grant = seedMember('Grant');
});

afterEach(() => {
  if (before === undefined) delete process.env.NEXT_PUBLIC_FLAG_LEDGER_MIRROR;
  else process.env.NEXT_PUBLIC_FLAG_LEDGER_MIRROR = before;
});

describe('POST /api/admin/ledger/repair', () => {
  it('restores the charge of a deleted, paid job once; the check is then clean', async () => {
    seedDeletedPaidJob();
    expect((await runReconcile('bpm')).mismatches.map((m) => [m.code, m.ledgerCents])).toEqual([['amount_mismatch', -4000]]);

    const res = await tap({ kind: 'stringing', id: 'job-6', memberId: grant.id });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ outcome: 'restored', amountCents: 4000 });
    const restored = ledger().find((e) => e.id === 'charge:job-6:1')!;
    expect(restored).toEqual(expect.objectContaining({ kind: 'charge', amountCents: 4000, account: 'member_owed', note: 'Stringing · Astrox 88D Pro', createdAt: '2026-11-15T20:00:00Z' }));
    expect(restored.meta?.reason).toBe('restored_deleted_job');
    expect((await runReconcile('bpm')).mismatches).toEqual([]);

    // A second tap changes nothing.
    const again = await tap({ kind: 'stringing', id: 'job-6', memberId: grant.id });
    expect(again.status).toBe(409);
    expect(await again.json()).toEqual({ error: 'nothing_to_restore' });
    expect(ledger().filter((e) => e.kind === 'charge').length).toBe(2);
  });

  it('a job that still exists is refused: any change to it heals it instead', async () => {
    seedDeletedPaidJob();
    seedDoc('stringingJobs', { id: 'job-6', groupId: 'bpm', memberId: grant.id, memberName: 'Grant', jobNo: 'J-0006', racketLabel: 'Astrox', stringLabel: 'BG80', status: 'ready', priceCents: 4000, paidAt: '2026-11-15T20:00:00Z', createdAt: '2026-11-15T00:00:00Z', updatedAt: '2026-11-15T20:00:00Z', history: [] });
    const res = await tap({ kind: 'stringing', id: 'job-6', memberId: grant.id });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'job_exists' });
  });

  it('nothing to restore when the books already balance', async () => {
    seedDoc('ledger', entry({ id: 'charge:job-6:0', kind: 'charge', amountCents: 4000 }));
    seedDoc('ledger', entry({ id: 'payment:job-6:1', kind: 'payment', amountCents: -4000 }));
    expect((await tap({ kind: 'stringing', id: 'job-6', memberId: grant.id })).status).toBe(409);
  });

  it('admins only, a well-formed body, and 404 with the mirror off', async () => {
    seedDeletedPaidJob();
    expect((await repair(makeRequest('POST', `${BASE}/admin/ledger/repair`, { kind: 'stringing', id: 'job-6', memberId: grant.id }))).status).toBe(401);
    expect((await tap({ kind: 'session', id: 'job-6', memberId: grant.id })).status).toBe(400);
    expect((await tap({ kind: 'stringing', id: '', memberId: grant.id })).status).toBe(400);
    delete process.env.NEXT_PUBLIC_FLAG_LEDGER_MIRROR;
    expect((await tap({ kind: 'stringing', id: 'job-6', memberId: grant.id })).status).toBe(404);
    expect(ledger().some((e) => e.id === 'charge:job-6:1')).toBe(false);
  });

  it('never reaches another club’s ledger', async () => {
    seedDeletedPaidJob('other');
    const res = await tap({ kind: 'stringing', id: 'job-6', memberId: grant.id });
    expect(res.status).toBe(409);
    expect(ledger().some((e) => e.id === 'charge:job-6:1')).toBe(false);
  });
});
