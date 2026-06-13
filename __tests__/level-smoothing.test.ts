import { describe, it, expect } from 'vitest';
import { smoothSelfLevel, resolvePhaseTrajectory, deriveLevel } from '../lib/level';

/** ISO timestamp `n` days after a fixed epoch — keeps the EWMA math deterministic. */
const EPOCH = Date.UTC(2026, 0, 1);
const day = (n: number) => new Date(EPOCH + n * 86_400_000).toISOString();
const snap = (n: number, overall: number | null) => ({ takenAt: day(n), overall });

describe('smoothSelfLevel — time-decayed EWMA (90-day half-life)', () => {
  it('returns a single snapshot at its own value', () => {
    expect(smoothSelfLevel([snap(0, 3.7)], day(0))).toBe(3.7);
  });

  it('halves the older snapshot weight at exactly one half-life', () => {
    // anchor = newest (day 90); old (day 0) is one half-life back → weight 0.5.
    // (0.5·2.0 + 1.0·4.0) / (0.5 + 1.0) = 5.0 / 1.5 = 3.333 → 3.3
    expect(smoothSelfLevel([snap(0, 2.0), snap(90, 4.0)], day(120))).toBe(3.3);
  });

  it('lets the most recent check-in dominate when spaced far apart', () => {
    // old fades to ~0.046 weight at 365 days → result ≈ latest.
    expect(smoothSelfLevel([snap(0, 2.0), snap(365, 4.0)], day(365))).toBeCloseTo(3.9, 1);
  });

  it('ignores null-overall snapshots and is order-independent', () => {
    const a = smoothSelfLevel([snap(0, 2.0), snap(90, null), snap(90, 4.0)], day(90));
    const b = smoothSelfLevel([snap(90, 4.0), snap(0, 2.0)], day(90));
    expect(a).toBe(b);
  });

  it('returns null with no usable snapshots', () => {
    expect(smoothSelfLevel([], day(0))).toBeNull();
    expect(smoothSelfLevel([snap(0, null)], day(0))).toBeNull();
  });
});

describe('resolvePhaseTrajectory — hysteresis', () => {
  it('places the first check-in with no hysteresis (baseline)', () => {
    expect(resolvePhaseTrajectory([snap(0, 3.5)])).toEqual({
      phase: 'commitment',
      pendingPromotion: null,
    });
  });

  it('holds a promotion as pending on the first qualifying check-in', () => {
    // exploration → one switch-band check-in: pending switch, phase still exploration.
    const t = resolvePhaseTrajectory([snap(0, 2.0), snap(200, 3.0)]);
    expect(t.phase).toBe('exploration');
    expect(t.pendingPromotion).toBe('switch');
  });

  it('confirms the promotion on a second consecutive qualifying check-in', () => {
    const t = resolvePhaseTrajectory([snap(0, 2.0), snap(200, 3.0), snap(400, 3.1)]);
    expect(t.phase).toBe('switch');
    expect(t.pendingPromotion).toBeNull();
  });

  it('confirms a pending promotion early when games corroborate (≥8, within 0.2)', () => {
    const t = resolvePhaseTrajectory([snap(0, 2.0), snap(200, 3.0)], { level: 2.6, games: 10 });
    expect(t.phase).toBe('switch');
    expect(t.pendingPromotion).toBeNull();
  });

  it('does NOT let thin or distant game data corroborate', () => {
    const fewGames = resolvePhaseTrajectory([snap(0, 2.0), snap(200, 3.0)], { level: 2.6, games: 5 });
    expect(fewGames.phase).toBe('exploration'); // games < 8
    const farBelow = resolvePhaseTrajectory([snap(0, 2.0), snap(200, 3.0)], { level: 2.3, games: 10 });
    expect(farBelow.phase).toBe('exploration'); // 2.3 < 2.6 − 0.2
  });

  it('does not demote within the sticky margin (bandMin − 0.15)', () => {
    // confirmed commitment (3.5), then a 3.3 that smooths to ~3.34 — above 3.25, holds.
    const t = resolvePhaseTrajectory([snap(0, 3.5), snap(200, 3.3)]);
    expect(t.phase).toBe('commitment');
  });

  it('demotes once the smoothed level falls below the sticky margin', () => {
    const t = resolvePhaseTrajectory([snap(0, 3.5), snap(200, 2.9)]);
    expect(t.phase).toBe('switch');
  });

  it('is deterministic for identical input', () => {
    const input = [snap(0, 2.0), snap(120, 3.0), snap(240, 3.2)];
    expect(resolvePhaseTrajectory(input)).toEqual(resolvePhaseTrajectory(input));
  });

  it('returns nulls for no snapshots', () => {
    expect(resolvePhaseTrajectory([])).toEqual({ phase: null, pendingPromotion: null });
  });
});

describe('deriveLevel — smoothing flag integration', () => {
  const snapshots = [snap(0, 2.0), snap(200, 3.0)];

  it('uses the smoothed self value and trajectory phase when smoothing is on', () => {
    const out = deriveLevel({ selfSnapshots: snapshots, smoothing: true, now: day(200) });
    // smoothed self ≈ 2.8 (not the latest 3.0)
    expect(out.basis.self).toBe(2.8);
    expect(out.level).toBe(2.8);
    expect(out.phase).toBe('exploration');
    expect(out.pendingPromotion).toBe('switch');
  });

  it('uses the latest self value and raw band when smoothing is off (Phase 1/2 behaviour)', () => {
    const out = deriveLevel({ selfSnapshots: snapshots, smoothing: false, now: day(200) });
    expect(out.basis.self).toBe(3.0);
    expect(out.level).toBe(3.0);
    expect(out.phase).toBe('switch');
    expect(out.pendingPromotion ?? null).toBeNull();
  });

  it('narrates the smoothed self as a recent average, not "latest"', () => {
    const out = deriveLevel({ selfSnapshots: snapshots, smoothing: true, now: day(200) });
    expect(out.explanation.some((l) => /recent average/i.test(l))).toBe(true);
    expect(out.explanation.some((l) => /one more consistent check-in/i.test(l))).toBe(true);
  });
});
