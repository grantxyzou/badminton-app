/**
 * The sign-up shuttle burst: fourteen brand shuttlecocks that fly off the
 * "I'm in this week" button once the server confirms a sign-up
 * (docs/plans/signup-shuttle-burst.md).
 *
 * This file is the geometry only — pure, no DOM, no clock — so every random
 * choice can be pinned by a test through the injectable `rng`. `Math.random`
 * is fine for this: nothing here is an identifier (the `randomBytes` rule is
 * for ids).
 *
 * THE MOTION IS A SHUTTLE'S, NOT A SPARK'S (physics pass, 2026-09-28).
 * The first cut flew each piece in a straight line from the button to a
 * random point and faded it — which reads as neither confetti nor
 * badminton. A real shuttlecock has two phases and a fixed attitude:
 *
 *   1. LAUNCH. It leaves fast and loses that speed within a few tenths of a
 *      second, because its drag rises with the square of its speed (a smash
 *      goes from ~240 km/h to near terminal speed in ~0.6 s). So the launch
 *      segment is a hard ease-out: most of the distance in the first third.
 *   2. FALL. It settles to a terminal speed of ~6.8 m/s and comes down almost
 *      vertically at a steady pace — the trajectory is a "skewed parabola",
 *      long on the way out and steep on the way back. So the fall segment
 *      eases in briefly, then runs LINEAR (constant speed), and the landing
 *      sits only a little to the side of the apex.
 *   3. ATTITUDE. The cork always leads: within ~20 ms of the hit it flips
 *      nose-first and thereafter points along its velocity, and on the way
 *      down it spins and rocks a little. So the piece's rotation is not a
 *      random spin — it aims along the launch, turns nose-down through the
 *      apex, and wobbles gently as it falls.
 *
 * Confetti supplies the rest: a popper fires in an UPWARD cone, not in every
 * direction, the pieces leave at staggered instants, and they linger — so
 * the cone is up, the delays are spread, and the whole flight is longer than
 * the first cut's.
 *
 * The component maps these to CSS custom properties and two keyframes
 * (`shuttle-flight` for the path, `shuttle-attitude` for the rotation), with
 * the phase boundary fixed at LAUNCH_FRACTION of each piece's duration.
 */

export type BurstIcon = 'pink' | 'yello' | 'green';

export interface BurstPiece {
  id: number;
  /** One of the three brand baddicons, the same set PinInput cycles. */
  icon: BurstIcon;
  /** Rendered width in px; height follows the asset's 24:22 box. */
  size: number;
  /** The apex — where the launch runs out of speed — relative to the origin, px. */
  x1: number;
  y1: number;
  /** The landing, relative to the origin, px. Below the origin, nearly under the apex. */
  x2: number;
  y2: number;
  /** Rotation that points the cork along the launch direction, in degrees. */
  aim: number;
  /** Rotation that points the cork straight down, in degrees (the artwork's constant). */
  rest: number;
  /** Half-amplitude of the rock on the way down, in degrees. */
  wobble: number;
  /** Whole flight and start delay, in ms. */
  dur: number;
  delay: number;
}

export const BURST_COUNT = 14;

/** Filename stems under public/brand/ (`baddicon-yello` ships spelled so). */
export const BURST_ICONS: readonly BurstIcon[] = ['pink', 'yello', 'green'];

export const BURST_SIZE_MIN = 12;
export const BURST_SIZE_MAX = 26;

/** The popper cone: this many degrees either side of straight up. */
export const BURST_CONE_HALF_DEG = 75;
/** How far the launch carries before drag wins, px. */
export const BURST_LAUNCH_MIN = 50;
export const BURST_LAUNCH_MAX = 150;
/** How far below the APEX the piece lands, px. Past the origin and off the card. */
export const BURST_FALL_MIN = 180;
export const BURST_FALL_MAX = 300;
/** Sideways drift during the fall, px either way. Small: horizontal speed has decayed. */
export const BURST_DRIFT_MAX = 22;
/** Rock either side of nose-down on the way down, degrees. */
export const BURST_WOBBLE_MIN = 6;
export const BURST_WOBBLE_MAX = 14;
export const BURST_DUR_MIN = 1000;
export const BURST_DUR_MAX = 1400;
export const BURST_DELAY_MAX = 160;
/** The launch phase is this fraction of the flight; the keyframes are cut here. */
export const LAUNCH_FRACTION = 0.3;

/**
 * Where the artwork's cork points, as a screen angle (0° = right, 90° = down,
 * clockwise positive — the CSS convention). In `baddicon-*.svg` the cork is
 * the round blob at bottom-left and the feathers fan out to the top-right,
 * so the cork points down-left at about 161°. `rotate(θ - NOSE_DEG)` turns
 * the picture so its cork points at screen angle θ.
 */
export const NOSE_DEG = 161;

/** The rotation that points the cork straight down. */
export const REST_DEG = 90 - NOSE_DEG;

const lerp = (min: number, max: number, t: number) => min + (max - min) * t;

/** Bring `deg` to within ±180° of `around`, so a rotation between them takes the short way. */
export function nearestTurn(deg: number, around: number): number {
  let d = deg;
  while (d - around > 180) d -= 360;
  while (d - around <= -180) d += 360;
  return d;
}

/**
 * `count` pieces, each independently random through `rng` (a `() => number`
 * in [0, 1), `Math.random` by default). Deterministic for a fixed rng.
 */
export function burstPieces(count = BURST_COUNT, rng: () => number = Math.random): BurstPiece[] {
  const pieces: BurstPiece[] = [];
  for (let i = 0; i < count; i++) {
    // Screen angle of the launch: straight up is -90°; the cone is ±HALF around it.
    const launchDeg = -90 + lerp(-BURST_CONE_HALF_DEG, BURST_CONE_HALF_DEG, rng());
    const launch = lerp(BURST_LAUNCH_MIN, BURST_LAUNCH_MAX, rng());
    const rad = (launchDeg * Math.PI) / 180;
    const x1 = Math.round(Math.cos(rad) * launch);
    const y1 = Math.round(Math.sin(rad) * launch);
    const fall = lerp(BURST_FALL_MIN, BURST_FALL_MAX, rng());
    const drift = lerp(-BURST_DRIFT_MAX, BURST_DRIFT_MAX, rng());
    pieces.push({
      id: i,
      icon: BURST_ICONS[i % BURST_ICONS.length],
      size: Math.round(lerp(BURST_SIZE_MIN, BURST_SIZE_MAX, rng())),
      x1,
      y1,
      x2: Math.round(x1 + drift),
      y2: Math.round(y1 + fall),
      aim: Math.round(nearestTurn(launchDeg - NOSE_DEG, REST_DEG)),
      rest: REST_DEG,
      wobble: Math.round(lerp(BURST_WOBBLE_MIN, BURST_WOBBLE_MAX, rng())),
      dur: Math.round(lerp(BURST_DUR_MIN, BURST_DUR_MAX, rng())),
      // The LEAD shuttle leaves at once, with the haptic tap; the rest trail
      // it. Random delays alone could hold the first visible movement back
      // by tens of ms, and the tap would land on nothing. The rng is still
      // drawn so every other piece keeps the sequence a test pins.
      delay: leadDelay(i, rng()),
    });
  }
  return pieces;
}

function leadDelay(i: number, r: number): number {
  return i === 0 ? 0 : Math.round(r * BURST_DELAY_MAX);
}

/** How long the whole burst is on screen: the last piece's landing, plus a beat. */
export function burstDurationMs(pieces: readonly BurstPiece[]): number {
  return pieces.reduce((max, p) => Math.max(max, p.dur + p.delay), 0) + 50;
}
