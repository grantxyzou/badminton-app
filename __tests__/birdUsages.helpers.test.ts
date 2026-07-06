import { describe, it, expect } from 'vitest';
import { tubesUsedAcross, avgTubesPerSession, runwayWeeks, mergeBirdUsageEdit, snapshotBirdUsage } from '@/lib/birdUsages';
import type { Session, BirdUsage } from '@/lib/types';

describe('mergeBirdUsageEdit — preserve other purchases when editing one', () => {
  const sorted = (arr: { purchaseId: string; tubes: number }[]) =>
    [...arr].sort((a, b) => a.purchaseId.localeCompare(b.purchaseId));

  it('updates the edited purchase and keeps the others (the bug: it collapsed to one)', () => {
    const original = new Map([['A', 2], ['B', 3]]);
    expect(sorted(mergeBirdUsageEdit(original, 'A', 5))).toEqual([
      { purchaseId: 'A', tubes: 5 },
      { purchaseId: 'B', tubes: 3 },
    ]);
  });

  it('removes only the edited purchase when its tubes go to 0', () => {
    const original = new Map([['A', 2], ['B', 3]]);
    expect(mergeBirdUsageEdit(original, 'A', 0)).toEqual([{ purchaseId: 'B', tubes: 3 }]);
  });

  it('adds a new purchase alongside existing ones', () => {
    const original = new Map([['A', 2]]);
    expect(sorted(mergeBirdUsageEdit(original, 'C', 1))).toEqual([
      { purchaseId: 'A', tubes: 2 },
      { purchaseId: 'C', tubes: 1 },
    ]);
  });

  it('returns the original untouched when there is no edit (null purchase)', () => {
    const original = new Map([['A', 2], ['B', 3]]);
    expect(sorted(mergeBirdUsageEdit(original, null, 0))).toEqual([
      { purchaseId: 'A', tubes: 2 },
      { purchaseId: 'B', tubes: 3 },
    ]);
  });

  it('does not mutate the input map', () => {
    const original = new Map([['A', 2]]);
    mergeBirdUsageEdit(original, 'A', 9);
    expect(original.get('A')).toBe(2);
  });
});

function mkSession(usages: Partial<BirdUsage>[] | null): Pick<Session, 'birdUsages'> {
  if (!usages) return { birdUsages: undefined };
  return {
    birdUsages: usages.map((u, i) => ({
      purchaseId: u.purchaseId ?? `p-${i}`,
      purchaseName: u.purchaseName ?? 'Test',
      tubes: u.tubes ?? 0,
      costPerTube: u.costPerTube ?? 10,
      totalBirdCost: u.totalBirdCost ?? (u.tubes ?? 0) * 10,
    })),
  };
}

describe('tubesUsedAcross', () => {
  it('sums tubes across sessions, 0.5 increments supported', () => {
    const sessions = [mkSession([{ tubes: 2 }]), mkSession([{ tubes: 1.5 }, { tubes: 0.5 }])];
    expect(tubesUsedAcross(sessions)).toBe(4);
  });

  it('returns 0 for empty list', () => {
    expect(tubesUsedAcross([])).toBe(0);
  });

  it('tolerates sessions with no birdUsages', () => {
    expect(tubesUsedAcross([mkSession(null)])).toBe(0);
  });
});

describe('avgTubesPerSession', () => {
  it('averages the last `window` sessions with usage > 0', () => {
    const sessions = [
      mkSession([{ tubes: 2 }]),
      mkSession([{ tubes: 3 }]),
      mkSession([{ tubes: 1 }]),
    ];
    expect(avgTubesPerSession(sessions)).toBe(2);
  });

  it('excludes zero-usage sessions from the denominator', () => {
    const sessions = [mkSession([]), mkSession([{ tubes: 2 }])];
    expect(avgTubesPerSession(sessions)).toBe(2);
  });

  it('returns 0 when no sessions have usage', () => {
    expect(avgTubesPerSession([mkSession([]), mkSession(null)])).toBe(0);
  });

  it('respects the window parameter', () => {
    const sessions = Array.from({ length: 12 }, (_, i) => mkSession([{ tubes: i + 1 }]));
    // window=3 → avg of last 3: (10+11+12)/3 = 11
    expect(avgTubesPerSession(sessions, 3)).toBe(11);
  });
});

describe('runwayWeeks', () => {
  it('computes runway at current pace', () => {
    expect(runwayWeeks(10, 2)).toBe(5);
  });

  it('returns 0 when stock is empty', () => {
    expect(runwayWeeks(0, 2)).toBe(0);
  });

  it('returns Infinity when avg is 0 but stock remains', () => {
    expect(runwayWeeks(10, 0)).toBe(Infinity);
  });
});

describe('snapshotBirdUsage', () => {
  const purchase = { id: 'p1', name: 'Victor Master No.3', costPerTube: 21.33 };

  it('snapshots the purchase identity + cost, rounding to cents', () => {
    const u = snapshotBirdUsage(purchase, 1.5);
    expect(u).toEqual({
      purchaseId: 'p1',
      purchaseName: 'Victor Master No.3',
      tubes: 1.5,
      costPerTube: 21.33,
      totalBirdCost: 31.99, // 1.5 * 21.33 = 31.994999… in float → 31.99 (same as all write paths)
    });
  });

  it('rounds penny-fraction products the same way all write paths must', () => {
    // 0.25 * 21.33 = 5.3325 → 5.33
    expect(snapshotBirdUsage(purchase, 0.25).totalBirdCost).toBe(5.33);
    // 3 * 21.33 = 63.99 exactly
    expect(snapshotBirdUsage(purchase, 3).totalBirdCost).toBe(63.99);
  });
});
