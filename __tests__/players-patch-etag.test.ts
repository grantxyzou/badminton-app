import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { POST as settle } from '@/app/api/session/settle/route';
import { PATCH as patchPlayer } from '@/app/api/players/route';
import { _resetMirrorFailures } from '@/lib/ledgerMirror';
import { applyAllocations } from '@/lib/paymentsInbox';
import { groupScope } from '@/lib/groupScope';
import type { LedgerEntry } from '@/lib/types';
import { resetMockStore, getStore, seedPointer, seedSession, seedPlayer, seedMember, makeAdminRequest, makeRequest, setupAdminPin, seedTestAdminMember } from './helpers';

/**
 * `PATCH /api/players` WRITES UNDER THE ETAG (docs/plans/money-audit.md, gap
 * 3, 2026-11-16). It was an `upsert`, so two requests that both read the row
 * before either wrote both landed: two "paid" taps mirrored two payments, and
 * a tap could write over an e-transfer landing in the same moment. Now the
 * loser of a race re-reads the row and either finds its ask already done
 * (200, no second write, no mirror) or something else (409, the phone reloads).
 */

const SID = 'session-2026-10-01';
const BASE = 'http://localhost:3000/api';
const rows = () => getStore()['players'] as Array<Record<string, unknown>>;
const rowOf = (name: string) => rows().find((p) => p.name === name)!;
const ledger = () => (getStore()['ledger'] ?? []) as LedgerEntry[];
const patch = (body: Record<string, unknown>) => patchPlayer(makeAdminRequest('PATCH', `${BASE}/players`, body));

const RealDate = Date;
/** Each `new Date()` a millisecond later than the last, as two phones' requests would be. */
function tickingClock() {
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
}

beforeEach(async () => {
  resetMockStore();
  setupAdminPin();
  _resetMirrorFailures();
  process.env.NEXT_PUBLIC_FLAG_LEDGER_MIRROR = 'true';
  await seedTestAdminMember();
  seedPointer(SID);
  seedSession(SID, { costPerCourt: 30, courts: 2, datetime: '2026-10-01T19:00:00-04:00' });
  seedPlayer(SID, 'Lin', { memberId: seedMember('Lin').id });
  seedPlayer(SID, 'Viktor', { memberId: seedMember('Viktor').id });
  await settle(makeAdminRequest('POST', `${BASE}/session/settle`));
});

afterEach(() => {
  globalThis.Date = RealDate;
  delete process.env.NEXT_PUBLIC_FLAG_LEDGER_MIRROR;
});

describe('two taps at once', () => {
  it('the same ask twice: both 200, one write, one ledger payment', async () => {
    const id = String(rowOf('Lin').id);
    tickingClock();
    const [a, b] = await Promise.all([patch({ id, paid: true }), patch({ id, paid: true })]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(rowOf('Lin').paid).toBe(true);
    expect(ledger().filter((e) => e.kind === 'payment')).toHaveLength(1);
    // Both answers carry the row as paid, so neither phone rolls back.
    expect([(await a.json()).paid, (await b.json()).paid]).toEqual([true, true]);
  });

  it('two DIFFERENT asks: the winner lands, the loser is refused with changed_elsewhere and writes nothing', async () => {
    const id = String(rowOf('Lin').id);
    tickingClock();
    const [a, b] = await Promise.all([patch({ id, paid: true }), patch({ id, writtenOff: true, coverMode: 'absorb' })]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 409]);
    const refused = a.status === 409 ? a : b;
    expect(await refused.json()).toEqual({ error: 'changed_elsewhere' });
    // Exactly one of the two outcomes stands, never a blend of both.
    const row = rowOf('Lin');
    const paidWon = row.paid === true && row.writtenOff !== true;
    const coverWon = row.writtenOff === true && row.paid === false;
    expect(paidWon || coverWon).toBe(true);
    const kinds = ledger().map((e) => e.kind).filter((k) => k === 'payment' || k === 'cover');
    expect(kinds).toHaveLength(1);
  });

  it('an un-tick racing the inbox marking the same row paid: one outcome stands, never a blend', async () => {
    const id = String(rowOf('Viktor').id);
    tickingClock();
    const inbox = applyAllocations(groupScope('bpm'), [{ kind: 'session', ref: id, pk: SID, amountCents: 3000 }], 'etx:1');
    const admin = patch({ id, paid: false });
    const [, res] = await Promise.all([inbox, admin]);
    expect([200, 409]).toContain(res.status);
    // Three orderings are coherent: the inbox landed and the admin's stale
    // write was refused (paid, one payment); the admin landed first and the
    // inbox stepped back (unpaid, no payment); the inbox landed and the admin
    // then READ it paid and un-ticked it (unpaid, the payment voided). The
    // blend the etag exists to prevent is a row that disagrees with its
    // ledger: unpaid with a live payment, or paid with none.
    const row = rowOf('Viktor');
    const voided = new Set(ledger().filter((e) => e.kind === 'void').map((e) => e.id.slice('void:'.length)));
    const livePayments = ledger().filter((e) => e.kind === 'payment' && e.ref?.id === id && !voided.has(e.id));
    expect(livePayments).toHaveLength(row.paid === true ? 1 : 0);
    if (row.paid === true) expect(row).toMatchObject({ paidVia: 'etransfer', paymentId: 'etx:1' });
  });
});

describe('the self-report flag', () => {
  it('never writes over a payment landing in the same moment', async () => {
    const id = String(rowOf('Lin').id);
    const token = String(rowOf('Lin').deleteToken);
    tickingClock();
    const inbox = applyAllocations(groupScope('bpm'), [{ kind: 'session', ref: id, pk: SID, amountCents: 3000 }], 'etx:2');
    const report = patchPlayer(makeRequest('PATCH', `${BASE}/players`, { id, selfReportedPaid: true, deleteToken: token }));
    const [landed, res] = await Promise.all([inbox, report]);
    expect(res.status).toBe(200);
    const row = rowOf('Lin');
    expect(row.selfReportedPaid).toBe(true);
    if (landed.length === 1) expect(row).toMatchObject({ paid: true, paidVia: 'etransfer', paymentId: 'etx:2' });
    else expect(row.paid).not.toBe(true);
  });
});
