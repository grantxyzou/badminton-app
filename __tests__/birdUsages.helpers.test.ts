import { describe, it, expect } from 'vitest';
import { tubesUsedAcross, avgTubesPerSession, runwayWeeks } from '@/lib/birdUsages';
import type { Session, BirdUsage } from '@/lib/types';

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
