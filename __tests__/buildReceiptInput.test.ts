import { describe, it, expect } from 'vitest';
import { buildReceiptInput } from '@/lib/buildReceiptInput';
import type { Session } from '@/lib/types';

const RECIPIENT = { name: 'Grant', email: 'grant@example.com', memo: 'BPM {date} - {name}' };

function settledSession(over: Partial<Session> = {}): Session {
  return {
    id: 'session-2026-06-01',
    title: 'Sat',
    datetime: '2026-06-01T19:00:00-04:00',
    deadline: '2026-06-01T12:00:00-04:00',
    courts: 2,
    maxPlayers: 12,
    costPerCourt: 22,
    settled: {
      at: '2026-06-01T22:00:00-04:00',
      costPerPerson: 11,
      totalCost: 44,
      courtTotal: 44,
      birdTotal: 0,
      playerCount: 4,
      playerNames: ['Lin', 'Kento', 'Sindhu', 'Akane'],
    },
    ...over,
  } as Session;
}

describe('buildReceiptInput', () => {
  it('settled: reads cover-aware numbers + names from the frozen snapshot (no recompute)', () => {
    // costPerCourt*courts = 44 here too, but even if it did NOT, the snapshot wins.
    const s = settledSession({ costPerCourt: 999 }); // live recompute would be huge; snapshot must win
    const r = buildReceiptInput(s, [], RECIPIENT);
    expect(r.costPerPerson).toBe(11);
    expect(r.input).not.toBeNull();
    expect(r.input!.costPerPerson).toBe(11);
    expect(r.input!.totalCost).toBe(44);
    expect(r.input!.playerNames).toEqual(['Lin', 'Kento', 'Sindhu', 'Akane']);
    expect(r.input!.recipient).toEqual({ name: 'Grant', email: 'grant@example.com' });
    expect(r.input!.memoTemplate).toBe('BPM {date} - {name}');
    expect(r.error).toBeUndefined();
  });

  it('unsettled: recomputes totalCost / active players and lists active names', () => {
    const s = settledSession({ settled: undefined, costPerCourt: 20, courts: 2 }); // totalCost 40
    const players = [
      { name: 'A' }, { name: 'B' }, { name: 'C' }, { name: 'D' },
      { name: 'Gone', removed: true }, { name: 'Wait', waitlisted: true },
    ];
    const r = buildReceiptInput(s, players, RECIPIENT);
    expect(r.costPerPerson).toBe(10); // 40 / 4 active
    expect(r.input!.costPerPerson).toBe(10);
    expect(r.input!.playerNames).toEqual(['A', 'B', 'C', 'D']);
  });

  it('unsettled with no cost → null cost, null input, NO_COST error', () => {
    const s = settledSession({ settled: undefined, costPerCourt: 0, courts: 2 });
    const r = buildReceiptInput(s, [{ name: 'A' }], RECIPIENT);
    expect(r.costPerPerson).toBeNull();
    expect(r.input).toBeNull();
    expect(r.error).toMatch(/no recorded cost/i);
  });

  it('no recipient → cost still computed, input null, recipient error', () => {
    const r = buildReceiptInput(settledSession(), [], null);
    expect(r.costPerPerson).toBe(11); // cost is known...
    expect(r.input).toBeNull();       // ...but the receipt cannot be addressed
    expect(r.error).toMatch(/e-transfer recipient/i);
  });
});
