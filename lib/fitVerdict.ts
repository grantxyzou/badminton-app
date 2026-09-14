import { activeRacket } from './activeRacket';
import { effectiveArmComfort, fitAnswers, levelOptionValue } from './fitProfile';
import { BALANCE_AXIS, GOAL_DELTA, comfortTensionDeltaLb } from './racketFit';
import type { PlayerProfile } from './racketProfile';
import { pairTension } from './stringPair';
import { MAX_LB, MIN_LB, ratedRange, recommendTension, type PlayFormat } from './tension';
import type { CatalogItem, GearItem, PlayerGear } from './types';

/**
 * THE FIT VERDICT'S FACTS AND STATE — the one place the judgement lives.
 *
 * The design handoff is explicit that this heuristic is a product decision that
 * has not been signed off, and that the app must not say more than the data
 * supports. So the STATE and every NUMBER are decided here, deterministically;
 * an AI may put them into words (`/api/equipment/fit-verdict`) but cannot
 * change them, and with no AI the page words them itself.
 *
 * It invents no opinion of its own where the engines already hold one:
 *   - what a goal wants from a frame's balance is `GOAL_DELTA`, the racket fit
 *     engine's table, so the verdict and the ranked frames beside it cannot
 *     disagree about the same racket;
 *   - the tension is `pairTension` — the figure the Set-up card's string pick
 *     quotes — whenever the frame, the string and a check-in are all known,
 *     and otherwise the level's starting point (`recommendTension`). Both take
 *     the same comfort delta and sit inside the same `ratedRange`.
 *
 * Tune the weights below and the tests that pin them; nothing else decides
 * whether a racket "suits" someone.
 */

export type VerdictState = 'suits' | 'fighting_slightly' | 'fighting' | 'insufficient';

export type VerdictReasonKey =
  | 'goalAgainstBalance'
  | 'goalWithBalance'
  | 'shaftTooStiff'
  | 'shaftTooSoft'
  | 'shaftFitsSwing'
  | 'heavyForArm'
  | 'tensionHigh'
  | 'tensionLow'
  | 'tensionInRange';

export interface VerdictReason {
  key: VerdictReasonKey;
  polarity: 'plus' | 'minus';
}

export interface FitFacts {
  state: VerdictState;
  answered: number;
  /** Null when no racket is in play. */
  frame: { name: string; balance: string | null; flex: string | null; weightClass: string | null } | null;
  currentTensionLbs: number | null;
  /** The recommended range, whole pounds, inclusive. */
  tensionRange: [number, number] | null;
  /** Whether the soreness answer moved the range at all — the page says why
   *  only when it did. */
  sorenessMovedRange: boolean;
  goal: PlayerGear['fitGoal'] | null;
  /** A frame the member might play, not the one they do. */
  prospective: boolean;
  reasons: VerdictReason[];
}

export interface FitFactsInput {
  gear: PlayerGear | null;
  /** The judged frame's catalog row, when it has one. */
  frameRow: CatalogItem | null;
  /** The newest string's catalog row, when it has one. */
  stringRow?: CatalogItem | null;
  /** The check-in profile (`buildProfile`), when the member has one. */
  profile?: PlayerProfile | null;
  /** The check-in level (1–5), used when the member has not set one. */
  checkInLevel: number | null;
  /** Judge `frameRow` as a racket the member might play, not the one they do:
   *  no current tension, and the frame is the row, not the bag. */
  prospective?: boolean;
}

const canon = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();

function text(row: CatalogItem | null, key: string): string | null {
  const v = row?.attributes?.[key];
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

function newestString(gear: PlayerGear | null): GearItem | null {
  let latest: GearItem | null = null;
  for (const i of gear?.items ?? []) if (i && !i.retiredAt && i.category === 'string') latest = i;
  return latest;
}

/** A one-pound-wide range from a target, kept inside the window. */
function rangeAround(target: number, [lo, hi]: [number, number]): [number, number] {
  const t = Math.max(lo, Math.min(hi, Math.floor(target)));
  return t + 1 <= hi ? [t, t + 1] : [Math.max(lo, t - 1), t];
}

/** The page's play-style answer as the engines' format. Mixed and "any" are
 *  both; an older `playFormat` counts only while the question is unanswered. */
function formatOf(gear: PlayerGear | null): PlayFormat {
  const style = gear?.fitPlayStyle;
  if (style === 'singles' || style === 'doubles') return style;
  if (style === 'mixed' || style === 'any') return 'both';
  return gear?.playFormat ?? 'both';
}

export function computeFitFacts(input: FitFactsInput): FitFacts {
  const { gear, frameRow, stringRow = null, profile = null, checkInLevel, prospective = false } = input;
  const answers = fitAnswers(gear, checkInLevel);
  const racket = prospective ? null : activeRacket(gear);
  const feel = racket?.feel;
  const frame = prospective
    ? (frameRow ? { name: frameRow.model, balance: text(frameRow, 'balance'), flex: text(frameRow, 'flex'), weightClass: text(frameRow, 'weight') } : null)
    : racket
      ? {
        name: frameRow?.model ?? racket.label,
        balance: text(frameRow, 'balance') ?? feel?.balance ?? null,
        flex: text(frameRow, 'flex') ?? feel?.flex ?? null,
        weightClass: text(frameRow, 'weight') ?? feel?.weight ?? null,
      }
      : null;
  const string = prospective ? null : newestString(gear);
  const currentTensionLbs = typeof string?.tensionLbs === 'number' ? string.tensionLbs : null;
  const goal = gear?.fitGoal ?? null;

  // ── The tension range ──
  const window = ratedRange(frameRow?.attributes) ?? [MIN_LB, MAX_LB];
  const soreDelta = comfortTensionDeltaLb(effectiveArmComfort(gear));
  // The member's own level wins; otherwise the real check-in number, not the
  // option it rounds to on the page.
  const level = gear?.fitLevelOverride ? levelOptionValue(gear.fitLevelOverride) : checkInLevel;
  const target = (delta: number): number | null => {
    const paired = frameRow && stringRow && profile ? pairTension(frameRow, stringRow, profile, delta) : null;
    if (paired !== null) return paired;
    const base = recommendTension(level ?? null, formatOf(gear));
    return base ? base.lb + delta : null;
  };
  const withSore = target(soreDelta);
  const withoutSore = target(0);
  const tensionRange = withSore === null ? null : rangeAround(withSore, window);
  const sorenessMovedRange = !!tensionRange && withoutSore !== null && rangeAround(withoutSore, window)[0] !== tensionRange[0];

  const reasons: VerdictReason[] = [];
  let weight = 0;
  const balance = canon(frame?.balance);
  const flex = canon(frame?.flex);

  // What the member asked for, against the frame's balance — on the fit
  // engine's own axis: every level starts even (2) and the goal moves it.
  const axis = BALANCE_AXIS[balance];
  if (goal && goal !== 'happy' && axis !== undefined) {
    const delta = GOAL_DELTA[goal].balance;
    const wanted = delta === 'toward2' ? 2 : 2 + delta;
    const off = Math.abs(axis - wanted);
    if (off === 0) reasons.push({ key: 'goalWithBalance', polarity: 'plus' });
    else {
      reasons.push({ key: 'goalAgainstBalance', polarity: 'minus' });
      weight += off >= 2 ? 1 : 0.5;
    }
  }

  // The shaft against the swing: the injury axis, so it weighs the most. The
  // ceilings mirror the fit engine's (slow ≤ medium, medium ≤ stiff).
  if (answers.swing && flex) {
    const stiff = flex === 'stiff' || flex === 'extra stiff';
    if ((answers.swing === 'slow' && (stiff || flex === 'medium-stiff')) || (answers.swing === 'medium' && flex === 'extra stiff')) {
      reasons.push({ key: 'shaftTooStiff', polarity: 'minus' });
      weight += 1.5;
    } else if (answers.swing === 'fast' && flex === 'flexible') {
      reasons.push({ key: 'shaftTooSoft', polarity: 'minus' });
      weight += 1;
    } else {
      reasons.push({ key: 'shaftFitsSwing', polarity: 'plus' });
    }
  }

  // A heavy frame for an arm that already gets sore. Only a frame the catalog
  // calls plain 3U: a "3U/4U" model is sold in both, and which one the member
  // holds is not known, so it is not called heavy.
  if (canon(frame?.weightClass) === '3u' && answers.soreness && answers.soreness !== 'none') {
    reasons.push({ key: 'heavyForArm', polarity: 'minus' });
    weight += 1;
  }

  // Where the member's tension sits against the range.
  if (tensionRange && currentTensionLbs !== null) {
    if (currentTensionLbs > tensionRange[1]) {
      reasons.push({ key: 'tensionHigh', polarity: 'minus' });
      weight += currentTensionLbs - tensionRange[1] >= 2 ? 1 : 0.5;
    } else if (currentTensionLbs < tensionRange[0]) {
      reasons.push({ key: 'tensionLow', polarity: 'minus' });
      weight += tensionRange[0] - currentTensionLbs >= 2 ? 1 : 0.5;
    } else {
      reasons.push({ key: 'tensionInRange', polarity: 'plus' });
    }
  }

  // Declining to judge is a real answer: the app says nothing stronger than
  // five answers and a known frame support.
  const knowsFrame = !!frame && !!balance && !!flex;
  const state: VerdictState = answers.answered < 5 || !knowsFrame || !tensionRange
    ? 'insufficient'
    : weight === 0 ? 'suits' : weight <= 1.5 ? 'fighting_slightly' : 'fighting';

  return {
    state,
    answered: answers.answered,
    frame,
    currentTensionLbs,
    tensionRange,
    sorenessMovedRange,
    goal,
    prospective,
    // Minus first — what is fighting the member is the point of the card.
    reasons: [...reasons.filter((r) => r.polarity === 'minus'), ...reasons.filter((r) => r.polarity === 'plus')].slice(0, 3),
  };
}
