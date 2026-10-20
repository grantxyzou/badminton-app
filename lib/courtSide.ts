import type { PlayerGear } from './types';
import type { PlayFormat } from './tension';

/**
 * Which half of the court a mixed-doubles player covers, from the Fit page's
 * "Mostly you play" tiles (Mixed · front, Mixed · back). Grant, 2026-10-20:
 * the side was stored and nothing read it, so a front-court and a back-court
 * player got the same racket as someone who answered All-around.
 *
 * The side REFINES an undecided format, never overrides a decided one: the
 * Fit page writes `playFormat: 'both'` for a mixed answer, and a later tap on
 * the String tension card's Doubles / Singles toggle writes an explicit
 * format, which wins.
 */
export type CourtSide = 'front' | 'back';

export function courtSideOf(gear: Pick<PlayerGear, 'fitPlayStyle' | 'playFormat'> | null | undefined): CourtSide | null {
  if (!gear) return null;
  if (gear.playFormat === 'singles' || gear.playFormat === 'doubles') return null;
  if (gear.fitPlayStyle === 'mixed_front') return 'front';
  if (gear.fitPlayStyle === 'mixed_back') return 'back';
  return null;
}

/**
 * The format the string and tension engines read. Front court plays like
 * doubles (quick, flat exchanges at the net); back court like singles (length
 * and power from the rear), which those engines already know how to answer.
 * The racket engine reads the side itself instead (`FitInput.courtSide`),
 * because its format reasons name singles and doubles out loud.
 */
export function sideFormat(gear: Pick<PlayerGear, 'fitPlayStyle' | 'playFormat'> | null | undefined): PlayFormat {
  const side = courtSideOf(gear);
  if (side === 'front') return 'doubles';
  if (side === 'back') return 'singles';
  return gear?.playFormat ?? 'both';
}
