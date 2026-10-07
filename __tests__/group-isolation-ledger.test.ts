import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ledgerFor } from '@/lib/storeCredit';
import { runLedgerBackfill, ledgerBackfillStatus } from '@/lib/ledgerBackfill';
import { mirrorSettle, CLUB_LEDGER_ID } from '@/lib/ledgerMirror';
import { groupScope } from '@/lib/groupScope';
import type { LedgerEntry } from '@/lib/types';
import { resetMockStore, getStore, seedDoc, seedSession, seedPlayer, seedMember } from './helpers';

/**
 * The two-group gate for the ledger (the 1b pattern): seed entries stamped
 * `groupId: 'other'` — under a member AND under the club sentinel, which is
 * the new shape here — and read as BPM. Nothing of theirs comes back, and
 * nothing BPM writes lands under their group.
 */

const ledger = () => (getStore()['ledger'] ?? []) as LedgerEntry[];

beforeEach(() => {
  resetMockStore();
  process.env.NEXT_PUBLIC_FLAG_LEDGER_MIRROR = 'true';
});
afterEach(() => {
  delete process.env.NEXT_PUBLIC_FLAG_LEDGER_MIRROR;
});

describe('ledger group isolation', () => {
  it('another club\'s entries — member and ~club alike — are invisible to BPM reads', async () => {
    const lin = seedMember('Lin');
    seedDoc('ledger', { id: 'other-charge', groupId: 'other', memberId: lin.id, account: 'member_owed', kind: 'charge', amountCents: 1200, note: '', createdAt: '2026-09-01T00:00:00Z', createdBy: 'system' });
    seedDoc('ledger', { id: 'other-court', groupId: 'other', memberId: CLUB_LEDGER_ID, account: 'club_outlay', kind: 'court_cost', amountCents: 6000, note: '', createdAt: '2026-09-01T00:00:00Z', createdBy: 'system' });
    seedDoc('ledger', { id: 'bpm-court', groupId: 'bpm', memberId: CLUB_LEDGER_ID, account: 'club_outlay', kind: 'court_cost', amountCents: 5000, note: '', createdAt: '2026-09-01T00:00:00Z', createdBy: 'system' });

    const bpm = groupScope('bpm');
    expect((await ledgerFor(bpm, lin.id)).map((e) => e.id)).toEqual([]);
    expect((await ledgerFor(bpm, CLUB_LEDGER_ID)).map((e) => e.id)).toEqual(['bpm-court']);
    expect((await ledgerBackfillStatus('bpm')).ledgerEntries).toBe(1);
  });

  it('a BPM mirror write is stamped bpm, never the other group', async () => {
    const lin = seedMember('Lin');
    seedSession('session-2026-09-24', { settled: { at: '2026-09-25T00:00:00Z', costPerPerson: 12, totalCost: 60, courtTotal: 60, birdTotal: 0, playerCount: 5, playerNames: [] }, datetime: '2026-09-24T19:00:00-04:00' });
    const row = seedPlayer('session-2026-09-24', 'Lin', { memberId: lin.id, owedAmount: 12, settledAt: '2026-09-25T00:00:00Z' });
    const session = (getStore()['sessions'] as Array<Record<string, unknown>>).find((s) => s.id === 'session-2026-09-24')!;
    await mirrorSettle(groupScope('bpm'), session as never, session.settled as never, [row as never]);
    expect(ledger().length).toBe(2);
    for (const e of ledger()) expect(e.groupId).toBe('bpm');
  });

  it('a backfill for one group never reads another group\'s sessions', async () => {
    seedSession('other-session', { groupId: 'other', settled: { at: '2026-09-25T00:00:00Z', costPerPerson: 12, totalCost: 60, courtTotal: 60, birdTotal: 0, playerCount: 5, playerNames: [] }, datetime: '2026-09-24T19:00:00-04:00' });
    const r = await runLedgerBackfill('bpm', { dryRun: false });
    expect(r.scanned.sessions).toBe(0);
    expect(ledger()).toHaveLength(0);
  });
});
