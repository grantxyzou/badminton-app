import type { Rating } from './assessment';
import type { PlayerGear } from './types';
import { activeRacket } from './activeRacket';

/**
 * The recommender's view of a player. Field names follow the supplied scoring
 * engine, not the app's assessment keys — SKILL_MAP below is the single place
 * the two vocabularies meet.
 */
export interface PlayerProfile {
  serves: number; net_play: number; clears: number; drops: number;
  drives: number; smashes: number; grip: number;
  footwork: number; court_coverage: number; stamina: number;
  game_reading: number; consistency: number; rules: number; mindset: number;
  format: 'singles' | 'doubles' | 'both';
  budgetMaxCad?: number;
  currentRacketId?: string;
}

/** App assessment key -> engine profile field. The check-in's fourteen skills
 *  map 1:1; only the names differ. */
const SKILL_MAP: Record<string, keyof PlayerProfile> = {
  serves_returns: 'serves',
  net_play: 'net_play',
  clears_lifts: 'clears',
  drops: 'drops',
  drives: 'drives',
  smashes: 'smashes',
  grip_deception: 'grip',
  footwork_split_step: 'footwork',
  court_coverage: 'court_coverage',
  speed_stamina: 'stamina',
  game_reading: 'game_reading',
  consistency: 'consistency',
  rules_strategy: 'rules',
  training_mindset: 'mindset',
};

/** What an unrated skill counts as. Matches the engine's own defaults: a
 *  mid-scale 3 is "no signal", not "weak". */
const DEFAULT_SKILL = 3;

/**
 * Build a profile from the player's latest assessment and their gear doc.
 *
 * Returns **null** when there are no ratings at all. That is deliberate: with
 * no signal the engine would score fourteen 3s and emit a confident,
 * meaningless pick — the exact failure the redesign exists to remove. Callers
 * render a "do the check-in" state instead (spec D5).
 *
 * Partial ratings are normal, not an error: `validateRatings` in
 * app/api/assessments/route.ts accepts any subset of one or more skills.
 */
export function buildProfile(input: {
  ratings: Rating[];
  gear: PlayerGear | null;
}): PlayerProfile | null {
  if (!input.ratings || input.ratings.length === 0) return null;

  const profile: PlayerProfile = {
    serves: DEFAULT_SKILL, net_play: DEFAULT_SKILL, clears: DEFAULT_SKILL, drops: DEFAULT_SKILL,
    drives: DEFAULT_SKILL, smashes: DEFAULT_SKILL, grip: DEFAULT_SKILL,
    footwork: DEFAULT_SKILL, court_coverage: DEFAULT_SKILL, stamina: DEFAULT_SKILL,
    game_reading: DEFAULT_SKILL, consistency: DEFAULT_SKILL, rules: DEFAULT_SKILL, mindset: DEFAULT_SKILL,
    format: input.gear?.playFormat ?? 'both',
  };

  for (const rating of input.ratings) {
    const field = SKILL_MAP[rating.skillKey];
    if (!field) continue; // unknown key — ignore rather than throw
    if (typeof rating.value !== 'number') continue;
    (profile as unknown as Record<string, number>)[field] = rating.value;
  }

  if (typeof input.gear?.budgetMaxCad === 'number') profile.budgetMaxCad = input.gear.budgetMaxCad;
  const current = activeRacket(input.gear ?? null);
  if (current?.catalogId) profile.currentRacketId = current.catalogId;

  return profile;
}
