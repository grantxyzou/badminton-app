import { describe, it, expect } from 'vitest';
import {
  burstPieces,
  burstDurationMs,
  BURST_COUNT,
  BURST_ICONS,
  BURST_SIZE_MIN,
  BURST_SIZE_MAX,
  BURST_DISTANCE_MIN,
  BURST_DISTANCE_MAX,
  BURST_ROT_MAX,
  BURST_DUR_MIN,
  BURST_DUR_MAX,
  BURST_DELAY_MAX,
  BURST_DROP,
} from '../lib/shuttleBurst';

/**
 * The geometry of the sign-up burst (docs/plans/signup-shuttle-burst.md).
 * The ask was "size and direction should be random": every piece gets its
 * own, and every value stays inside the bounds the CSS was tuned for.
 */

/** A deterministic rng cycling a fixed sequence, so every value can be pinned. */
function seq(values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length];
}

describe('burstPieces', () => {
  it('makes fourteen pieces by default, cycling the three brand icons', () => {
    const pieces = burstPieces();
    expect(pieces).toHaveLength(BURST_COUNT);
    expect(pieces.map((p) => p.icon).slice(0, 4)).toEqual([...BURST_ICONS, BURST_ICONS[0]]);
    expect(new Set(pieces.map((p) => p.id)).size).toBe(BURST_COUNT);
  });

  it('keeps every random value inside its bounds', () => {
    for (let run = 0; run < 50; run++) {
      for (const p of burstPieces()) {
        expect(p.size).toBeGreaterThanOrEqual(BURST_SIZE_MIN);
        expect(p.size).toBeLessThanOrEqual(BURST_SIZE_MAX);
        const distance = Math.hypot(p.dx, p.dy - BURST_DROP);
        // Rounding of dx/dy moves the radius by under a pixel.
        expect(distance).toBeGreaterThanOrEqual(BURST_DISTANCE_MIN - 1);
        expect(distance).toBeLessThanOrEqual(BURST_DISTANCE_MAX + 1);
        expect(Math.abs(p.rot)).toBeLessThanOrEqual(BURST_ROT_MAX);
        expect(p.dur).toBeGreaterThanOrEqual(BURST_DUR_MIN);
        expect(p.dur).toBeLessThanOrEqual(BURST_DUR_MAX);
        expect(p.delay).toBeGreaterThanOrEqual(0);
        expect(p.delay).toBeLessThanOrEqual(BURST_DELAY_MAX);
      }
    }
  });

  it('covers the whole circle — pieces go up, down, left and right', () => {
    // 200 pieces from the real rng: the chance every one lands in three
    // quadrants or fewer is astronomically small, so a miss here is a bug.
    const pieces = burstPieces(200);
    expect(pieces.some((p) => p.dx > 20)).toBe(true);
    expect(pieces.some((p) => p.dx < -20)).toBe(true);
    expect(pieces.some((p) => p.dy - BURST_DROP > 20)).toBe(true);
    expect(pieces.some((p) => p.dy - BURST_DROP < -20)).toBe(true);
  });

  it('varies size piece to piece', () => {
    const sizes = new Set(burstPieces(40).map((p) => p.size));
    expect(sizes.size).toBeGreaterThan(3);
  });

  it('is deterministic for a fixed rng, straight right at the minimum for all zeros', () => {
    const [p] = burstPieces(1, seq([0]));
    expect(p).toEqual({
      id: 0,
      icon: 'pink',
      size: BURST_SIZE_MIN,
      dx: BURST_DISTANCE_MIN,
      dy: BURST_DROP,
      rot: -BURST_ROT_MAX,
      dur: BURST_DUR_MIN,
      delay: 0,
    });
  });

  it('a rng that answers 0.5 everywhere points the piece straight left at mid values', () => {
    const [p] = burstPieces(1, seq([0.5]));
    expect(p.dx).toBe(-Math.round((BURST_DISTANCE_MIN + BURST_DISTANCE_MAX) / 2));
    expect(p.rot).toBe(0);
    expect(p.size).toBe(Math.round((BURST_SIZE_MIN + BURST_SIZE_MAX) / 2));
  });
});

describe('burstDurationMs', () => {
  it('is the last landing plus a beat', () => {
    const pieces = burstPieces(3, seq([0.2, 0.9, 0.1, 0.4, 0.7, 0.8]));
    const last = Math.max(...pieces.map((p) => p.dur + p.delay));
    expect(burstDurationMs(pieces)).toBe(last + 50);
  });

  it('is a beat for no pieces at all', () => {
    expect(burstDurationMs([])).toBe(50);
  });
});
