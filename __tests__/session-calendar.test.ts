import { describe, it, expect } from 'vitest';
import { sessionDay, sessionMoneyState, monthCells, earlierMonthOwes, dayKey } from '@/lib/sessionCalendar';

/** The Payments date picker's rules (docs/plans/payments-today-first.md). */
describe('session calendar', () => {
  it('reads the day from a date-keyed id, BPM or another group', () => {
    expect(sessionDay({ id: 'session-2026-10-22' })).toBe('2026-10-22');
    expect(sessionDay({ id: 'club2:session-2026-10-15' })).toBe('2026-10-15');
  });

  it('reads the legacy current-session doc by its datetime, in the club zone', () => {
    // 02:30 UTC on the 23rd is still the 22nd in Vancouver.
    expect(sessionDay({ id: 'current-session', datetime: '2026-10-23T02:30:00Z' })).toBe('2026-10-22');
    expect(sessionDay({ id: 'current-session' })).toBeNull();
  });

  it('marks owing, all paid, and nothing for an empty or unanswered session', () => {
    expect(sessionMoneyState(null, { unpaid: 2, players: 6 })).toBe('owe');
    expect(sessionMoneyState(null, { unpaid: 0, players: 6 })).toBe('paid');
    expect(sessionMoneyState(null, { unpaid: 0, players: 0 })).toBe('none');
    expect(sessionMoneyState(null, undefined)).toBe('none');
  });

  it("lets the viewed session's live roster win over the history read", () => {
    expect(sessionMoneyState({ unpaid: 0, players: 6 }, { unpaid: 2, players: 6 })).toBe('paid');
  });

  it('draws a Sunday-first month padded to whole weeks', () => {
    // October 2026 starts on a Thursday.
    const cells = monthCells(2026, 9);
    expect(cells.slice(0, 5)).toEqual([null, null, null, null, 1]);
    expect(cells.length % 7).toBe(0);
    expect(cells.filter((c) => c != null).length).toBe(31);
    expect(dayKey(2026, 9, 1)).toBe('2026-10-01');
  });

  it('flags an earlier month that still owes, and nothing for this month or later', () => {
    const states = new Map([
      ['2026-10-15', 'owe' as const],
      ['2026-09-17', 'owe' as const],
      ['2026-11-05', 'owe' as const],
    ]);
    expect(earlierMonthOwes(states, '2026-10')).toBe(true);
    expect(earlierMonthOwes(states, '2026-09')).toBe(false);
  });
});
