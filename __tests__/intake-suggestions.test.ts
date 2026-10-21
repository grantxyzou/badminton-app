import { describe, it, expect } from 'vitest';
import { intakeSuggestions, lastJobFor, matchingSuggestions } from '../lib/intakeSuggestions';
import type { GearItem, PlayerGear, StringingJob } from '../lib/types';

/**
 * What the New job form offers for a picked player: their bag's rackets (the
 * one in play first) and its string with tension, and the bench's last job
 * for them. Free typing stays; these only fill a field.
 */
const item = (over: Partial<GearItem>): GearItem => ({ id: 'i', catalogId: null, category: 'racket', label: 'x', ...over });
const gear = (items: GearItem[], activeRacketId?: string): PlayerGear => ({
  id: 'gear-m', memberId: 'm', items, activeRacketId, updatedAt: '2026-10-01T00:00:00.000Z',
});
const job = (over: Partial<StringingJob>): StringingJob => ({
  id: 'j', memberId: 'm', jobNo: 'J-0001', memberName: 'Lin', stringerId: null, stringerName: null,
  status: 'ready', racketLabel: 'Yonex Astrox 88D Pro', stringLabel: 'Yonex BG80', tensionMains: 25, tensionCrosses: 27,
  method: '', priceCents: null, readyBy: null, acceptedAt: null, paidAt: null, sessionId: null,
  createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z', history: [], ...over,
});

describe('intake suggestions', () => {
  it('puts the racket in play first, then the spares, never a retired one', () => {
    const s = intakeSuggestions(gear([
      item({ id: 'a', label: 'Victor Thruster F' }),
      item({ id: 'b', label: 'Yonex Astrox 88D Pro' }),
      item({ id: 'c', label: 'Old frame', retiredAt: '2026-01-01' }),
    ], 'b'), null);
    expect(s.rackets).toEqual([
      { label: 'Yonex Astrox 88D Pro', inPlay: true },
      { label: 'Victor Thruster F', inPlay: false },
    ]);
  });

  it('offers the bag string at its tension, crosses two over when only one was recorded', () => {
    const s = intakeSuggestions(gear([item({ id: 's', category: 'string', label: 'Yonex BG65', tensionLbs: 24 })]), null);
    expect(s.strings).toEqual([{ label: 'Yonex BG65', mains: 24, crosses: 26, source: 'bag' }]);
  });

  it('names both strings of a hybrid, at their own tensions', () => {
    const s = intakeSuggestions(gear([item({
      id: 's', category: 'string', label: 'Yonex BG80', tensionLbs: 26,
      crosses: { catalogId: null, label: 'Yonex Aerobite', tensionLbs: 27 },
    })]), null);
    expect(s.strings[0]).toMatchObject({ label: 'Yonex BG80 / Yonex Aerobite', mains: 26, crosses: 27 });
  });

  it('a string with no recorded tension leaves the tension alone', () => {
    const s = intakeSuggestions(gear([item({ id: 's', category: 'string', label: 'Yonex BG65' })]), null);
    expect(s.strings[0]).toEqual({ label: 'Yonex BG65', source: 'bag' });
  });

  it('the last job comes first with both tensions, and the same names show once', () => {
    const s = intakeSuggestions(
      gear([item({ id: 'a', label: 'yonex astrox 88d pro' }), item({ id: 's', category: 'string', label: 'yonex bg80', tensionLbs: 24 })]),
      job({}),
    );
    expect(s.rackets).toHaveLength(1);
    expect(s.strings).toEqual([{ label: 'Yonex BG80', mains: 25, crosses: 27, source: 'lastJob' }]);
  });

  it('the last job is the newest of that player’s, archived or not', () => {
    const jobs = [job({ id: 'old' }), job({ id: 'new', createdAt: '2026-10-01T00:00:00.000Z' }), job({ id: 'other', memberId: 'z', createdAt: '2026-10-09T00:00:00.000Z' })];
    expect(lastJobFor(jobs, 'm')?.id).toBe('new');
    expect(lastJobFor(jobs, 'nobody')).toBeNull();
  });

  it('a typed value narrows the list and hides the one already chosen', () => {
    const list = [{ label: 'Yonex BG80' }, { label: 'Yonex BG65' }];
    expect(matchingSuggestions(list, '')).toHaveLength(2);
    expect(matchingSuggestions(list, 'bg8')).toEqual([{ label: 'Yonex BG80' }]);
    expect(matchingSuggestions(list, 'yonex bg80')).toEqual([]);
  });

  it('no gear and no job offers nothing', () => {
    expect(intakeSuggestions(null, null)).toEqual({ rackets: [], strings: [] });
  });
});
