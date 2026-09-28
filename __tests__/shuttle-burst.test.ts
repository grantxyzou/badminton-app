import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  burstPieces,
  burstDurationMs,
  nearestTurn,
  BURST_COUNT,
  BURST_ICONS,
  BURST_SIZE_MIN,
  BURST_SIZE_MAX,
  BURST_CONE_HALF_DEG,
  BURST_LAUNCH_MIN,
  BURST_LAUNCH_MAX,
  BURST_FALL_MIN,
  BURST_FALL_MAX,
  BURST_DRIFT_MAX,
  BURST_WOBBLE_MIN,
  BURST_WOBBLE_MAX,
  BURST_DUR_MIN,
  BURST_DUR_MAX,
  BURST_DELAY_MAX,
  LAUNCH_FRACTION,
  NOSE_DEG,
  REST_DEG,
} from '../lib/shuttleBurst';

/**
 * The geometry of the sign-up burst (docs/plans/signup-shuttle-burst.md),
 * after the physics pass: a popper cone UP, a drag-killed launch to an apex,
 * a steady near-vertical fall past the origin, and a cork that aims along
 * the launch and turns nose-down. Every random value stays inside the bounds
 * the CSS was tuned for.
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

  it('launches every piece UPWARD inside the popper cone, to a bounded apex', () => {
    const minUp = Math.cos((BURST_CONE_HALF_DEG * Math.PI) / 180) * BURST_LAUNCH_MIN;
    for (let run = 0; run < 50; run++) {
      for (const p of burstPieces()) {
        // Up is negative y on screen; the widest cone angle still rises a little.
        expect(p.y1).toBeLessThanOrEqual(-Math.floor(minUp) + 1);
        const launch = Math.hypot(p.x1, p.y1);
        expect(launch).toBeGreaterThanOrEqual(BURST_LAUNCH_MIN - 1);
        expect(launch).toBeLessThanOrEqual(BURST_LAUNCH_MAX + 1);
      }
    }
  });

  it('lands below the origin, nearly under the apex — the skewed parabola', () => {
    for (let run = 0; run < 50; run++) {
      for (const p of burstPieces()) {
        const fall = p.y2 - p.y1;
        expect(fall).toBeGreaterThanOrEqual(BURST_FALL_MIN - 1);
        expect(fall).toBeLessThanOrEqual(BURST_FALL_MAX + 1);
        // The apex is at most BURST_LAUNCH_MAX above the origin and the fall
        // is at least BURST_FALL_MIN, so every piece ends below where it began.
        expect(p.y2).toBeGreaterThan(0);
        expect(Math.abs(p.x2 - p.x1)).toBeLessThanOrEqual(BURST_DRIFT_MAX + 1);
      }
    }
  });

  it('keeps size, wobble, duration and delay inside their bounds', () => {
    for (let run = 0; run < 50; run++) {
      for (const p of burstPieces()) {
        expect(p.size).toBeGreaterThanOrEqual(BURST_SIZE_MIN);
        expect(p.size).toBeLessThanOrEqual(BURST_SIZE_MAX);
        expect(p.wobble).toBeGreaterThanOrEqual(BURST_WOBBLE_MIN);
        expect(p.wobble).toBeLessThanOrEqual(BURST_WOBBLE_MAX);
        expect(p.dur).toBeGreaterThanOrEqual(BURST_DUR_MIN);
        expect(p.dur).toBeLessThanOrEqual(BURST_DUR_MAX);
        expect(p.delay).toBeGreaterThanOrEqual(0);
        expect(p.delay).toBeLessThanOrEqual(BURST_DELAY_MAX);
      }
    }
  });

  it('aims the cork along the launch and rests it nose-down, the short way round', () => {
    for (let run = 0; run < 50; run++) {
      for (const p of burstPieces()) {
        expect(p.rest).toBe(REST_DEG);
        // The turn from aim to rest is never the long way round.
        expect(Math.abs(p.aim - p.rest)).toBeLessThanOrEqual(180);
        // The aim really points the cork along the launch direction.
        const launchDeg = (Math.atan2(p.y1, p.x1) * 180) / Math.PI;
        const pointed = ((p.aim + NOSE_DEG - launchDeg) % 360 + 360) % 360;
        expect(Math.min(pointed, 360 - pointed)).toBeLessThanOrEqual(2);
      }
    }
  });

  it('spreads the cone — pieces go left and right of straight up', () => {
    const pieces = burstPieces(200);
    expect(pieces.some((p) => p.x1 > 20)).toBe(true);
    expect(pieces.some((p) => p.x1 < -20)).toBe(true);
    expect(pieces.every((p) => p.y1 < 0)).toBe(true);
  });

  it('varies size piece to piece', () => {
    const sizes = new Set(burstPieces(40).map((p) => p.size));
    expect(sizes.size).toBeGreaterThan(3);
  });

  it('is deterministic for a fixed rng: all zeros fires at the cone edge on the left, at the minimums', () => {
    const [p] = burstPieces(1, seq([0]));
    const launchDeg = -90 - BURST_CONE_HALF_DEG;
    const rad = (launchDeg * Math.PI) / 180;
    expect(p).toEqual({
      id: 0,
      icon: 'pink',
      size: BURST_SIZE_MIN,
      x1: Math.round(Math.cos(rad) * BURST_LAUNCH_MIN),
      y1: Math.round(Math.sin(rad) * BURST_LAUNCH_MIN),
      x2: Math.round(Math.round(Math.cos(rad) * BURST_LAUNCH_MIN) - BURST_DRIFT_MAX),
      y2: Math.round(Math.round(Math.sin(rad) * BURST_LAUNCH_MIN) + BURST_FALL_MIN),
      aim: Math.round(nearestTurn(launchDeg - NOSE_DEG, REST_DEG)),
      rest: REST_DEG,
      wobble: BURST_WOBBLE_MIN,
      dur: BURST_DUR_MIN,
      delay: 0,
    });
  });

  it('a rng that answers 0.5 everywhere fires straight up with no drift', () => {
    const [p] = burstPieces(1, seq([0.5]));
    expect(p.x1).toBe(0);
    expect(p.y1).toBe(-Math.round((BURST_LAUNCH_MIN + BURST_LAUNCH_MAX) / 2));
    expect(p.x2).toBe(0);
    // Straight up is a 180° flip to nose-down; either way round is 180.
    expect(Math.abs(p.aim - p.rest)).toBe(180);
  });
});

describe('nearestTurn', () => {
  it('brings an angle to within a half-turn of the target', () => {
    expect(nearestTurn(350, 0)).toBe(-10);
    expect(nearestTurn(-350, 0)).toBe(10);
    expect(nearestTurn(100, -71)).toBe(100);
    expect(nearestTurn(120, -71)).toBe(-240);
  });
});

describe('the constants the CSS was cut against', () => {
  const css = readFileSync(join(process.cwd(), 'app', 'globals.css'), 'utf8');

  it('the launch/fall boundary in the keyframes matches LAUNCH_FRACTION', () => {
    // The lib says where the apex is in TIME; the keyframe says where it is
    // in the animation. If one moves without the other the fall starts
    // before the apex is reached, or hangs there.
    const flight = css.slice(css.indexOf('@keyframes shuttle-flight'));
    const stops = [...flight.slice(0, flight.indexOf('}\n}') + 3).matchAll(/^\s*(\d+)% \{/gm)].map((m) => Number(m[1]));
    expect(stops).toContain(Math.round(LAUNCH_FRACTION * 100));
  });

  it('the artwork constant points the cork down-left, as the baddicon is drawn', () => {
    // Cork at bottom-left, feathers to the top-right: the cork points at
    // about 161° on screen. If the artwork is ever redrawn, this is the
    // number to re-measure; the attitude keyframes read it through `rest`.
    expect(NOSE_DEG).toBe(161);
    expect(REST_DEG).toBe(90 - 161);
  });
});

describe('burstDurationMs', () => {
  it('is the last landing plus a beat', () => {
    const pieces = burstPieces(3, seq([0.2, 0.9, 0.1, 0.4, 0.7, 0.8, 0.3]));
    const last = Math.max(...pieces.map((p) => p.dur + p.delay));
    expect(burstDurationMs(pieces)).toBe(last + 50);
  });

  it('is a beat for no pieces at all', () => {
    expect(burstDurationMs([])).toBe(50);
  });
});
