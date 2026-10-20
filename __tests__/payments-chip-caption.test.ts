import { describe, it, expect } from 'vitest';
import { chipCaption } from '@/components/admin/CommandCenter/PaymentsCard';

/**
 * The Payments card's session chips say what is left to collect ("2 owing" /
 * "all paid") instead of a state word that meant nothing to the admin reading
 * it (canvas board 10f, 2026-10-20). The viewed session counts its live roster
 * so a Mark-paid tap moves the chip; the others read the history list; a chip
 * neither has answered for keeps the old word, which is still true.
 */
describe('chipCaption', () => {
  const history = new Map([
    ['session-2026-10-09', { unpaid: 2, players: 10 }],
    ['session-2026-10-02', { unpaid: 0, players: 8 }],
    ['session-2026-09-25', { unpaid: 0, players: 0 }],
  ]);

  it('the viewed session counts its live roster ahead of the history row', () => {
    expect(chipCaption('session-2026-10-09', 3, 11, history, true, false)).toEqual({ text: '3 owing', owing: true });
    expect(chipCaption('session-2026-10-09', 0, 11, history, true, false)).toEqual({ text: 'all paid', owing: false });
  });

  it('a past session reads the history list', () => {
    expect(chipCaption('session-2026-10-09', null, null, history, false, true)).toEqual({ text: '2 owing', owing: true });
    expect(chipCaption('session-2026-10-02', null, null, history, false, true)).toEqual({ text: 'all paid', owing: false });
    expect(chipCaption('session-2026-09-25', null, null, history, false, false)).toEqual({ text: 'no players', owing: false });
  });

  it('with no counts at all it falls back to the state word, never a made-up zero', () => {
    expect(chipCaption('session-2026-10-16', null, null, history, true, false)).toEqual({ text: 'Current', owing: false });
    expect(chipCaption('session-2026-10-16', null, null, history, false, true)).toEqual({ text: 'Sent', owing: false });
    expect(chipCaption('session-2026-10-16', null, null, history, false, false)).toEqual({ text: 'Past', owing: false });
  });

  it('a live roster with nobody on it is "no players", not "all paid"', () => {
    expect(chipCaption('session-2026-10-16', 0, 0, history, true, false)).toEqual({ text: 'no players', owing: false });
  });
});
