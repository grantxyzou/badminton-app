import { FIT_LEVEL_OPTIONS, type FitArmComfort, type FitLevelOption, type PlayerGear } from './types';

/**
 * The fit profile's five answers (design "Equipment redesign" Turn 3, 3a):
 * level, what you mostly play, swing speed, grip size, anything sore. Pure.
 *
 * The page asks in its own words, and the engines already read the older
 * answers, so this is where the two meet: a sore elbow on the page is what the
 * racket and string engines have always called an arm that gets sore.
 */

/** The comfort answer the engines read. The page's soreness question wins
 *  when it has been answered; a doc from before it keeps its old answer. */
export function effectiveArmComfort(gear: Pick<PlayerGear, 'fitSoreness' | 'fitArmComfort'> | null | undefined): FitArmComfort | undefined {
  const sore = gear?.fitSoreness;
  if (sore === 'none') return 'fine';
  // A named joint says "sore", not how often. An older "often sore" answer
  // is the stronger of the two, so it is kept rather than eased by a pound.
  if (sore === 'elbow' || sore === 'shoulder' || sore === 'wrist') {
    return gear?.fitArmComfort === 'often_sore' ? 'often_sore' : 'sometimes_sore';
  }
  return gear?.fitArmComfort;
}

/** The number a level option stands for ("3.5+" is 3.5). */
export function levelOptionValue(option: FitLevelOption): number {
  return Number.parseFloat(option);
}

/** The option closest to a check-in level, or null with no level. */
export function nearestLevelOption(level: number | null | undefined): FitLevelOption | null {
  if (typeof level !== 'number' || !Number.isFinite(level)) return null;
  if (level >= 3.5) return '3.5+';
  let best: FitLevelOption = FIT_LEVEL_OPTIONS[0];
  for (const o of FIT_LEVEL_OPTIONS) {
    if (Math.abs(levelOptionValue(o) - level) < Math.abs(levelOptionValue(best) - level)) best = o;
  }
  return best;
}

export interface FitAnswers {
  level: FitLevelOption | null;
  playStyle: PlayerGear['fitPlayStyle'] | null;
  swing: PlayerGear['fitSwing'] | null;
  grip: PlayerGear['fitGrip'] | null;
  soreness: PlayerGear['fitSoreness'] | null;
  /** 0–5: the header's "n of 5". */
  answered: number;
}

/**
 * The five answers as the page shows them. Level counts as answered when the
 * member set it OR a check-in gave one — the design pre-fills it from the
 * check-in, and "4 of 5" for a member who never touched a pre-filled row would
 * be asking them to answer a question they can already see answered.
 */
export function fitAnswers(gear: PlayerGear | null | undefined, checkInLevel: number | null | undefined): FitAnswers {
  const level = gear?.fitLevelOverride ?? nearestLevelOption(checkInLevel);
  const playStyle = gear?.fitPlayStyle ?? null;
  const swing = gear?.fitSwing ?? null;
  const grip = gear?.fitGrip ?? null;
  const soreness = gear?.fitSoreness ?? null;
  const answered = [level, playStyle, swing, grip, soreness].filter((v) => v !== null && v !== undefined).length;
  return { level, playStyle, swing, grip, soreness, answered };
}
