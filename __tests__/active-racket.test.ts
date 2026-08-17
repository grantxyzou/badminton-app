import { describe, it, expect } from 'vitest';
import { activeRacket, rackets } from '../lib/activeRacket';
import type { PlayerGear, GearItem } from '../lib/types';

function item(id: string, category: GearItem['category'] = 'racket'): GearItem {
  return { id, catalogId: `racket-${id}`, category, label: `Label ${id}` };
}
function gear(items: GearItem[], activeRacketId?: string): PlayerGear {
  return { id: 'gear-m1', memberId: 'm1', items, activeRacketId, updatedAt: '2026-08-17T00:00:00Z' };
}

describe('activeRacket', () => {
  it('follows the pointer', () => {
    expect(activeRacket(gear([item('a'), item('b')], 'b'))?.id).toBe('b');
  });

  // Legacy docs predate the pointer — they must render exactly as before.
  it('falls back to the first racket when there is no pointer', () => {
    expect(activeRacket(gear([item('a'), item('b')]))?.id).toBe('a');
  });

  it('falls back when the pointer names a deleted item', () => {
    expect(activeRacket(gear([item('a')], 'gone'))?.id).toBe('a');
  });

  it('falls back when the pointer names a non-racket', () => {
    expect(activeRacket(gear([item('a'), item('s', 'string')], 's'))?.id).toBe('a');
  });

  it('returns null for empty or absent gear', () => {
    expect(activeRacket(gear([]))).toBeNull();
    expect(activeRacket(null)).toBeNull();
  });
});

describe('rackets', () => {
  it('returns only rackets, in insertion order', () => {
    expect(rackets(gear([item('a'), item('s', 'string'), item('b')])).map((r) => r.id)).toEqual(['a', 'b']);
  });
  it('returns an empty array for absent gear', () => {
    expect(rackets(null)).toEqual([]);
  });
});
