/**
 * The sign-up shuttle burst: fourteen brand shuttlecocks that fly off the
 * "I'm in this week" button the moment the server confirms a sign-up
 * (docs/plans/signup-shuttle-burst.md).
 *
 * This file is the geometry only — pure, no DOM, no clock — so every random
 * choice can be pinned by a test through the injectable `rng`. The request
 * was "size and direction should be random", and each piece gets its own:
 * an angle over the full circle, a distance, a size, a spin, a flight time
 * and a start delay. `Math.random` is fine for this: nothing here is an
 * identifier (the `randomBytes` rule is for ids).
 */

export type BurstIcon = 'pink' | 'yello' | 'green';

export interface BurstPiece {
  id: number;
  /** One of the three brand baddicons, the same set PinInput cycles. */
  icon: BurstIcon;
  /** Rendered width in px; height follows the asset's 24:22 box. */
  size: number;
  /** Where the piece ends, relative to the origin, in px. */
  dx: number;
  dy: number;
  /** Total spin over the flight, in degrees. Either direction. */
  rot: number;
  /** Flight time and start delay, in ms. */
  dur: number;
  delay: number;
}

export const BURST_COUNT = 14;

/** Filename stems under public/brand/ (`baddicon-yello` ships spelled so). */
export const BURST_ICONS: readonly BurstIcon[] = ['pink', 'yello', 'green'];

export const BURST_SIZE_MIN = 12;
export const BURST_SIZE_MAX = 26;
export const BURST_DISTANCE_MIN = 56;
export const BURST_DISTANCE_MAX = 140;
export const BURST_ROT_MAX = 200;
export const BURST_DUR_MIN = 600;
export const BURST_DUR_MAX = 900;
export const BURST_DELAY_MAX = 80;
/** A little gravity: every piece lands a touch lower than it aimed. */
export const BURST_DROP = 24;

const lerp = (min: number, max: number, t: number) => min + (max - min) * t;

/**
 * `count` pieces, each independently random through `rng` (a `() => number`
 * in [0, 1), `Math.random` by default). Deterministic for a fixed rng.
 */
export function burstPieces(count = BURST_COUNT, rng: () => number = Math.random): BurstPiece[] {
  const pieces: BurstPiece[] = [];
  for (let i = 0; i < count; i++) {
    const angle = rng() * Math.PI * 2;
    const distance = lerp(BURST_DISTANCE_MIN, BURST_DISTANCE_MAX, rng());
    pieces.push({
      id: i,
      icon: BURST_ICONS[i % BURST_ICONS.length],
      size: Math.round(lerp(BURST_SIZE_MIN, BURST_SIZE_MAX, rng())),
      dx: Math.round(Math.cos(angle) * distance),
      dy: Math.round(Math.sin(angle) * distance + BURST_DROP),
      rot: Math.round(lerp(-BURST_ROT_MAX, BURST_ROT_MAX, rng())),
      dur: Math.round(lerp(BURST_DUR_MIN, BURST_DUR_MAX, rng())),
      delay: Math.round(rng() * BURST_DELAY_MAX),
    });
  }
  return pieces;
}

/** How long the whole burst is on screen: the last piece's landing, plus a beat. */
export function burstDurationMs(pieces: readonly BurstPiece[]): number {
  return pieces.reduce((max, p) => Math.max(max, p.dur + p.delay), 0) + 50;
}
