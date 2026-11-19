import { describe, it, expect } from 'vitest';
import { activeRacket, pairableRackets, rackets } from '../lib/activeRacket';
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

  // Rackets predate the `category` field. Every other call site reads
  // `(category ?? 'racket')`; a strict check here made a legacy item
  // unactivatable in total silence — it listed fine, but this returned no
  // racket, so the PATCH guard (which calls this same helper) 404'd and
  // `onActivate` discarded the result. The button did nothing, forever.
  it('treats an item with no category as a racket', () => {
    const legacy = { id: 'old', catalogId: 'racket-old', label: 'Legacy' } as GearItem;
    expect(rackets(gear([legacy])).map((r) => r.id)).toEqual(['old']);
    expect(activeRacket(gear([legacy]))?.id).toBe('old');
  });

  it('still excludes an explicitly non-racket category', () => {
    expect(rackets(gear([item('s', 'string')]))).toEqual([]);
  });
});

/* What the strings map offers under "Change" (docs/plans/map-racket-choice.md). */
describe('pairableRackets', () => {
  it('lists the catalog rackets in bag order, and leaves out typed-in ones and strings', () => {
    const typed: GearItem = { id: 't', catalogId: null, category: 'racket', label: 'My old racket' };
    expect(pairableRackets(gear([item('a'), typed, item('s', 'string'), item('b')])).map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('leaves out a retired racket, unless it is the one in play', () => {
    const retired = { ...item('old'), retiredAt: '2026-01-01T00:00:00Z' };
    expect(pairableRackets(gear([item('a'), retired], 'a')).map((r) => r.id)).toEqual(['a']);
    expect(pairableRackets(gear([item('a'), retired], 'old')).map((r) => r.id)).toEqual(['a', 'old']);
  });

  it('keeps one racket per frame, and the racket in play claims its frame', () => {
    const spare = { ...item('spare'), catalogId: 'racket-a' };
    // Two of the same frame pair identically: one row, in its bag position.
    expect(pairableRackets(gear([item('a'), spare, item('b')], 'a')).map((r) => r.id)).toEqual(['a', 'b']);
    expect(pairableRackets(gear([item('a'), spare, item('b')], 'spare')).map((r) => r.id)).toEqual(['spare', 'b']);
  });

  it('is empty for absent gear', () => {
    expect(pairableRackets(null)).toEqual([]);
  });
});
