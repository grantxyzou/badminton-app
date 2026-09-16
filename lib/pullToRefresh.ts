/**
 * The feel of pull-to-refresh, as numbers. Pure, so the curve and the trigger
 * can be tested without a finger.
 *
 * WHY IT CHANGED (docs/plans/mobile-fluidity.md, 2026-09-16). The first version
 * was linear: a 28px dead zone, then 0.45px of indicator per px of finger, and a
 * trigger at 115px of indicator — about 283px of finger travel, three times iOS
 * Mail's. It also moved at a different speed from the page, which rubber-banded
 * 1:1 underneath it. Now:
 *
 * - The pull is DAMPED, not linear: it follows the finger closely at first and
 *   stiffens as it goes (`MAX * (1 - e^(-d/STIFFNESS))`), which is what a native
 *   pull feels like, and it can never run away down the screen.
 * - It triggers at `TRIGGER` of indicator travel, which is ~100px of finger
 *   after the dead zone — about a third of before.
 * - The page no longer rubber-bands under it: `overscroll-behavior-y: none` on
 *   the root (globals.css) leaves the indicator the ONLY thing that moves.
 */

/** Raw drag ignored before anything moves: the jitter at the top of a scroll. */
export const DEAD_ZONE = 16;
/** The furthest the indicator can travel, however far the finger goes. */
export const MAX_PULL = 130;
/** How quickly the pull stiffens. Larger = looser. */
export const STIFFNESS = 150;
/** Indicator travel that arms a refresh. */
export const TRIGGER = 56;
/** Where the indicator rests while a refresh is running. */
export const HOLD = 68;
/** A refresh that finishes faster than this still shows the spinner this long,
 *  or it reads as a flicker rather than a refresh. */
export const MIN_SPIN_MS = 450;

/** Indicator travel for a raw downward drag. */
export function pullDistance(rawDy: number): number {
  const d = rawDy - DEAD_ZONE;
  if (d <= 0) return 0;
  return MAX_PULL * (1 - Math.exp(-d / STIFFNESS));
}

/** 0 → 1 as the pull approaches the trigger; the ring draws with it. */
export function pullProgress(pull: number): number {
  return Math.max(0, Math.min(1, pull / TRIGGER));
}
