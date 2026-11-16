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
 * words, the stocktake counts by hand.
 *
 * Charged only right before a REAL model call — a cached answer costs nothing
 * and takes nothing. In-memory, like every limiter here: it resets on a
 * restart (a deploy), which can only ever let a club through, never lock one
 * out wrongly (`__tests__/single-instance-registry.test.ts` holds the store).
 */

export type AiFeature = 'insight' | 'fitVerdict' | 'stocktake';

/**
 * Calls per club per day. A runaway ceiling, not a quota: a club of 30 uses
 * about 30-90 Stats reads a WEEK (one per member per session), a handful of
 * fit verdicts ever, and a photo or two per stocktake. Grant, 2026-11-16, set
 * these down from 300 / 300 / 30.
 *
 * The admin writing helper is NOT here: it is the operator's alone
 * (`app/api/claude/route.ts`, `isOperator`), so no club spends on it.
 */
export const CLUB_AI_DAILY: Readonly<Record<AiFeature, number>> = {
  /** The Stats read: cached per member per session, so one a member a week is the norm. */
  insight: 100,
  /** The racket-fit words: cached per member per frame, rewritten only when the facts move. */
  fitVerdict: 100,
  /** Shelf photos: a stocktake is one photo, sometimes two. */
  stocktake: 10,
};

/** The features a member spends on their own behalf, and so carry a PERSON's allowance too. */
export type PersonAiFeature = 'insight' | 'fitVerdict';

/**
 * Calls per PERSON per day, so one member cannot spend their club's share:
 * a busy day is a fresh read after a check-in and a language switch, or a
 * few frames tried in the fit picker.
 */
export const PERSON_AI_DAILY: Readonly<Record<PersonAiFeature, number>> = {
  insight: 5,
  fitVerdict: 10,
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** Spend one of the club's calls for this feature today; `false` = the allowance is used up. */
export function takeClubAiCall(groupId: string, feature: AiFeature): boolean {
  return checkRateLimit(`ai-club:${feature}:${groupId}`, CLUB_AI_DAILY[feature], DAY_MS);
}

/** Spend one of this person's calls for this feature today; `false` = their allowance is used up. */
export function takePersonAiCall(memberId: string, feature: PersonAiFeature): boolean {
  return checkRateLimit(`ai-person:${feature}:${memberId}`, PERSON_AI_DAILY[feature], DAY_MS);
}

/**
 * The person's allowance FIRST, then the club's, so a person over their own
 * never spends the club's. `null` = go ahead; otherwise which one said no.
 */
export function takeMemberAiCall(groupId: string, memberId: string, feature: PersonAiFeature): 'person' | 'club' | null {
  if (!takePersonAiCall(memberId, feature)) return 'person';
  if (!takeClubAiCall(groupId, feature)) return 'club';
  return null;
}
