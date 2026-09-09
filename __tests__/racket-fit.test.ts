import { describe, it, expect } from 'vitest';
import {
  recommendFit, buildTarget, axesOf, scoreFit, compareFit, pickAlternatives, differsBy,
  resolveFitState, fitLevel, fitTechniqueCeiling, GOAL_DELTA, FIT_REASON_KEYS, canon,
  type FitInput,
} from '../lib/racketFit';
import type { PlayerProfile } from '../lib/racketProfile';
import type { CatalogItem } from '../lib/types';
import en from '../messages/en.json';
import zh from '../messages/zh-CN.json';

/**
 * The fit engine, spec `docs/superpowers/specs/2026-09-07-racket-fit-design.md`.
 * Pure, so tested directly on hand-built rows whose arithmetic can be checked
 * by hand. The golden set (`fit-golden.test.ts`) is what says whether the
 * NUMBERS are right; this file says whether the MECHANICS are.
 */

function racket(id: string, a: Record<string, string | number>, msrp = 200): CatalogItem {
  return {
    id, category: 'racket', brand: a.brand ? String(a.brand) : 'Yonex', model: a.model ? String(a.model) : id,
    msrp, skillRange: [1, 6],
    attributes: { weightMinG: 83, weightMaxG: 87, gripSize: 'G4/G5', ...a },
  } as CatalogItem;
}

const ANCHOR = racket('anchor', { model: 'Astrox 88D Pro', balance: 'Head-heavy', flex: 'Stiff', tier: 'Premium', playStyle: 'Power', subType: 'doubles' }, 309);

function input(over: Partial<FitInput> = {}): FitInput {
  return {
    anchor: null, ownedIds: new Set(), ownedLabels: new Set(),
    format: 'both', level: 'Intermediate', hasRatings: true, ...over,
  };
}

describe('fitState — a pick needs a racket in the bag, OR a check-in, OR goal + swing', () => {
  it.each([
    [{ anchor: ANCHOR, goal: 'faster' }, 'anchored'],
    [{ anchor: ANCHOR }, 'anchored_default'],
    [{ goal: 'faster', swing: 'fast', hasRatings: false, level: null }, 'unanchored'],
    [{ goal: 'faster', hasRatings: false, level: null }, 'needsFit'],
    [{ hasRatings: true, level: null }, 'level_only'],
    [{ hasRatings: false, level: null }, 'needsFit'],
  ] as const)('%j → %s', (over, state) => {
    expect(resolveFitState(input(over as Partial<FitInput>))).toBe(state);
  });

  it('needsFit returns no pick and no target', () => {
    const r = recommendFit(input({ hasRatings: false, level: null }), [ANCHOR]);
    expect(r).toEqual({ fitState: 'needsFit', top: null, alternatives: [], target: null });
  });
});

describe('target — anchor plus goal delta, then ceilings', () => {
  const anchorAxes = axesOf(ANCHOR)!;

  it('reads the catalog vocabulary onto the axes', () => {
    expect(anchorAxes).toMatchObject({ balance: 3, flex: 4, tier: 3, weight: 85, style: 'Power', subType: 'doubles' });
    expect([...anchorAxes.grip!]).toEqual(['G4', 'G5']);
  });

  it.each(Object.keys(GOAL_DELTA) as Array<keyof typeof GOAL_DELTA>)('applies the %s delta to the anchor', (goal) => {
    const t = buildTarget(input({ anchor: ANCHOR, goal }), anchorAxes);
    const d = GOAL_DELTA[goal];
    const expectedBalance = d.balance === 'toward2' ? 2 : Math.max(1, Math.min(3, 3 + d.balance));
    expect(t.balance).toBe(expectedBalance);
    expect(t.flex).toBe(Math.max(1, Math.min(5, 4 + d.flex)));
    expect(t.weight).toBe(85 + d.weight);
    expect(t.anchored).toBe(true);
    expect(t.sigma).toBe(1.0);
  });

  it('with no anchor, bases on the level and widens the tolerance', () => {
    expect(buildTarget(input({ level: 'Beginner' }), null)).toMatchObject({ balance: 2, flex: 2, weight: 82, tier: 1, sigma: 1.3 });
    expect(buildTarget(input({ level: null }), null)).toMatchObject({ balance: 2, flex: 2.5, weight: 84, tier: 2, sigma: 1.6 });
  });

  it('swing sets the flex ceiling and nudges the target; absent swing falls back to technique', () => {
    expect(buildTarget(input({ anchor: ANCHOR, swing: 'slow' }), anchorAxes)).toMatchObject({ flexCeil: 2, flex: 2 });
    expect(buildTarget(input({ anchor: ANCHOR, swing: 'medium' }), anchorAxes)).toMatchObject({ flexCeil: 4, flex: 4 });
    expect(buildTarget(input({ level: 'Beginner', swing: 'fast' }), null)).toMatchObject({ flexCeil: 5, flex: 3 });
    expect(buildTarget(input({ techniqueCeiling: 3 }), null).flexCeil).toBe(3);
    expect(buildTarget(input({}), null).flexCeil).toBe(4);
  });

  it('comfort is a ceiling, never a target move', () => {
    const sometimes = buildTarget(input({ anchor: ANCHOR, goal: 'more_power', armComfort: 'sometimes_sore' }), anchorAxes);
    expect(sometimes).toMatchObject({ flexCeil: 3, weightCeil: 85, balanceCeil: null, balance: 3 });
    const often = buildTarget(input({ anchor: ANCHOR, goal: 'more_power', armComfort: 'often_sore' }), anchorAxes);
    expect(often).toMatchObject({ flexCeil: 2, weightCeil: 83, balanceCeil: 2, balance: 3 });
  });
});

describe('scoring — one place per axis, ceilings warn and penalise, nothing is hidden', () => {
  const target = buildTarget(input({ anchor: ANCHOR, goal: 'happy', format: 'doubles', budgetMaxCad: 350 }), axesOf(ANCHOR)!);
  const inp = input({ anchor: ANCHOR, goal: 'happy', format: 'doubles', budgetMaxCad: 350 });

  it('an identical frame scores the full secondary and no penalty', () => {
    const twin = racket('twin', { model: 'Twin', balance: 'Head-heavy', flex: 'Stiff', tier: 'Premium', playStyle: 'Power', subType: 'doubles' }, 300);
    const s = scoreFit(twin, axesOf(twin)!, target, inp, axesOf(ANCHOR));
    expect(s.penalty).toBe(0);
    // +4 doubles, +3 style = 107 → clamped to 100.
    expect(s.score).toBe(100);
    expect(s.reasons.map((r) => r.key)).toEqual(['reason.likeYours', 'reason.doublesBuilt', 'reason.withinBudget']);
  });

  it('one balance step costs 22, one flex step 12 — a two-step balance miss cannot be bought back by format', () => {
    const evenFrame = racket('even', { balance: 'Even', flex: 'Stiff', tier: 'Premium', playStyle: 'Power', subType: 'doubles' });
    const lightFrame = racket('light', { balance: 'Head-light', flex: 'Stiff', tier: 'Premium', playStyle: 'Power', subType: 'doubles' });
    const softer = racket('soft', { balance: 'Head-heavy', flex: 'Medium-Stiff', tier: 'Premium', playStyle: 'Power', subType: 'doubles' });
    expect(scoreFit(evenFrame, axesOf(evenFrame)!, target, inp, null).penalty).toBe(22);
    expect(scoreFit(lightFrame, axesOf(lightFrame)!, target, inp, null).penalty).toBe(44);
    expect(scoreFit(softer, axesOf(softer)!, target, inp, null).penalty).toBe(12);
  });

  it('a frame above the flex ceiling is penalised AND warned, never dropped', () => {
    const t = buildTarget(input({ anchor: ANCHOR, swing: 'slow' }), axesOf(ANCHOR)!);
    const stiff = racket('xs', { balance: 'Head-heavy', flex: 'Extra Stiff', tier: 'Premium', playStyle: 'Power' });
    const s = scoreFit(stiff, axesOf(stiff)!, t, input({ anchor: ANCHOR, swing: 'slow' }), axesOf(ANCHOR));
    expect(s.warnings).toEqual([{ key: 'warn.flexAboveCeiling', params: { flex: 'Extra Stiff' } }]);
    expect(s.score).toBeGreaterThanOrEqual(0);
  });

  it('a sore arm warns on weight and on head-heavy balance', () => {
    const inp2 = input({ anchor: ANCHOR, armComfort: 'often_sore' });
    const t = buildTarget(inp2, axesOf(ANCHOR)!);
    const heavy = racket('heavy', { balance: 'Head-heavy', flex: 'Medium', tier: 'Premium', playStyle: 'Power', weightMinG: 85, weightMaxG: 89 });
    const s = scoreFit(heavy, axesOf(heavy)!, t, inp2, axesOf(ANCHOR));
    expect(s.warnings.map((w) => w.key)).toEqual(['warn.weightAboveCeiling', 'warn.headHeavyWithSoreArm']);
  });

  it('budget never excludes: over budget is −20 and the row stays', () => {
    const dear = racket('dear', { balance: 'Head-heavy', flex: 'Stiff', tier: 'Premium', playStyle: 'Power', subType: 'doubles' }, 400);
    const s = scoreFit(dear, axesOf(dear)!, target, inp, null);
    expect(s.score).toBe(87); // 100 + 7 − 20
    expect(s.reasons.map((r) => r.key)).not.toContain('reason.withinBudget');
  });

  it('grip is neutral when either side is unknown, −6 only on a known miss', () => {
    const known = racket('g6', { balance: 'Head-heavy', flex: 'Stiff', tier: 'Premium', playStyle: 'Power', subType: 'doubles', gripSize: 'G6' });
    const unknown = racket('gx', { balance: 'Head-heavy', flex: 'Stiff', tier: 'Premium', playStyle: 'Power', subType: 'doubles', gripSize: '' });
    const withGrip = input({ anchor: ANCHOR, goal: 'happy', format: 'doubles', grip: 'G4' });
    const t = buildTarget(withGrip, axesOf(ANCHOR)!);
    expect(scoreFit(known, axesOf(known)!, t, withGrip, null).score).toBe(100 + 0 - 0 + 7 - 6 > 100 ? 100 : 100 - 0 + 7 - 6);
    expect(scoreFit(unknown, axesOf(unknown)!, t, withGrip, null).score).toBe(100);
  });

  it('an anchor with no published weight still earns "like yours" — the weight clause is skipped, not failed', () => {
    const bareAnchor = racket('bare', { model: 'Bare', balance: 'Head-heavy', flex: 'Stiff', tier: 'Premium', playStyle: 'Power' });
    delete (bareAnchor.attributes as Record<string, unknown>).weightMinG;
    const inp3 = input({ anchor: bareAnchor, goal: 'happy' });
    const t = buildTarget(inp3, axesOf(bareAnchor)!);
    const twin = racket('twin2', { balance: 'Head-heavy', flex: 'Stiff', tier: 'Premium', playStyle: 'Power' });
    const s = scoreFit(twin, axesOf(twin)!, t, inp3, axesOf(bareAnchor));
    expect(s.reasons.map((r) => r.key)).toContain('reason.likeYours');
  });

  it('a row with no weight drops the axis and says so, never defaults to 85', () => {
    const noWeight = racket('nw', { balance: 'Head-heavy', flex: 'Stiff', tier: 'Premium', playStyle: 'Power' });
    delete (noWeight.attributes as Record<string, unknown>).weightMinG;
    const s = scoreFit(noWeight, axesOf(noWeight)!, target, inp, null);
    expect(s.penalty).toBe(0);
    expect(s.reasons.map((r) => r.key)).toContain('reason.weightUnknown');
  });
});

describe('ranking, exclusion and alternatives', () => {
  const catalog = [
    ANCHOR,
    racket('a', { model: 'A', balance: 'Head-heavy', flex: 'Stiff', tier: 'Premium', playStyle: 'Power', subType: 'doubles' }, 280),
    racket('b', { model: 'B', balance: 'Head-heavy', flex: 'Stiff', tier: 'Premium', playStyle: 'Power', subType: 'doubles' }, 260),
    racket('c', { model: 'C', balance: 'Even', flex: 'Medium-Stiff', tier: 'Mid-range', playStyle: 'All-round' }, 150),
    racket('d', { model: 'D', balance: 'Head-light', flex: 'Medium', tier: 'Entry-level', playStyle: 'Speed' }, 90),
  ];

  it('excludes the anchor, every owned id, and a free-text owned label', () => {
    const r = recommendFit(input({
      anchor: ANCHOR, goal: 'happy', ownedIds: new Set(['anchor', 'a']), ownedLabels: new Set([canon('Yonex B')]),
    }), catalog);
    const ids = [r.top!.item.id, ...r.alternatives.map((p) => p.item.id)];
    expect(ids).not.toContain('anchor');
    expect(ids).not.toContain('a');
    expect(ids).not.toContain('b');
  });

  it('ties break by price, then id — never by catalog order', () => {
    const r1 = recommendFit(input({ anchor: ANCHOR, goal: 'happy', ownedIds: new Set(['anchor']) }), catalog);
    const r2 = recommendFit(input({ anchor: ANCHOR, goal: 'happy', ownedIds: new Set(['anchor']) }), [...catalog].reverse());
    expect(r1.top!.item.id).toBe('b'); // same spec as A, $20 cheaper
    expect(r2.top!.item.id).toBe('b');
  });

  it('alternatives differ from the top on at least one of balance/flex/tier, and from each other', () => {
    const r = recommendFit(input({ anchor: ANCHOR, goal: 'happy', ownedIds: new Set(['anchor']) }), catalog);
    expect(r.top!.item.id).toBe('b');
    expect(r.alternatives.map((p) => p.item.id)).toEqual(['c', 'd']);
  });

  it('falls back to rank order rather than returning fewer than two', () => {
    const same = [
      racket('x', { balance: 'Even', flex: 'Medium', tier: 'Mid-range', playStyle: 'All-round' }, 100),
      racket('y', { balance: 'Even', flex: 'Medium', tier: 'Mid-range', playStyle: 'All-round' }, 110),
      racket('z', { balance: 'Even', flex: 'Medium', tier: 'Mid-range', playStyle: 'All-round' }, 120),
    ];
    const r = recommendFit(input({ level: 'Intermediate' }), same);
    expect(r.alternatives.map((p) => p.item.id)).toEqual(['y', 'z']);
  });

  it('"differs by" names at most two fragments, flex and balance first', () => {
    const r = recommendFit(input({ anchor: ANCHOR, goal: 'happy', ownedIds: new Set(['anchor']) }), catalog);
    expect(r.alternatives[0].differsBy).toEqual([{ key: 'diff.softer' }, { key: 'diff.headLighter' }]);
    expect(r.alternatives[1].differsBy).toEqual([{ key: 'diff.softer' }, { key: 'diff.headLighter' }]);
  });

  it('a same-spec other brand says so rather than nothing', () => {
    const other = racket('v', { brand: 'Victor', model: 'V', balance: 'Head-heavy', flex: 'Stiff', tier: 'Premium', playStyle: 'Power', subType: 'doubles' }, 280);
    const top = { item: catalog[1], axes: axesOf(catalog[1])!, score: 90, penalty: 0, reasons: [], warnings: [] };
    const alt = { item: other, axes: axesOf(other)!, score: 90, penalty: 0, reasons: [], warnings: [] };
    expect(differsBy(alt, top)).toEqual([{ key: 'diff.sameSpecOtherBrand' }]);
    expect(compareFit(top, alt)).toBeLessThan(0); // same score, same price, 'a' < 'v'
    expect(pickAlternatives([top, alt]).map((s) => s.item.id)).toEqual(['v']);
  });

  it('leads the unanchored and level-only states with a reason that says so', () => {
    expect(recommendFit(input({ goal: 'faster', swing: 'fast' }), catalog).top!.reasons[0].key).toBe('reason.unanchored');
    expect(recommendFit(input({}), catalog).top!.reasons[0].key).toBe('reason.levelOnly');
    expect(recommendFit(input({ anchor: ANCHOR, ownedIds: new Set(['anchor']) }), catalog).top!.reasons[0])
      .toEqual({ key: 'reason.anchoredDefault', params: { model: 'Astrox 88D Pro' } });
  });
});

describe('level from RATED skills only', () => {
  const p = (ratedKeys: string[], v = 4): PlayerProfile => ({
    serves: v, net_play: v, clears: v, drops: v, drives: v, smashes: v, grip: v,
    footwork: v, court_coverage: v, stamina: v, game_reading: v, consistency: v, rules: v, mindset: v,
    format: 'both', ratedKeys,
  });
  it('is null below three rated skills, whatever the defaults say', () => {
    expect(fitLevel(p(['smashes', 'drives']))).toBeNull();
    expect(fitLevel(p(['smashes', 'drives', 'clears']))).toBe('Advanced');
  });
  it('the technique ceiling needs all three of its inputs rated', () => {
    expect(fitTechniqueCeiling(p(['consistency', 'grip']))).toBeUndefined();
    expect(fitTechniqueCeiling(p(['consistency', 'grip', 'smashes'], 2))).toBe(2);
  });
});

describe('every key the engine can emit exists in both locales', () => {
  const lookup = (msgs: unknown, key: string) =>
    key.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), msgs);
  it.each([...FIT_REASON_KEYS])('%s', (key) => {
    expect(typeof lookup((en as { stats: { gear: unknown } }).stats.gear, key), `en ${key}`).toBe('string');
    expect(typeof lookup((zh as { stats: { gear: unknown } }).stats.gear, key), `zh ${key}`).toBe('string');
  });
  it('and diffJoin, which the client uses to join fragments', () => {
    expect(typeof (en as { stats: { gear: { diffJoin?: string } } }).stats.gear.diffJoin).toBe('string');
    expect(typeof (zh as { stats: { gear: { diffJoin?: string } } }).stats.gear.diffJoin).toBe('string');
  });
});
