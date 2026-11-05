import { describe, it, expect } from 'vitest';
import { heldLines, wouldHoldFrom } from '@/lib/paymentsInbox';
import type { UnpaidSession, RosterOwed } from '@/lib/owedBalance';

/**
 * The soft hold is "owes for N sessions" (audit, 2026-11-05). A plus-one's
 * share is a second LINE on the host's balance for the same night, and the
 * hold used to count lines: one unpaid night with a guest held the host at a
 * threshold of 2.
 */
const line = (sessionId: string, over: Partial<UnpaidSession> = {}): UnpaidSession => ({
  sessionId,
  playerId: `p-${sessionId}-${over.guestName ?? 'self'}`,
  date: '2026-10-01',
  owedAmount: 10,
  settled: true,
  selfReported: false,
  settledAt: '2026-10-02T00:00:00Z',
  remindedCount: 0,
  lastRemindedAt: null,
  ...over,
});

describe('heldLines', () => {
  it('counts a night with a guest once', () => {
    expect(heldLines([line('s1'), line('s1', { guestName: 'Jenny' })])).toBe(1);
  });
  it('still counts two different nights as two', () => {
    expect(heldLines([line('s1'), line('s2')])).toBe(2);
  });
  it('leaves out self-reported and unsettled lines, as before', () => {
    expect(heldLines([line('s1', { selfReported: true }), line('s2', { settled: false })])).toBe(0);
  });
  it('the preview agrees: a host with one guest night is not held at 2', () => {
    const owed = [{ name: 'Josh', balance: { sessions: [line('s1'), line('s1', { guestName: 'Jenny' })] } }] as unknown as RosterOwed[];
    expect(wouldHoldFrom(owed, 2)).toEqual([]);
  });
});
