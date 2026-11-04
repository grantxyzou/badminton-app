import { getContainer, ensureContainer } from './cosmos';
import { isFlagOn } from './flags';
import { rosterMemberIds } from './roster';
import { ensureCatalogSeeded } from './catalogSeed';
import { latestRatingsByMember } from './latestRatings';
import { activeRacket } from './activeRacket';
import { axesOf, canon, isScorable, recommendFit, FIT_ENGINE_VERSION, type FitInput, type FitState } from './racketFit';
import { buildFitInput } from './racketFitInput';
import type { CatalogItem, FitGoal, PlayerGear } from './types';
import type { Rating } from './assessment';

/**
 * THE OWNED-RACKET BACKTEST (docs/plans/racket-fit-engine.md, "how to
 * validate alternatively", 2026-11-04).
 *
 * Every member who plays a catalog racket is a test case nobody had to write:
 * hide the racket they own, run the engine from scratch over the rest of what
 * it knows about them, and ask whether what it picks looks like what they
 * chose and kept. The way a weather model is checked against yesterday — the
 * answer is already known, so no expert has to sit down and rate anything.
 *
 * WHAT IT CAN AND CANNOT SAY. A racket someone owns is weak truth: people play
 * what they were sold, what a friend passed on, what was on sale. So the
 * score is the CLASS of the pick against the class of the racket — balance,
 * shaft flex within one step, weight within a few grams, price tier — not the
 * exact model. A high class-match rate says the engine's idea of "a frame for
 * someone like you" agrees with what people actually hold; a low one says it
 * does not, and names the axis. Neither says the member's racket is RIGHT for
 * them, which is the golden set's question and the bench's.
 *
 * TWO READINGS PER MEMBER. `asAnswered` keeps their fit goal and is the
 * HEADLINE: with the anchor hidden, the goal (and a mixed court's side) is the
 * only answer that steers balance, so it is the engine's real from-scratch
 * opinion of someone like them. It under-counts by design where a member
 * asked for a change — "more power" is SUPPOSED to be steered off the balance
 * they hold — which is why `byGoal` is reported beside it: the `happy` rows
 * are the clean ones. `asIfHappy` forces the goal to `happy` and is the FLOOR:
 * what the engine says knowing only the level, which is the level default's
 * even balance for everyone, so a head-light or head-heavy owner can only
 * match it by luck. The first run of this file expected the opposite, and the
 * test that caught it is the first thing the backtest taught.
 *
 * TOTALS ONLY. The report route behind the read-only reports key returns
 * counts and rates, never a member id, a name or a racket id per person; the
 * truth-racket distribution is by CLASS, not by model.
 */

export const BACKTEST_WEIGHT_TOLERANCE_G = 3;

export interface BacktestCase {
  memberId: string;
  gear: PlayerGear;
  ratings: Rating[];
}

export type BacktestSkip = 'no_active_racket' | 'racket_not_in_catalog' | 'racket_unscorable' | 'nothing_to_go_on';

export interface AxisMatch {
  exactTop1: boolean;
  exactTop3: boolean;
  balance: boolean;
  flexWithin1: boolean;
  /** Null when either weight is unknown — not counted either way. */
  weightWithin3: boolean | null;
  tier: boolean;
  /** The engine's TARGET balance against the truth's — what it aimed at, before the catalog shaped the pick. */
  targetBalance: boolean;
}

export interface BacktestOutcome {
  fitState: FitState;
  truthClass: { balance: number; flex: number; tier: number };
  asAnswered: AxisMatch;
  asIfHappy: AxisMatch;
  goal: FitGoal | 'unanswered';
}

export type BacktestOne = { kind: 'skip'; reason: BacktestSkip } | { kind: 'case'; outcome: BacktestOutcome };

/** The engine with the member's own racket HIDDEN: no anchor, and the racket itself back in the running. */
export function hideOwnRacket(input: FitInput, truth: CatalogItem, goal: FitGoal | undefined): FitInput {
  const ownedIds = new Set(input.ownedIds);
  ownedIds.delete(truth.id);
  const ownedLabels = new Set(input.ownedLabels);
  ownedLabels.delete(canon(`${truth.brand} ${truth.model}`));
  ownedLabels.delete(canon(truth.model));
  return { ...input, anchor: null, ownedIds, ownedLabels, goal };
}

function matchOf(truth: CatalogItem, result: ReturnType<typeof recommendFit>): AxisMatch {
  const t = axesOf(truth)!;
  const top = result.top;
  const top3 = top ? [top.item.id, ...result.alternatives.map((a) => a.item.id)] : [];
  const p = top ? axesOf(top.item) : null;
  return {
    exactTop1: top?.item.id === truth.id,
    exactTop3: top3.includes(truth.id),
    balance: !!p && p.balance === t.balance,
    flexWithin1: !!p && Math.abs(p.flex - t.flex) <= 1,
    weightWithin3: p && p.weight !== null && t.weight !== null ? Math.abs(p.weight - t.weight) <= BACKTEST_WEIGHT_TOLERANCE_G : null,
    tier: !!p && p.tier === t.tier,
    targetBalance: result.target !== null && result.target.balance === t.balance,
  };
}

/** One member, pure. */
export function backtestOne(c: Pick<BacktestCase, 'gear' | 'ratings'>, catalog: CatalogItem[]): BacktestOne {
  const active = activeRacket(c.gear);
  if (!active) return { kind: 'skip', reason: 'no_active_racket' };
  const truth = active.catalogId ? catalog.find((r) => r.id === active.catalogId) ?? null : null;
  if (!truth) return { kind: 'skip', reason: 'racket_not_in_catalog' };
  if (!isScorable(truth) || !axesOf(truth)) return { kind: 'skip', reason: 'racket_unscorable' };

  const base = buildFitInput(c.gear, c.ratings, catalog);
  const asAnsweredInput = hideOwnRacket(base, truth, base.goal);
  const asIfHappyInput = hideOwnRacket(base, truth, 'happy');
  // Hidden anchor: the engine needs goal + swing, or a check-in. `happy` is a
  // goal, so the "as if happy" run has one whenever the swing was answered.
  const answered = recommendFit(asAnsweredInput, catalog);
  const happy = recommendFit(asIfHappyInput, catalog);
  if (happy.fitState === 'needsFit' || !happy.top) return { kind: 'skip', reason: 'nothing_to_go_on' };
  const t = axesOf(truth)!;
  return {
    kind: 'case',
    outcome: {
      fitState: happy.fitState,
      truthClass: { balance: t.balance, flex: t.flex, tier: t.tier },
      asAnswered: matchOf(truth, answered),
      asIfHappy: matchOf(truth, happy),
      goal: base.goal ?? 'unanswered',
    },
  };
}

export interface RateRow {
  n: number;
  exactTop1: number;
  exactTop3: number;
  balance: number;
  flexWithin1: number;
  /** Over the cases where both weights were known. */
  weightWithin3: { hits: number; of: number };
  tier: number;
  targetBalance: number;
}

export interface BacktestSummary {
  engineVersion: string;
  generatedAt: string;
  /** Members on the roster with a gear doc or a check-in. */
  considered: number;
  skipped: Record<BacktestSkip, number>;
  cases: number;
  byFitState: Record<string, number>;
  byGoal: Record<string, number>;
  /** What the members actually hold, by class. */
  truth: { balance: Record<string, number>; flex: Record<string, number>; tier: Record<string, number> };
  asIfHappy: RateRow;
  asAnswered: RateRow;
  /** The headline: as-answered balance AND flex-within-1 AND tier, all three. */
  classMatchRate: number | null;
}

const emptyRow = (): RateRow => ({ n: 0, exactTop1: 0, exactTop3: 0, balance: 0, flexWithin1: 0, weightWithin3: { hits: 0, of: 0 }, tier: 0, targetBalance: 0 });

function addMatch(row: RateRow, m: AxisMatch): void {
  row.n += 1;
  if (m.exactTop1) row.exactTop1 += 1;
  if (m.exactTop3) row.exactTop3 += 1;
  if (m.balance) row.balance += 1;
  if (m.flexWithin1) row.flexWithin1 += 1;
  if (m.weightWithin3 !== null) { row.weightWithin3.of += 1; if (m.weightWithin3) row.weightWithin3.hits += 1; }
  if (m.tier) row.tier += 1;
  if (m.targetBalance) row.targetBalance += 1;
}

const BALANCE_NAME = ['', 'head-light', 'even', 'head-heavy'];
const FLEX_NAME = ['', 'flexible', 'medium', 'medium-stiff', 'stiff', 'extra-stiff'];
const TIER_NAME = ['', 'entry', 'mid', 'premium'];

/** Pure over the per-member outcomes. */
export function summarizeBacktest(results: BacktestOne[], now = new Date()): BacktestSummary {
  const skipped: Record<BacktestSkip, number> = { no_active_racket: 0, racket_not_in_catalog: 0, racket_unscorable: 0, nothing_to_go_on: 0 };
  const byFitState: Record<string, number> = {};
  const byGoal: Record<string, number> = {};
  const truth = { balance: {} as Record<string, number>, flex: {} as Record<string, number>, tier: {} as Record<string, number> };
  const asIfHappy = emptyRow();
  const asAnswered = emptyRow();
  let allThree = 0;
  for (const r of results) {
    if (r.kind === 'skip') { skipped[r.reason] += 1; continue; }
    const o = r.outcome;
    byFitState[o.fitState] = (byFitState[o.fitState] ?? 0) + 1;
    byGoal[o.goal] = (byGoal[o.goal] ?? 0) + 1;
    const bump = (rec: Record<string, number>, k: string) => { rec[k] = (rec[k] ?? 0) + 1; };
    bump(truth.balance, BALANCE_NAME[o.truthClass.balance] ?? String(o.truthClass.balance));
    bump(truth.flex, FLEX_NAME[o.truthClass.flex] ?? String(o.truthClass.flex));
    bump(truth.tier, TIER_NAME[o.truthClass.tier] ?? String(o.truthClass.tier));
    addMatch(asIfHappy, o.asIfHappy);
    addMatch(asAnswered, o.asAnswered);
    if (o.asAnswered.balance && o.asAnswered.flexWithin1 && o.asAnswered.tier) allThree += 1;
  }
  return {
    engineVersion: FIT_ENGINE_VERSION,
    generatedAt: now.toISOString(),
    considered: results.length,
    skipped,
    cases: asIfHappy.n,
    byFitState,
    byGoal,
    truth,
    asIfHappy,
    asAnswered,
    // `null`, never 0, with nothing to count (the lying-empty-state rule).
    classMatchRate: asAnswered.n > 0 ? Math.round((allThree / asAnswered.n) * 1000) / 1000 : null,
  };
}

/**
 * The club's cases: every roster member with a gear doc or a check-in, their
 * gear and latest ratings. Both containers are PERSON-scoped, so the raw read
 * is right and the roster is what narrows it (the same shape as
 * `app/api/admin/fit-preview/route.ts`). Throws on a failed read.
 */
export async function loadBacktestCases(groupId: string): Promise<{ cases: BacktestCase[]; catalog: CatalogItem[] }> {
  await Promise.all([ensureContainer('playerGear', '/memberId'), ensureCatalogSeeded()]);
  const roster = isFlagOn('NEXT_PUBLIC_FLAG_MULTI_GROUP') ? await rosterMemberIds(groupId) : null;
  const onRoster = (id: unknown): id is string => typeof id === 'string' && (!roster || roster.has(id));
  const [gearRes, ratingsByMember, catalogRes] = await Promise.all([
    getContainer('playerGear').items.query({ query: 'SELECT * FROM c' }).fetchAll(),
    latestRatingsByMember(),
    getContainer('equipmentCatalog').items
      .query({ query: 'SELECT * FROM c WHERE c.category = @category', parameters: [{ name: '@category', value: 'racket' }] })
      .fetchAll(),
  ]);
  const catalog = (catalogRes.resources as CatalogItem[]).filter((r) => r.category === 'racket');
  const gearDocs = (gearRes.resources as PlayerGear[]).filter((g) => onRoster(g.memberId));
  const cases: BacktestCase[] = gearDocs.map((gear) => ({
    memberId: gear.memberId,
    gear,
    ratings: ratingsByMember.get(gear.memberId)?.ratings ?? [],
  }));
  return { cases, catalog };
}

/** The whole backtest for one club. */
export async function runFitBacktest(groupId: string): Promise<BacktestSummary> {
  const { cases, catalog } = await loadBacktestCases(groupId);
  return summarizeBacktest(cases.map((c) => backtestOne(c, catalog)));
}
