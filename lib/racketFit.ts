import type { CatalogItem, FitGoal, FitSwing, FitArmComfort, FitGrip } from './types';
import type { PlayerProfile } from './racketProfile';

/**
 * The racket fit engine — Phase 2 of `docs/plans/racket-fit-engine.md`.
 * Design: `docs/superpowers/specs/2026-09-07-racket-fit-design.md`.
 *
 * A DISTANCE MODEL against a target spec, not rule scorers. The seven scorers
 * it replaces (`lib/racketRecommend.ts`) inferred fit from fourteen skill
 * self-ratings, read the same attribute in two of them, and each emitted its
 * own English sentence. Here there is one place per axis, weights that sum
 * visibly, and reasons derived from the smallest distances.
 *
 * The member's CURRENT racket is the anchor and the fit goal is a delta from
 * it — "happy with it, want more power" is the most predictive question a
 * fitting asks, and it uses the kit the member already logged. Swing and
 * comfort are CEILINGS, not target moves: a sore arm is a constraint, and a
 * frame above a ceiling stays ranked, penalised and warned, never hidden.
 *
 * Pure: no fetch, no DB, no clock, no randomness. Every reason is an i18n KEY
 * with params, never a sentence — English-only reasons were one of the
 * defects. `FIT_REASON_KEYS` is exported so a test can assert every key the
 * engine can emit exists in both locales; `check-i18n-keys.mjs` cannot see a
 * dynamic `t(reason.key)`.
 */

export const FIT_ENGINE_VERSION = 'fit-1';

export type FitState = 'anchored' | 'anchored_default' | 'unanchored' | 'level_only' | 'needsFit';
export type FitLevel = 'Beginner' | 'Intermediate' | 'Advanced';

export interface FitInput {
  /** The active racket, only when its catalogId resolves to a scorable row. */
  anchor: CatalogItem | null;
  /** Every non-retired racket catalogId in the bag — excluded before scoring. */
  ownedIds: ReadonlySet<string>;
  /** `canon(label)` of every non-retired racket, so a free-text row (the
   *  stringing sheet's typed racket) is excluded too. */
  ownedLabels: ReadonlySet<string>;
  goal?: FitGoal;
  swing?: FitSwing;
  armComfort?: FitArmComfort;
  grip?: FitGrip;
  format: 'singles' | 'doubles' | 'both';
  budgetMaxCad?: number;
  /** From RATED skills only; null below three rated. */
  level: FitLevel | null;
  /** True when any check-in rating exists at all. */
  hasRatings: boolean;
  /** The old flex ceiling from consistency/grip/smashes, when all three are
   *  rated. The fallback when no swing is given. */
  techniqueCeiling?: 1 | 2 | 3 | 4 | 5;
}

export interface FitReason {
  key: string;
  params?: Record<string, string | number>;
}

export interface FitPick {
  item: CatalogItem;
  /** 0–100, one decimal. */
  score: number;
  reasons: FitReason[];
  warnings: FitReason[];
  /** Alternatives only: how this one differs from the TOP pick. */
  differsBy?: FitReason[];
}

export interface TargetSpec {
  balance: number;
  flex: number;
  weight: number;
  tier: number;
  style: string | null;
  flexCeil: number;
  weightCeil: number | null;
  balanceCeil: number | null;
  sigma: number;
  anchored: boolean;
}

export interface FitResult {
  fitState: FitState;
  top: FitPick | null;
  alternatives: FitPick[];
  target: TargetSpec | null;
}

// ---------------------------------------------------------------------------
// Helpers shared with the string engine (moved here from racketRecommend.ts)
// ---------------------------------------------------------------------------

/** Case- and separator-tolerant vocabulary compare. A backstop: the catalog
 *  is the fix (`__tests__/equipment-catalog-data.test.ts` pins its shape). */
export function canon(v: unknown): string {
  return String(v ?? '').trim().toLowerCase().replace(/[\s_]+/g, '-');
}

/** A row missing any of these cannot be scored honestly and is skipped, not
 *  defaulted (2026-08-19 spec D4). A skipped row looks exactly like a row that
 *  scored badly, so the catalog test asserts none is skipped. */
export function isScorable(item: CatalogItem): boolean {
  const a = item.attributes ?? {};
  return typeof a.balance === 'string' && typeof a.flex === 'string' && typeof a.tier === 'string';
}

export function technical(p: PlayerProfile): number {
  return (p.serves + p.net_play + p.clears + p.drops + p.drives + p.smashes + p.grip) / 7;
}
export function physical(p: PlayerProfile): number {
  return (p.footwork + p.court_coverage + p.stamina) / 3;
}
export function mental(p: PlayerProfile): number {
  return (p.game_reading + p.consistency + p.rules + p.mindset) / 4;
}
/** The fourteen-skill average the string engine shares (spec V2). */
export function overall(p: PlayerProfile): number {
  return (technical(p) + physical(p) + mental(p)) / 3;
}
export function skillLevel(p: PlayerProfile): FitLevel {
  const o = overall(p);
  if (o < 2.5) return 'Beginner';
  if (o < 3.75) return 'Intermediate';
  return 'Advanced';
}
/** Consistency + grip technique bound how much stiffness a player can use. */
export function maxFlexDemand(p: PlayerProfile): 2 | 3 | 4 | 5 {
  const technique = (p.consistency + p.grip + p.smashes) / 3;
  if (technique <= 2.0) return 2;
  if (technique <= 3.0) return 3;
  if (technique <= 4.0) return 4;
  return 5;
}

const SKILL_FIELDS = [
  'serves', 'net_play', 'clears', 'drops', 'drives', 'smashes', 'grip',
  'footwork', 'court_coverage', 'stamina', 'game_reading', 'consistency', 'rules', 'mindset',
] as const;

/**
 * The fit engine's level: an average over RATED skills only, null below three.
 * `overall()` above fills unrated skills with 3, which is right for the string
 * engine's reference constants and wrong here — a two-skill check-in would run
 * on twelve invented values (the defect the intent doc names).
 */
export function fitLevel(p: PlayerProfile): FitLevel | null {
  const rated = SKILL_FIELDS.filter((k) => p.ratedKeys.includes(k));
  if (rated.length < 3) return null;
  const mean = rated.reduce((s, k) => s + p[k], 0) / rated.length;
  if (mean < 2.5) return 'Beginner';
  if (mean < 3.75) return 'Intermediate';
  return 'Advanced';
}

/** The fallback flex ceiling, only when all three inputs were actually rated. */
export function fitTechniqueCeiling(p: PlayerProfile): 2 | 3 | 4 | 5 | undefined {
  const needed = ['consistency', 'grip', 'smashes'];
  if (!needed.every((k) => p.ratedKeys.includes(k))) return undefined;
  return maxFlexDemand(p);
}

// ---------------------------------------------------------------------------
// Axes — one exported table
// ---------------------------------------------------------------------------

export const BALANCE_AXIS: Record<string, number> = { 'head-light': 1, even: 2, 'head-heavy': 3 };
export const FLEX_AXIS: Record<string, number> = { flexible: 1, medium: 2, 'medium-stiff': 3, stiff: 4, 'extra-stiff': 5 };
export const TIER_AXIS: Record<string, number> = { 'entry-level': 1, 'mid-range': 2, premium: 3 };

/** The catalog's own words for each rung, for reason params. */
const FLEX_NAME = ['', 'Flexible', 'Medium', 'Medium-Stiff', 'Stiff', 'Extra Stiff'];

export interface Axes {
  balance: number;
  flex: number;
  /** Midpoint of weightMinG..weightMaxG. Null when either is absent — the
   *  axis is DROPPED for that row, never defaulted to 85. */
  weight: number | null;
  tier: number;
  grip: ReadonlySet<FitGrip> | null;
  style: string | null;
  subType: string | null;
}

export function axesOf(item: CatalogItem): Axes | null {
  const a = item.attributes ?? {};
  const balance = BALANCE_AXIS[canon(a.balance)];
  const flex = FLEX_AXIS[canon(a.flex)];
  const tier = TIER_AXIS[canon(a.tier)];
  if (balance === undefined || flex === undefined || tier === undefined) return null;
  const lo = a.weightMinG; const hi = a.weightMaxG;
  const weight = typeof lo === 'number' && typeof hi === 'number' ? (lo + hi) / 2 : null;
  const gripRaw = typeof a.gripSize === 'string' ? a.gripSize : null;
  const grip = gripRaw
    ? new Set(gripRaw.split('/').map((g) => g.trim().toUpperCase()).filter((g): g is FitGrip => g === 'G4' || g === 'G5' || g === 'G6'))
    : null;
  return {
    balance, flex, weight, tier,
    grip: grip && grip.size > 0 ? grip : null,
    style: typeof a.playStyle === 'string' ? a.playStyle : null,
    subType: typeof a.subType === 'string' ? a.subType : null,
  };
}

// ---------------------------------------------------------------------------
// Target spec
// ---------------------------------------------------------------------------

/** Base target by level when there is no anchor. */
const LEVEL_BASE: Record<FitLevel | 'null', { balance: number; flex: number; weight: number; tier: number }> = {
  Beginner: { balance: 2, flex: 2, weight: 82, tier: 1 },
  Intermediate: { balance: 2, flex: 3, weight: 85, tier: 2 },
  Advanced: { balance: 2, flex: 4, weight: 86, tier: 3 },
  null: { balance: 2, flex: 2.5, weight: 84, tier: 2 },
};

/**
 * THE GOAL-DELTA TABLE — the badminton judgment in this file.
 *
 * What "I want more power" means in balance / flex / weight, as a step from
 * the anchor. `toward2` moves balance one step toward Even from wherever it
 * is. `style` is the play-style label the goal favours (+3 secondary).
 * Tune HERE and nowhere else; the golden set is what says whether a change
 * was right.
 */
export const GOAL_DELTA: Record<FitGoal, { balance: number | 'toward2'; flex: number; weight: number; style: string | null }> = {
  happy: { balance: 0, flex: 0, weight: 0, style: null },
  more_power: { balance: +1, flex: 0, weight: +2, style: 'Power' },
  more_control: { balance: 'toward2', flex: +1, weight: 0, style: 'Control' },
  faster: { balance: -1, flex: 0, weight: -3, style: 'Speed' },
  less_fatigue: { balance: -1, flex: -1, weight: -4, style: null },
};

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function buildTarget(input: FitInput, anchorAxes: Axes | null): TargetSpec {
  const anchored = anchorAxes !== null;
  const base = anchored
    ? { balance: anchorAxes.balance, flex: anchorAxes.flex, weight: anchorAxes.weight ?? LEVEL_BASE[input.level ?? 'null'].weight, tier: anchorAxes.tier }
    : LEVEL_BASE[input.level ?? 'null'];

  const goal: FitGoal = input.goal ?? 'happy';
  const delta = GOAL_DELTA[goal];
  let balance = delta.balance === 'toward2'
    ? base.balance + Math.sign(2 - base.balance)
    : base.balance + delta.balance;
  let flex = base.flex + delta.flex;
  let weight = base.weight + delta.weight;
  const style = goal === 'happy' ? (anchorAxes?.style ?? null) : delta.style;

  // Swing sets the flex CEILING — the injury axis — and nudges the target.
  let flexCeil: number;
  if (input.swing === 'slow') { flexCeil = 2; flex = Math.min(flex, 2); }
  else if (input.swing === 'medium') { flexCeil = 4; }
  else if (input.swing === 'fast') { flexCeil = 5; flex = Math.max(flex, 3); }
  else { flexCeil = input.techniqueCeiling ?? 4; }

  // Comfort is a constraint, never a target move.
  let weightCeil: number | null = null;
  let balanceCeil: number | null = null;
  if (input.armComfort === 'sometimes_sore') { flexCeil = Math.min(flexCeil, 3); weightCeil = 85; }
  if (input.armComfort === 'often_sore') { flexCeil = Math.min(flexCeil, 2); weightCeil = 83; balanceCeil = 2; }

  balance = clamp(balance, 1, 3);
  flex = clamp(flex, 1, 5);
  weight = clamp(weight, 75, 89);

  const sigma = anchored ? 1.0 : input.level ? 1.3 : 1.6;
  return { balance, flex, weight, tier: base.tier, style, flexCeil, weightCeil, balanceCeil, sigma, anchored };
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

interface Scored {
  item: CatalogItem;
  axes: Axes;
  score: number;
  penalty: number;
  reasons: FitReason[];
  warnings: FitReason[];
}

export const WEIGHTS = { balance: 22, flex: 12, weight: 2.5, tier: 6 } as const;
const WEIGHT_DELTA_CAP = 10;
const CAP_FLEX = 10;
const CAP_WEIGHT = 4;
const CAP_BALANCE = 10;
const SECONDARY = { format: 4, formatBoth: 3, style: 3, gripMiss: -6, overBudget: -20 } as const;

export function scoreFit(item: CatalogItem, axes: Axes, target: TargetSpec, input: FitInput, anchorAxes: Axes | null): Scored {
  const reasons: FitReason[] = [];
  const warnings: FitReason[] = [];

  const dBalance = Math.abs(axes.balance - target.balance);
  const dFlex = Math.abs(axes.flex - target.flex);
  const dWeight = axes.weight === null ? 0 : Math.min(Math.abs(axes.weight - target.weight), WEIGHT_DELTA_CAP);
  const dTier = Math.abs(axes.tier - target.tier);
  const penalty = (WEIGHTS.balance * dBalance + WEIGHTS.flex * dFlex + WEIGHTS.weight * dWeight + WEIGHTS.tier * dTier) / target.sigma;

  let caps = 0;
  if (axes.flex > target.flexCeil) {
    caps += CAP_FLEX * (axes.flex - target.flexCeil);
    warnings.push({ key: 'warn.flexAboveCeiling', params: { flex: FLEX_NAME[axes.flex] } });
  }
  if (target.weightCeil !== null && axes.weight !== null && axes.weight > target.weightCeil) {
    caps += CAP_WEIGHT * (axes.weight - target.weightCeil);
    warnings.push({ key: 'warn.weightAboveCeiling', params: { g: Math.round(axes.weight) } });
  }
  if (target.balanceCeil !== null && axes.balance > target.balanceCeil) {
    caps += CAP_BALANCE;
    warnings.push({ key: 'warn.headHeavyWithSoreArm' });
  }

  let secondary = 0;
  const sub = canon(axes.subType);
  if (input.format === 'doubles' && sub === 'doubles') secondary += SECONDARY.format;
  else if (input.format === 'singles' && sub === 'singles') secondary += SECONDARY.format;
  else if (input.format === 'both' && (sub === 'all-round' || canon(axes.style) === 'all-round')) secondary += SECONDARY.formatBoth;
  if (target.style && canon(axes.style) === canon(target.style)) secondary += SECONDARY.style;
  if (input.grip && axes.grip && !axes.grip.has(input.grip)) secondary += SECONDARY.gripMiss;
  const overBudget = typeof input.budgetMaxCad === 'number' && typeof item.msrp === 'number' && item.msrp > input.budgetMaxCad;
  if (overBudget) secondary += SECONDARY.overBudget;

  const score = Math.round(clamp(100 - penalty - caps + secondary, 0, 100) * 10) / 10;

  // Reasons — fixed order, only when true, at most four.
  if (target.anchored && anchorAxes) {
    const goal = input.goal ?? 'happy';
    const closeOnEveryAxis = dBalance <= 1 && dFlex <= 1 && dTier <= 1 && (axes.weight === null || Math.abs(axes.weight - anchorAxes.weight!) <= 2);
    const movesGoalAxis =
      (goal === 'more_power' && (axes.balance > anchorAxes.balance || (axes.weight !== null && anchorAxes.weight !== null && axes.weight > anchorAxes.weight)))
      || (goal === 'more_control' && axes.flex > anchorAxes.flex)
      || (goal === 'faster' && (axes.balance < anchorAxes.balance || (axes.weight !== null && anchorAxes.weight !== null && axes.weight < anchorAxes.weight)))
      || (goal === 'less_fatigue' && ((axes.weight !== null && anchorAxes.weight !== null && axes.weight < anchorAxes.weight) || axes.flex < anchorAxes.flex));
    const model = anchorLabel(input.anchor!);
    if (goal === 'happy' && closeOnEveryAxis) reasons.push({ key: 'reason.likeYours', params: { model } });
    else if (goal === 'more_power' && movesGoalAxis) reasons.push({ key: 'reason.powerStep', params: { model } });
    else if (goal === 'more_control' && movesGoalAxis) reasons.push({ key: 'reason.controlStep', params: { model } });
    else if (goal === 'faster' && movesGoalAxis) reasons.push({ key: 'reason.speedStep', params: { model } });
    else if (goal === 'less_fatigue' && movesGoalAxis) reasons.push({ key: 'reason.fatigueStep', params: { model } });
  }
  if (input.swing && dFlex === 0) reasons.push({ key: 'reason.flexFitsSwing', params: { flex: FLEX_NAME[axes.flex] } });
  else if (axes.flex === target.flexCeil - 1) reasons.push({ key: 'reason.flexHeadroom', params: { flex: FLEX_NAME[axes.flex] } });
  if (input.format === 'doubles' && sub === 'doubles') reasons.push({ key: 'reason.doublesBuilt' });
  else if (input.format === 'singles' && axes.balance === 3) reasons.push({ key: 'reason.singlesRear' });
  else if (input.format === 'both' && axes.balance === 2) reasons.push({ key: 'reason.evenVersatile' });
  if (typeof input.budgetMaxCad === 'number' && typeof item.msrp === 'number' && !overBudget) {
    reasons.push({ key: 'reason.withinBudget', params: { cad: Math.trunc(input.budgetMaxCad) } });
  } else if (input.grip && axes.grip?.has(input.grip)) {
    reasons.push({ key: 'reason.gripMatch', params: { grip: input.grip } });
  }
  if (axes.weight === null) reasons.push({ key: 'reason.weightUnknown' });

  return { item, axes, score, penalty, reasons: reasons.slice(0, 4), warnings };
}

function anchorLabel(item: CatalogItem): string {
  return item.model;
}

/** Deterministic order: score, then raw distance, then price (unknown last), then id. */
export function compareFit(a: Scored, b: Scored): number {
  if (b.score !== a.score) return b.score - a.score;
  if (a.penalty !== b.penalty) return a.penalty - b.penalty;
  const pa = typeof a.item.msrp === 'number' ? a.item.msrp : Number.POSITIVE_INFINITY;
  const pb = typeof b.item.msrp === 'number' ? b.item.msrp : Number.POSITIVE_INFINITY;
  if (pa !== pb) return pa - pb;
  return a.item.id < b.item.id ? -1 : a.item.id > b.item.id ? 1 : 0;
}

// ---------------------------------------------------------------------------
// Alternatives
// ---------------------------------------------------------------------------

const triple = (s: Scored) => `${s.axes.balance}|${s.axes.flex}|${s.axes.tier}`;

export function pickAlternatives(ranked: Scored[]): Scored[] {
  const [top, ...rest] = ranked;
  if (!top) return [];
  const window = rest.slice(0, 10);
  const out: Scored[] = [];
  const first = window.find((s) => triple(s) !== triple(top));
  if (first) out.push(first);
  const second = window.find((s) => s !== first && triple(s) !== triple(top) && (!first || triple(s) !== triple(first)));
  if (second) out.push(second);
  // The diversity rule never yields fewer than two: fall back to rank order.
  for (const s of window) {
    if (out.length >= 2) break;
    if (!out.includes(s)) out.push(s);
  }
  return out;
}

export function differsBy(alt: Scored, top: Scored): FitReason[] {
  const out: FitReason[] = [];
  if (alt.axes.flex > top.axes.flex) out.push({ key: 'diff.stiffer' });
  else if (alt.axes.flex < top.axes.flex) out.push({ key: 'diff.softer' });
  if (alt.axes.balance > top.axes.balance) out.push({ key: 'diff.headHeavier' });
  else if (alt.axes.balance < top.axes.balance) out.push({ key: 'diff.headLighter' });
  if (alt.axes.weight !== null && top.axes.weight !== null) {
    const d = alt.axes.weight - top.axes.weight;
    if (d <= -2) out.push({ key: 'diff.lighter', params: { g: Math.round(-d) } });
    else if (d >= 2) out.push({ key: 'diff.heavier', params: { g: Math.round(d) } });
  }
  if (typeof alt.item.msrp === 'number' && typeof top.item.msrp === 'number') {
    const d = alt.item.msrp - top.item.msrp;
    if (d <= -20) out.push({ key: 'diff.cheaper', params: { cad: -d } });
    else if (d >= 20) out.push({ key: 'diff.pricier', params: { cad: d } });
  }
  if (alt.axes.tier > top.axes.tier) out.push({ key: 'diff.tierUp' });
  else if (alt.axes.tier < top.axes.tier) out.push({ key: 'diff.tierDown' });
  if (out.length === 0) return [{ key: 'diff.sameSpecOtherBrand' }];
  return out.slice(0, 2);
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

/**
 * A pick needs a catalog racket in the bag, OR a check-in, OR goal + swing.
 * Goal alone is not enough: swing sets flex, the injury axis.
 */
export function resolveFitState(input: FitInput): FitState {
  if (input.anchor) return input.goal ? 'anchored' : 'anchored_default';
  if (input.goal && input.swing) return 'unanchored';
  if (input.hasRatings) return 'level_only';
  return 'needsFit';
}

export function recommendFit(input: FitInput, catalog: CatalogItem[]): FitResult {
  const fitState = resolveFitState(input);
  if (fitState === 'needsFit') return { fitState, top: null, alternatives: [], target: null };

  const anchorAxes = input.anchor ? axesOf(input.anchor) : null;
  const target = buildTarget(input, anchorAxes);

  const scored: Scored[] = [];
  for (const item of catalog) {
    if (item.category !== 'racket') continue;
    if (!isScorable(item)) continue;
    if (input.ownedIds.has(item.id)) continue;
    if (input.ownedLabels.has(canon(`${item.brand} ${item.model}`)) || input.ownedLabels.has(canon(item.model))) continue;
    const axes = axesOf(item);
    if (!axes) continue;
    scored.push(scoreFit(item, axes, target, input, anchorAxes));
  }
  scored.sort(compareFit);

  const top = scored[0];
  if (!top) return { fitState, top: null, alternatives: [], target };

  const lead: FitReason[] = [];
  if (fitState === 'anchored_default') lead.push({ key: 'reason.anchoredDefault', params: { model: anchorLabel(input.anchor!) } });
  else if (fitState === 'unanchored') lead.push({ key: 'reason.unanchored' });
  else if (fitState === 'level_only') lead.push({ key: 'reason.levelOnly' });

  const toPick = (s: Scored, withLead: boolean, vsTop: Scored | null): FitPick => ({
    item: s.item,
    score: s.score,
    reasons: withLead ? [...lead, ...s.reasons].slice(0, 4) : s.reasons,
    warnings: s.warnings,
    ...(vsTop ? { differsBy: differsBy(s, vsTop) } : {}),
  });

  return {
    fitState,
    top: toPick(top, true, null),
    alternatives: pickAlternatives(scored).map((s) => toPick(s, false, top)),
    target,
  };
}

/** Every key the engine can emit, for the both-locales test. */
export const FIT_REASON_KEYS = [
  'reason.likeYours', 'reason.powerStep', 'reason.controlStep', 'reason.speedStep', 'reason.fatigueStep',
  'reason.flexFitsSwing', 'reason.flexHeadroom',
  'reason.doublesBuilt', 'reason.singlesRear', 'reason.evenVersatile',
  'reason.withinBudget', 'reason.gripMatch', 'reason.weightUnknown',
  'reason.anchoredDefault', 'reason.unanchored', 'reason.levelOnly', 'reason.clubPlays',
  'warn.flexAboveCeiling', 'warn.weightAboveCeiling', 'warn.headHeavyWithSoreArm',
  'diff.stiffer', 'diff.softer', 'diff.headHeavier', 'diff.headLighter', 'diff.lighter', 'diff.heavier',
  'diff.cheaper', 'diff.pricier', 'diff.tierUp', 'diff.tierDown', 'diff.sameSpecOtherBrand',
] as const;
