import { describe, it, expect } from 'vitest';
import { deriveLevel, levelTrail } from '@/lib/level';
import { lastChange, parseLevelRead } from '@/lib/levelRead';

/**
 * One level (`docs/plans/one-level.md`). Every surface that says "your level"
 * shows the canonical level, and every "since …" change is the step between
 * two points of its trail. These pin the trail and the reader the surfaces
 * share; the surfaces' own tests pin that they read through them.
 */

// Lin on the test data, 2026-10-29: two check-ins and one logged game.
const LIN = [
  { takenAt: '2026-09-24T12:00:00.000Z', overall: 2.642857142857143 },
  { takenAt: '2026-10-24T12:00:00.000Z', overall: 3.4285714285714284 },
];
const NOW = '2026-10-29T12:00:00.000Z';

describe('levelTrail', () => {
  it('is the level as of each check-in, ending on the level itself', () => {
    const lvl = deriveLevel({ selfSnapshots: LIN, gameCalibration: { observedLevel: 3.5, games: 1, lastGameAt: NOW }, smoothing: true, now: NOW });
    expect(lvl.level).toBe(3.1);
    expect(lvl.trail).toEqual([
      { at: LIN[0].takenAt, level: 2.6 },
      { at: LIN[1].takenAt, level: 3.1 },
    ]);
  });

  it('so the change since the previous check-in adds up to the number shown', () => {
    const lvl = deriveLevel({ selfSnapshots: LIN, smoothing: true, now: NOW });
    const change = lastChange(lvl.trail ?? []);
    expect(change?.delta).toBeCloseTo((lvl.level as number) - 2.6, 5);
    expect(change?.since).toBe(LIN[0].takenAt);
  });

  it('sorts, and skips a check-in with no overall rather than reading it as zero', () => {
    const trail = levelTrail([LIN[1], { takenAt: '2026-10-01T00:00:00.000Z', overall: null }, LIN[0]], 3.1);
    expect(trail.map((p) => p.at)).toEqual([LIN[0].takenAt, LIN[1].takenAt]);
  });

  it('is empty when the level does not come from check-ins', () => {
    expect(levelTrail([], 2.5)).toEqual([]);
    expect(levelTrail(LIN, null)).toEqual([]);
    expect(deriveLevel({ selfSnapshots: [], legacyStage: 3, smoothing: true, now: NOW }).trail).toBeUndefined();
  });

  it('without smoothing, past points are the raw scores', () => {
    expect(levelTrail(LIN, 3.4, false).map((p) => p.level)).toEqual([2.6, 3.4]);
  });
});

describe('parseLevelRead', () => {
  it('reads the level and its trail', () => {
    expect(parseLevelRead({ level: { level: 3.1, trail: [{ at: 'a', level: 2.6 }, { at: 'b', level: 3.1 }] } }))
      .toEqual({ level: 3.1, trail: [{ at: 'a', level: 2.6 }, { at: 'b', level: 3.1 }] });
  });

  it('an older server with no trail, or a malformed one, reads as an empty trail', () => {
    expect(parseLevelRead({ level: { level: 3.1 } })).toEqual({ level: 3.1, trail: [] });
    expect(parseLevelRead({ level: { level: 3.1, trail: 'x' } })).toEqual({ level: 3.1, trail: [] });
    expect(parseLevelRead({ level: { level: 3.1, trail: [{ at: 'a' }, { level: 2 }] } })).toEqual({ level: 3.1, trail: [] });
  });

  it('no level is null, never zero', () => {
    expect(parseLevelRead({ level: { level: null } }).level).toBeNull();
    expect(parseLevelRead(null).level).toBeNull();
  });
});

describe('lastChange', () => {
  it('needs two points', () => {
    expect(lastChange([])).toBeNull();
    expect(lastChange([{ at: 'a', level: 3 }])).toBeNull();
  });
  it('is the step between the last two', () => {
    expect(lastChange([{ at: 'a', level: 2 }, { at: 'b', level: 2.6 }, { at: 'c', level: 3.1 }]))
      .toEqual({ delta: expect.closeTo(0.5, 5), since: 'b' });
  });
});
