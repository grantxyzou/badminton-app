import { checkRateLimit } from './rateLimit';

/**
 * A DAILY AI ALLOWANCE PER CLUB (docs/plans/club-ai-cap.md; Grant, 2026-11-16:
 * "add the per-club AI cap").
 *
 * Every AI feature runs on ONE key, the deployment's `ANTHROPIC_API_KEY`, so
 * every club's use lands on one bill. The limits each route already had are
 * per caller and per person; none was per club, so a club with many members
 * or many stringers could spend without a ceiling. This is that ceiling: each
 * feature gets its own allowance per club per day, so a busy club's photos
 * can never starve its members' Stats reads.
 *
 * Over the allowance, a feature does what it already does with no key: the
 * Stats read serves the last one it wrote, the fit verdict uses its templated
 * words, the stocktake counts by hand, the writing helper says try tomorrow.
 *
 * Charged only right before a REAL model call — a cached answer costs nothing
 * and takes nothing. In-memory, like every limiter here: it resets on a
 * restart (a deploy), which can only ever let a club through, never lock one
 * out wrongly (`__tests__/single-instance-registry.test.ts` holds the store).
 */

export type AiFeature = 'writing' | 'insight' | 'fitVerdict' | 'stocktake';

/** Calls per club per day. Generous for a club of ~70: they bound a bill, they are not a quota to plan around. */
export const CLUB_AI_DAILY: Readonly<Record<AiFeature, number>> = {
  /** Admin writing help: announcements, release notes. */
  writing: 60,
  /** The Stats read: cached per member per session, so one a member a week is the norm. */
  insight: 300,
  /** The racket-fit words: cached per member per frame. */
  fitVerdict: 300,
  /** Shelf photos: a stocktake is a few photos a month. */
  stocktake: 30,
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** Spend one of the club's calls for this feature today; `false` = the allowance is used up. */
export function takeClubAiCall(groupId: string, feature: AiFeature): boolean {
  return checkRateLimit(`ai-club:${feature}:${groupId}`, CLUB_AI_DAILY[feature], DAY_MS);
}
