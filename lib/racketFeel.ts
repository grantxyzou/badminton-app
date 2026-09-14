import { levelTierLabel, type FitLevel } from './racketFit';
import {
  FEEL_BALANCES, FEEL_FLEXES, FEEL_WEIGHTS,
  type CatalogItem, type GearItem, type RacketFeel,
} from './types';

/**
 * A racket the catalog does not have, described by the member who plays it.
 *
 * "Log it by name" and "ask how it feels" (Grant, 2026-09-14): a member whose
 * racket is missing types its name, and three optional questions — balance,
 * shaft, weight — let the fit engine read it the way it reads a catalog row.
 * The answers are stored on the bag item, so they leave with it when it is
 * removed, and every typed name is data about what the club really plays.
 */

const WEIGHT_GRAMS: Record<NonNullable<RacketFeel['weight']>, [number, number]> = {
  '3U': [85, 89],
  '4U': [80, 84],
  '5U': [75, 79],
};

/**
 * The stored answers, or null when the value is not a feel at all. Unknown
 * keys are dropped and an answer outside the vocabulary is refused, because
 * the engine's axis tables are keyed on these exact strings and an unknown one
 * would silently read as "not answered".
 */
export function parseFeel(raw: unknown): RacketFeel | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const out: RacketFeel = {};
  for (const [key, allowed] of [['balance', FEEL_BALANCES], ['flex', FEEL_FLEXES], ['weight', FEEL_WEIGHTS]] as const) {
    const v = r[key];
    if (v === undefined || v === null) continue;
    if (!(allowed as readonly unknown[]).includes(v)) return null;
    (out as Record<string, unknown>)[key] = v;
  }
  return out;
}

/** True when there is at least one answer worth storing. */
export function hasFeel(feel: RacketFeel | undefined | null): feel is RacketFeel {
  return !!feel && (feel.balance !== undefined || feel.flex !== undefined || feel.weight !== undefined);
}

/**
 * The typed-in racket as an ANCHOR for the fit engine, or null.
 *
 * Balance and shaft are both required: those two are what `axesOf` cannot do
 * without, and a guess at either is the fit-1 defect the engine was rebuilt to
 * remove. Weight is optional — the engine already falls back to the level's
 * weight for a catalog row with no grams.
 *
 * Tier is the one axis nobody can answer about their own racket, so it is the
 * member's LEVEL tier: the same starting point an unanchored member gets, which
 * keeps a typed-in racket from moving a beginner's picks up a price band.
 *
 * The row exists only inside one `FitInput`. It is never offered, never listed
 * and never written anywhere.
 */
export function feelAnchor(item: GearItem | null, level: FitLevel | null): CatalogItem | null {
  if (!item || item.catalogId || (item.category ?? 'racket') !== 'racket') return null;
  const feel = item.feel;
  if (!feel?.balance || !feel.flex) return null;
  const attributes: Record<string, string | number> = {
    balance: feel.balance,
    flex: feel.flex,
    tier: levelTierLabel(level),
  };
  if (feel.weight) {
    attributes.weight = feel.weight;
    [attributes.weightMinG, attributes.weightMaxG] = WEIGHT_GRAMS[feel.weight];
  }
  return {
    id: `feel:${item.id}`,
    category: 'racket',
    brand: '',
    model: item.label,
    skillRange: [1, 6],
    attributes,
  };
}
