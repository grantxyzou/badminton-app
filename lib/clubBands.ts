import { SKILLS, scoreAssessment, type Dimension, type Rating } from './assessment';

/**
 * Club comparison — where a member's skills sit against everyone else's,
 * expressed only as thirds. Never a number, never a name, never a rank.
 *
 * The whole feature is deliberately coarse. A 12-person club is small enough
 * that a precise percentile is a de-anonymising fact ("you are 7th of 12 at
 * smashes" plus a bit of gossip identifies people), whereas "top third" is not.
 */

export type Band = 'top' | 'middle' | 'bottom';

/**
 * Minimum number of OTHER rated members before any band is computed.
 *
 * Five is not a round number picked for comfort: with a three-way split over
 * fewer people, a band leaks individual positions. Over 3 people a "top third"
 * is literally one named person to anyone who knows who has checked in. This
 * is enforced per skill, not just overall — a member may have rated 14 skills
 * while only two others rated `grip_deception`.
 */
export const MIN_COHORT = 5;

export interface ClubBandsResult {
  /** Rated members excluding the viewer. Returned even when below the minimum. */
  cohort: number;
  minCohort: number;
  dimensionMedians: Record<Dimension, number | null>;
  /** The middle half of the club per dimension (25th–75th percentile), under
   *  the same per-dimension cohort rule as the median. Additive, 2026-10-20:
   *  "Where you sit" draws it as the band the member's dot sits against. */
  dimensionSpread: Record<Dimension, DimensionSpread | null>;
  skills: { skillKey: string; band: Band }[];
}

export interface DimensionSpread {
  p25: number;
  p75: number;
}

const DIMENSIONS: Dimension[] = ['technical', 'physical', 'mental'];

/** Median of a numeric list; null when empty. Even-length averages the middle pair. */
export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * The q-th quantile (0–1) by linear interpolation between closest ranks; null
 * when empty. A spread, not a position: it says where the club's middle half
 * sits, never who sits where.
 */
export function quantile(values: number[], q: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/**
 * Which third `value` falls into relative to `others`.
 *
 * Uses a percentile RANK (fraction below, plus half the ties) rather than
 * tertile cut-points on the raw values. Ratings are a 1–5 integer scale, so
 * ties are the common case, and cut-points handle them badly: with a cohort
 * all rated 3, a cut-point comparison puts a 3 in the top third, which is
 * plainly wrong. The mid-rank convention puts it in the middle, where it
 * belongs.
 */
export function bandFor(value: number, others: number[]): Band {
  if (others.length === 0) return 'middle';
  let below = 0;
  let equal = 0;
  for (const o of others) {
    if (o < value) below += 1;
    else if (o === value) equal += 1;
  }
  const rank = (below + equal / 2) / others.length;
  if (rank >= 2 / 3) return 'top';
  if (rank < 1 / 3) return 'bottom';
  return 'middle';
}

const round1 = (n: number) => Math.round(n * 10) / 10;

function ratingMap(ratings: Rating[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of ratings) {
    if (r && typeof r.skillKey === 'string' && typeof r.value === 'number') {
      m.set(r.skillKey, r.value);
    }
  }
  return m;
}

export interface ComputeClubBandsInput {
  /** The viewer's latest ratings. */
  viewer: Rating[];
  /** Every OTHER rated member's latest ratings. The viewer must be excluded. */
  others: Rating[][];
  minCohort?: number;
}

/**
 * Bands per skill plus the club's median per dimension.
 *
 * `dimensionMedians` (and `dimensionSpread`, its middle half) is the CLUB SPREAD and is returned whenever the cohort is
 * large enough — including when the viewer has opted out of comparison. That is
 * deliberate and not an oversight: opting out hides the member's own band and
 * nothing else. Taking the spread away too would make a privacy choice cost
 * them something, which is a penalty, not a preference.
 */
export function computeClubBands({
  viewer,
  others,
  minCohort = MIN_COHORT,
}: ComputeClubBandsInput): ClubBandsResult {
  const cohort = others.length;
  const empty: Record<Dimension, number | null> = { technical: null, physical: null, mental: null };

  const noSpread: Record<Dimension, DimensionSpread | null> = { technical: null, physical: null, mental: null };
  if (cohort < minCohort) {
    return { cohort, minCohort, dimensionMedians: empty, dimensionSpread: noSpread, skills: [] };
  }

  const otherMaps = others.map(ratingMap);
  const viewerMap = ratingMap(viewer);

  const dimensionMedians = { ...empty };
  const dimensionSpread = { ...noSpread };
  for (const dim of DIMENSIONS) {
    const scores = others
      .map((r) => scoreAssessment(r).dimensionScores[dim])
      .filter((s): s is number => typeof s === 'number');
    // Per-dimension cohort is checked separately — a dimension only two people
    // have rated is as identifying as a skill only two people have rated.
    dimensionMedians[dim] = scores.length >= minCohort ? median(scores) : null;
    dimensionSpread[dim] = scores.length >= minCohort
      ? { p25: round1(quantile(scores, 0.25)!), p75: round1(quantile(scores, 0.75)!) }
      : null;
  }

  const skills: { skillKey: string; band: Band }[] = [];
  for (const skill of SKILLS) {
    const mine = viewerMap.get(skill.key);
    if (typeof mine !== 'number') continue;
    const theirs = otherMaps
      .map((m) => m.get(skill.key))
      .filter((v): v is number => typeof v === 'number');
    if (theirs.length < minCohort) continue;
    skills.push({ skillKey: skill.key, band: bandFor(mine, theirs) });
  }

  return { cohort, minCohort, dimensionMedians, dimensionSpread, skills };
}
