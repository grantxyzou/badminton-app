import type { ReelColourId } from './stringPalette';

/**
 * THE STOCKTAKE's arithmetic — client-safe, no I/O (docs/plans/string-photo-stocktake.md).
 *
 * The shelf's stock is worked out: bought minus strung. A stocktake is the
 * other side of that — someone counts what is physically there, and the count
 * wins. Like a shop's stocktake: the till says eleven cans, someone counts
 * eight, and from then on the shelf starts from eight.
 *
 * A count is saved per string as SETS, whatever way it was counted: packets
 * are one set each, a reel judged by eye is its share of a full reel, and a
 * reel on the scale is its string's weight over the grams per metre.
 */

export const STRING_COUNT_KIND = 'stringCount';
/** How a part-used reel's fullness was judged by eye, as a share of a full reel. */
export const FULLNESS = { full: 1, three_quarters: 0.75, half: 0.5, quarter: 0.25 } as const;
export type Fullness = keyof typeof FULLNESS;
export const FULLNESS_ORDER: readonly Fullness[] = ['full', 'three_quarters', 'half', 'quarter'];
export const isFullness = (v: unknown): v is Fullness => typeof v === 'string' && v in FULLNESS;

/** Nylon multifilament, close enough for a shelf: ~1.14 g per cm³. */
const NYLON_G_PER_CM3 = 1.14;
/** A badminton string of no known gauge: about 0.68 mm. */
export const DEFAULT_GRAMS_PER_METRE = 0.41;
export const MAX_COUNT_SETS = 2000;
export const MAX_GRAMS = 5000;

/**
 * Grams in one metre of a string of this gauge: the cross-section × 100 cm ×
 * nylon's density. An estimate — a braided string holds air — which is why the
 * sheet shows it and lets the counter change it (and remembers what they used).
 */
export function gramsPerMetre(gaugeMm: number | null | undefined): number {
  if (typeof gaugeMm !== 'number' || !(gaugeMm > 0) || gaugeMm > 2) return DEFAULT_GRAMS_PER_METRE;
  const rCm = gaugeMm / 20; // mm → cm, then the radius
  return Math.round(Math.PI * rCm * rCm * 100 * NYLON_G_PER_CM3 * 1000) / 1000;
}

/** Whole sets in a reel judged by eye. */
export function setsByEye(fullness: Fullness, reelMetres: number, setMetres: number): number {
  if (!(setMetres > 0) || !(reelMetres > 0)) return 0;
  return Math.round((FULLNESS[fullness] * reelMetres) / setMetres);
}

/** Metres on a weighed reel: (scale − empty reel) ÷ grams per metre. Never below zero. */
export function metresByWeight(grams: number, tareGrams: number, gPerM: number): number {
  if (!(gPerM > 0) || !Number.isFinite(grams) || !Number.isFinite(tareGrams)) return 0;
  return Math.max(0, (grams - tareGrams) / gPerM);
}

/** Whole sets on a weighed reel: a part set left on the reel is not a set. */
export function setsByWeight(grams: number, tareGrams: number, gPerM: number, setMetres: number): number {
  if (!(setMetres > 0)) return 0;
  return Math.floor(metresByWeight(grams, tareGrams, gPerM) / setMetres);
}

/** One string's line in a saved count. */
export interface StringCountLine {
  /** The shelf label it was counted as. */
  label: string;
  /** Sets counted, all ways added up. */
  sets: number;
  /** A reel colour id when the counter said which; absent = mixed / not sure. */
  color?: ReelColourId;
  /** What the app said was there at the moment of the count, for the record. */
  appSets: number;
  /** How it was counted, for the record and to prefill the next weigh-in. */
  packets?: number;
  reels?: Array<{ by: 'eye'; fullness: Fullness } | { by: 'weigh'; grams: number; tareGrams: number; gramsPerMetre: number }>;
}

export interface StringCount {
  id: string;
  groupId?: string;
  kind: typeof STRING_COUNT_KIND;
  /** ISO. Jobs strung after this, and purchases logged after it, move the shelf from the count. */
  countedAt: string;
  countedBy: string;
  /** Whether a photo proposed the figures (a person still confirmed each line). */
  source: 'photo' | 'hand';
  lines: StringCountLine[];
}

/** The latest weigh-in for a label, so the next one starts from the same empty-reel weight. */
export function lastWeighIn(counts: readonly StringCount[], label: string): { tareGrams: number; gramsPerMetre: number } | null {
  const key = label.trim().toLowerCase();
  const sorted = counts.slice().sort((a, b) => (a.countedAt < b.countedAt ? 1 : -1));
  for (const c of sorted) {
    for (const l of c.lines) {
      if (l.label.trim().toLowerCase() !== key) continue;
      const w = l.reels?.find((r): r is Extract<NonNullable<StringCountLine['reels']>[number], { by: 'weigh' }> => r.by === 'weigh');
      if (w) return { tareGrams: w.tareGrams, gramsPerMetre: w.gramsPerMetre };
    }
  }
  return null;
}
