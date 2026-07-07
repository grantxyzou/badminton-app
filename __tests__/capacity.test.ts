import { describe, it, expect } from 'vitest';
import { overCapacityIds, isOverCapacity, compareBySignup, type CapacityEntry } from '../lib/capacity';

// Helper: build entries with an explicit signup order.
const e = (id: string, timestamp?: string): CapacityEntry => ({ id, timestamp });

describe('capacity resolver (#79)', () => {
  describe('overCapacityIds', () => {
    it('returns empty when the active set is under the cap', () => {
      const active = [e('a', '2026-07-01T10:00:00Z'), e('b', '2026-07-01T10:01:00Z')];
      expect(overCapacityIds(active, 12).size).toBe(0);
    });

    it('returns empty when exactly at the cap', () => {
      const active = [e('a', '2026-07-01T10:00:00Z'), e('b', '2026-07-01T10:01:00Z')];
      expect(overCapacityIds(active, 2).size).toBe(0);
    });

    it('flags the latest arrival when over by one (first-come-first-served)', () => {
      const active = [
        e('a', '2026-07-01T10:00:00Z'),
        e('b', '2026-07-01T10:02:00Z'), // latest → loses the spot
        e('c', '2026-07-01T10:01:00Z'),
      ];
      expect(overCapacityIds(active, 2)).toEqual(new Set(['b']));
    });

    it('flags the two latest arrivals when over by two', () => {
      const active = [
        e('a', '2026-07-01T10:00:00Z'),
        e('b', '2026-07-01T10:01:00Z'),
        e('c', '2026-07-01T10:02:00Z'),
        e('d', '2026-07-01T10:03:00Z'),
      ];
      expect(overCapacityIds(active, 2)).toEqual(new Set(['c', 'd']));
    });

    it('breaks timestamp ties by id (stable, so every racer agrees)', () => {
      const ts = '2026-07-01T10:00:00Z';
      const active = [e('zzz', ts), e('aaa', ts), e('mmm', ts)];
      // Same timestamp → id ascending: aaa, mmm, zzz. Cap 2 drops zzz.
      expect(overCapacityIds(active, 2)).toEqual(new Set(['zzz']));
    });

    it('treats a missing timestamp as earliest (keeps its spot)', () => {
      const active = [e('late', '2026-07-01T10:05:00Z'), e('legacy'), e('mid', '2026-07-01T10:01:00Z')];
      // legacy (no ts) sorts first, then mid, then late → cap 2 drops late.
      expect(overCapacityIds(active, 2)).toEqual(new Set(['late']));
    });

    it('flags everyone when the cap is zero', () => {
      const active = [e('a', '2026-07-01T10:00:00Z'), e('b', '2026-07-01T10:01:00Z')];
      expect(overCapacityIds(active, 0)).toEqual(new Set(['a', 'b']));
    });

    it('clamps negative / fractional caps to a floor', () => {
      const active = [e('a', '2026-07-01T10:00:00Z'), e('b', '2026-07-01T10:01:00Z')];
      expect(overCapacityIds(active, -3)).toEqual(new Set(['a', 'b']));
      expect(overCapacityIds(active, 1.9)).toEqual(new Set(['b'])); // floor(1.9) = 1
    });

    it('does not mutate the input array', () => {
      const active = [e('b', '2026-07-01T10:02:00Z'), e('a', '2026-07-01T10:00:00Z')];
      const snapshot = active.map((p) => p.id);
      overCapacityIds(active, 1);
      expect(active.map((p) => p.id)).toEqual(snapshot);
    });

    it('is deterministic: two independent racers compute the same overflow set', () => {
      const active = [
        e('a', '2026-07-01T10:00:00Z'),
        e('b', '2026-07-01T10:01:00Z'),
        e('c', '2026-07-01T10:01:00Z'), // ties b on timestamp
      ];
      const racer1 = overCapacityIds(active, 2);
      const racer2 = overCapacityIds([...active].reverse(), 2); // different insertion order
      expect(racer1).toEqual(racer2);
    });
  });

  describe('isOverCapacity', () => {
    const active = [
      e('a', '2026-07-01T10:00:00Z'),
      e('b', '2026-07-01T10:01:00Z'),
      e('c', '2026-07-01T10:02:00Z'),
    ];

    it('is true for the racer past the cap, false for the ones within it', () => {
      expect(isOverCapacity(active, 'c', 2)).toBe(true);
      expect(isOverCapacity(active, 'a', 2)).toBe(false);
      expect(isOverCapacity(active, 'b', 2)).toBe(false);
    });

    it('is false for an id not in the active set', () => {
      expect(isOverCapacity(active, 'missing', 2)).toBe(false);
    });
  });

  describe('compareBySignup', () => {
    it('orders by timestamp then id', () => {
      expect(compareBySignup(e('a', '2026-01-01T00:00:00Z'), e('b', '2026-01-02T00:00:00Z'))).toBeLessThan(0);
      expect(compareBySignup(e('a', '2026-01-01T00:00:00Z'), e('b', '2026-01-01T00:00:00Z'))).toBeLessThan(0);
      expect(compareBySignup(e('a', '2026-01-01T00:00:00Z'), e('a', '2026-01-01T00:00:00Z'))).toBe(0);
    });
  });
});
