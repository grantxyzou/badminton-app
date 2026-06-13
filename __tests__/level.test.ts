import { describe, it, expect } from 'vitest';
import { deriveLevel, levelToStage, stageToLevel, type LevelInputs } from '../lib/level';

const NOW = '2026-06-13T00:00:00.000Z';
function daysAgo(n: number): string {
  return new Date(Date.parse(NOW) - n * 86_400_000).toISOString();
}
function base(over: Partial<LevelInputs> = {}): LevelInputs {
  return { selfSnapshots: [], now: NOW, ...over };
}

describe('scale bridge', () => {
  it('levelToStage aligns each phase boundary to ~+1 stage', () => {
    expect(levelToStage(1.0)).toBe(1);
    expect(levelToStage(1.8)).toBe(2); // exploration
    expect(levelToStage(2.6)).toBe(3); // switch
    expect(levelToStage(3.4)).toBe(4); // commitment
    expect(levelToStage(5.0)).toBe(6);
  });

  it('levelToStage clamps out-of-range input to [1,6]', () => {
    expect(levelToStage(0)).toBe(1);
    expect(levelToStage(99)).toBe(6);
  });

  it('stageToLevel inverts roughly and clamps to [1,5]', () => {
    expect(stageToLevel(1)).toBe(1);
    expect(stageToLevel(3)).toBeCloseTo(2.6);
    expect(stageToLevel(6)).toBe(5);
    expect(stageToLevel(99)).toBe(5);
  });
});

describe('deriveLevel — self only (Phase 1)', () => {
  it('uses the latest snapshot overall as the level', () => {
    const r = deriveLevel(base({ selfSnapshots: [{ takenAt: daysAgo(40), overall: 2.5 }, { takenAt: daysAgo(2), overall: 3.0 }] }));
    expect(r.level).toBe(3.0);
    expect(r.basis.self).toBe(3.0);
    expect(r.phase).toBe('switch'); // 3.0 ≥ 2.6
    expect(r.stage).toBe(levelToStage(3.0));
  });

  it('ignores null-overall snapshots when picking the latest', () => {
    const r = deriveLevel(base({ selfSnapshots: [{ takenAt: daysAgo(1), overall: null }, { takenAt: daysAgo(5), overall: 2.0 }] }));
    expect(r.level).toBe(2.0);
  });

  it('is medium confidence on one check-in, high on two or more', () => {
    const one = deriveLevel(base({ selfSnapshots: [{ takenAt: daysAgo(3), overall: 3.0 }] }));
    expect(one.confidence).toBe('medium');
    const two = deriveLevel(base({ selfSnapshots: [{ takenAt: daysAgo(40), overall: 2.8 }, { takenAt: daysAgo(3), overall: 3.0 }] }));
    expect(two.confidence).toBe('high');
  });

  it('docks confidence one notch when the latest check-in is stale (>180d) but keeps the value', () => {
    const r = deriveLevel(base({ selfSnapshots: [{ takenAt: daysAgo(400), overall: 2.8 }, { takenAt: daysAgo(200), overall: 3.0 }] }));
    // latest (200d old) is stale → high would drop to medium; value unchanged.
    expect(r.level).toBe(3.0);
    expect(r.confidence).toBe('medium');
    expect(r.explanation.some((l) => /6 months/.test(l))).toBe(true);
  });
});

describe('deriveLevel — fallbacks', () => {
  it('falls back to the legacy stage at low confidence when there are no snapshots', () => {
    const r = deriveLevel(base({ legacyStage: 3 }));
    expect(r.level).toBe(stageToLevel(3));
    expect(r.confidence).toBe('low');
    expect(r.basis.legacyStage).toBe(3);
    expect(r.basis.self).toBeNull();
  });

  it('returns a null level (not a fake zero) when there is nothing to go on', () => {
    const r = deriveLevel(base());
    expect(r.level).toBeNull();
    expect(r.stage).toBeNull();
    expect(r.phase).toBeNull();
    expect(r.explanation[0]).toMatch(/check-in/i);
  });
});

describe('deriveLevel — blend renormalization (Phase 2 forward-compat)', () => {
  it('weights self 0.5 and game 0.3 at full game volume, renormalized', () => {
    const r = deriveLevel(base({
      selfSnapshots: [{ takenAt: daysAgo(2), overall: 3.0 }],
      gameCalibration: { observedLevel: 4.0, games: 10, lastGameAt: daysAgo(2) },
    }));
    // (3.0*0.5 + 4.0*0.3) / 0.8 = 3.375 → 3.4
    expect(r.level).toBe(3.4);
    expect(r.basis.game).toBe(4.0);
    expect(r.confidence).toBe('high'); // game presence forces high
  });

  it('ramps the game weight with volume', () => {
    const r = deriveLevel(base({
      selfSnapshots: [{ takenAt: daysAgo(2), overall: 3.0 }],
      gameCalibration: { observedLevel: 4.0, games: 5, lastGameAt: daysAgo(2) },
    }));
    // w_game = 0.3*0.5 = 0.15 → (1.5 + 0.6)/0.65 = 3.23 → 3.2
    expect(r.level).toBe(3.2);
  });

  it('is deterministic for identical inputs', () => {
    const inp = base({ selfSnapshots: [{ takenAt: daysAgo(2), overall: 3.3 }], legacyStage: 4 });
    expect(deriveLevel(inp)).toEqual(deriveLevel(inp));
  });
});
