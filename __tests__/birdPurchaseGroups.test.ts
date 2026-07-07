import { describe, it, expect } from 'vitest';
import { splitPurchasesByRecency, RECENT_WINDOW_DAYS } from '@/lib/birdPurchaseGroups';
import type { BirdPurchase } from '@/lib/types';

// Fixed "now" at UTC midnight so date-only (YYYY-MM-DD) fixtures — which parse
// to UTC midnight — align exactly with the cutoff (no intra-day offset).
const NOW = new Date('2026-07-06T00:00:00Z').getTime();
const DAY = 86_400_000;

function mk(id: string, date: string): BirdPurchase {
  return { id, name: id, tubes: 1, totalCost: 10, costPerTube: 10, date, createdAt: date };
}

/** A YYYY-MM-DD string `n` days before NOW. */
function daysAgo(n: number): string {
  return new Date(NOW - n * DAY).toISOString().slice(0, 10);
}

describe('splitPurchasesByRecency', () => {
  it('puts purchases within the window in `recent` and the rest in `older`', () => {
    const purchases = [mk('a', daysAgo(5)), mk('b', daysAgo(90)), mk('c', daysAgo(30))];
    const { recent, older } = splitPurchasesByRecency(purchases, NOW);
    expect(recent.map((p) => p.id).sort()).toEqual(['a', 'c']);
    expect(older.map((p) => p.id)).toEqual(['b']);
  });

  it('sorts each group newest-first', () => {
    const purchases = [
      mk('old1', daysAgo(120)),
      mk('recent1', daysAgo(3)),
      mk('old2', daysAgo(70)),
      mk('recent2', daysAgo(40)),
    ];
    const { recent, older } = splitPurchasesByRecency(purchases, NOW);
    expect(recent.map((p) => p.id)).toEqual(['recent1', 'recent2']); // 3d before 40d
    expect(older.map((p) => p.id)).toEqual(['old2', 'old1']); // 70d before 120d
  });

  it('treats the cutoff as inclusive on the recent side (>= cutoff is recent)', () => {
    // Exactly RECENT_WINDOW_DAYS old → still recent.
    const onBoundary = mk('edge', daysAgo(RECENT_WINDOW_DAYS));
    const justOlder = mk('past', daysAgo(RECENT_WINDOW_DAYS + 1));
    const { recent, older } = splitPurchasesByRecency([onBoundary, justOlder], NOW);
    expect(recent.map((p) => p.id)).toEqual(['edge']);
    expect(older.map((p) => p.id)).toEqual(['past']);
  });

  it('excludes purchases with an unparseable date from BOTH groups', () => {
    const purchases = [mk('good', daysAgo(10)), mk('bad', 'not-a-date')];
    const { recent, older } = splitPurchasesByRecency(purchases, NOW);
    expect(recent.map((p) => p.id)).toEqual(['good']);
    expect(older).toEqual([]);
  });

  it('is a complete, non-overlapping partition for parseable dates', () => {
    const purchases = [mk('a', daysAgo(1)), mk('b', daysAgo(61)), mk('c', daysAgo(200))];
    const { recent, older } = splitPurchasesByRecency(purchases, NOW);
    const ids = [...recent, ...older].map((p) => p.id).sort();
    expect(ids).toEqual(['a', 'b', 'c']);
    const overlap = recent.filter((r) => older.some((o) => o.id === r.id));
    expect(overlap).toEqual([]);
  });

  it('defaults the window to 60 days', () => {
    expect(RECENT_WINDOW_DAYS).toBe(60);
  });
});
