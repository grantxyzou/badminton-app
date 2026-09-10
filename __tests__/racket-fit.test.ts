import { describe, it, expect } from 'vitest';
import {
  recommendFit, buildTarget, axesOf, scoreFit, compareFit, pickAlternatives, differsBy,
  resolveFitState, fitLevel, GOAL_DELTA, FIT_REASON_KEYS, canon, comfortTensionDeltaLb, anchorStifferThanSwing,
  type FitInput,
} from '../lib/racketFit';
import { pairTension, pairString } from '../lib/stringPair';
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
    const t = buildTarget(input({ anchor: ANCHOR, goal, swing: 'fast' }), anchorAxes);
    const d = GOAL_DELTA[goal];
    const expectedBalance = d.balance === 'toward2' ? 2 : Math.max(1, Math.min(3, 3 + d.balance));
    expect(t.balance).toBe(expectedBalance);
    expect(t.flex).toBe(Math.max(1, Math.min(5, 4 + d.flex)));
    expect(t.weight).toBe(85 + d.weight);
    expect(t.anchored).toBe(true);
    expect(t.sigma).toBe(1.0);
  });

  it('with no anchor, bases on the level and widens the tolerance', () => {
    expect(buildTarget(input({ level: 'Beginner', swing: 'medium' }), null)).toMatchObject({ balance: 2, flex: 2, weight: 82, tier: 1, sigma: 1.3 });
    expect(buildTarget(input({ level: null, swing: 'medium' }), null)).toMatchObject({ balance: 2, flex: 2.5, weight: 84, tier: 2, sigma: 1.6 });
  });

  it('swing sets the flex ceiling and the target never sits above it', () => {
    expect(buildTarget(input({ anchor: ANCHOR, swing: 'slow' }), anchorAxes)).toMatchObject({ flexCeil: 2, flex: 2, swingKnown: true });
    expect(buildTarget(input({ anchor: ANCHOR, swing: 'medium' }), anchorAxes)).toMatchObject({ flexCeil: 4, flex: 4 });
    expect(buildTarget(input({ level: 'Beginner', swing: 'fast' }), null)).toMatchObject({ flexCeil: 5, flex: 3 });
  });

  it('an unanswered swing caps nothing — flex follows the swing, not the check-in — and widens the tolerance', () => {
    // fit-1 derived a ceiling from consistency/grip/smashes. The deflection
    // literature says stiffness is a property of stroke timing, which a
    // skill score does not measure; guessing was the defect.
    const t = buildTarget(input({ anchor: ANCHOR }), anchorAxes);
    expect(t).toMatchObject({ flexCeil: 5, flex: 4, swingKnown: false, sigma: 1.2 });
    expect(buildTarget(input({ level: 'Beginner' }), null).sigma).toBe(1.56);
    expect(buildTarget(input({ level: 'Beginner', swing: 'medium' }), null).sigma).toBe(1.3);
  });

  it('comfort caps weight and head-heaviness and lowers tension — it never touches flex or the target', () => {
    const sometimes = buildTarget(input({ anchor: ANCHOR, goal: 'more_power', swing: 'fast', armComfort: 'sometimes_sore' }), anchorAxes);
    expect(sometimes).toMatchObject({ flexCeil: 5, weightCeil: 85, balanceCeil: null, balance: 3 });
    const often = buildTarget(input({ anchor: ANCHOR, goal: 'more_power', swing: 'fast', armComfort: 'often_sore' }), anchorAxes);
    expect(often).toMatchObject({ flexCeil: 5, weightCeil: 83, balanceCeil: 2, balance: 3 });
    expect(comfortTensionDeltaLb('sometimes_sore')).toBe(-1);
    expect(comfortTensionDeltaLb('often_sore')).toBe(-2);
    expect(comfortTensionDeltaLb('fine')).toBe(0);
    expect(comfortTensionDeltaLb(undefined)).toBe(0);
  });

  it('the comfort delta reaches the string engine, inside the frame’s rated window', () => {
    const frame = racket('f', { balance: 'Even', flex: 'Medium', tier: 'Mid-range', tensionMinLbs: 20, tensionMaxLbs: 26 });
    const string = { ...racket('s', { tensionMinLbs: 20, tensionMaxLbs: 30 }), category: 'string' } as CatalogItem;
    const profile = { serves: 5, net_play: 5, clears: 5, drops: 5, drives: 5, smashes: 5, grip: 5, footwork: 5, court_coverage: 5, stamina: 5, game_reading: 5, consistency: 5, rules: 5, mindset: 5, format: 'both', ratedKeys: [] } as unknown as PlayerProfile;
    const base = pairTension(frame, string, profile)!;
    expect(pairTension(frame, string, profile, -2)).toBe(Math.max(20, base - 2));
    expect(pairTension(frame, string, profile, -40)).toBe(20); // never below the overlap
    // And the pairing SCORES at the eased tension it names — one delta, both places.
    const eased = pairString(frame, [string], profile, -2)!;
    expect(eased.tensionLbs).toBe(pairTension(frame, string, profile, -2));
  });

  it('names the anchor as the problem when it sits two flex steps above the swing', () => {
    const slow = buildTarget(input({ anchor: ANCHOR, goal: 'happy', swing: 'slow' }), anchorAxes);
    expect(anchorStifferThanSwing(slow, anchorAxes)).toBe(true);   // Stiff (4) vs ceiling 2
    const medium = buildTarget(input({ anchor: ANCHOR, goal: 'happy', swing: 'medium' }), anchorAxes);
    expect(anchorStifferThanSwing(medium, anchorAxes)).toBe(false); // 4 vs 4
    const unknown = buildTarget(input({ anchor: ANCHOR, goal: 'happy' }), anchorAxes);
    expect(anchorStifferThanSwing(unknown, anchorAxes)).toBe(false); // no swing, no claim
  });
});

describe('scoring — one place per axis, ceilings warn and penalise, nothing is hidden', () => {
  // Swing answered, so sigma is 1.0 and the arithmetic below is the raw table.
  const inp = input({ anchor: ANCHOR, goal: 'happy', swing: 'fast', format: 'doubles', budgetMaxCad: 350 });
  const target = buildTarget(inp, axesOf(ANCHOR)!);

  it('an identical frame scores the full secondary and no penalty', () => {
    const twin = racket('twin', { model: 'Twin', balance: 'Head-heavy', flex: 'Stiff', tier: 'Premium', playStyle: 'Power', subType: 'doubles' }, 300);
    const s = scoreFit(twin, axesOf(twin)!, target, inp, axesOf(ANCHOR));
    expect(s.penalty).toBe(0);
    // +4 doubles, +3 style = 107 → clamped to 100.
    expect(s.score).toBe(100);
    expect(s.reasons.map((r) => r.key)).toEqual(['reason.likeYours', 'reason.flexFitsSwing', 'reason.doublesBuilt', 'reason.withinBudget']);
  });

  it('says nothing about flex when the swing was not answered', () => {
    const quiet = input({ anchor: ANCHOR, goal: 'happy', format: 'doubles', budgetMaxCad: 350 });
    const twin = racket('twin', { model: 'Twin', balance: 'Head-heavy', flex: 'Stiff', tier: 'Premium', playStyle: 'Power', subType: 'doubles' }, 300);
    const s = scoreFit(twin, axesOf(twin)!, buildTarget(quiet, axesOf(ANCHOR)!), quiet, axesOf(ANCHOR));
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

  it('ten grams costs 12 — about half a balance step, because swing speed tracks balance, not mass', () => {
    const heavy = racket('heavy', { balance: 'Head-heavy', flex: 'Stiff', tier: 'Premium', playStyle: 'Power', subType: 'doubles', weightMinG: 93, weightMaxG: 97 });
    expect(scoreFit(heavy, axesOf(heavy)!, target, inp, null).penalty).toBe(12);
  });

  it('a Beginner reaching up a tier pays double, and is reordered — never excluded', () => {
    const beginner = input({ level: 'Beginner', swing: 'medium' });
    const t = buildTarget(beginner, null); // tier 1
    const premium = racket('prem', { balance: 'Even', flex: 'Medium', tier: 'Premium', weightMinG: 80, weightMaxG: 84 });
    const entry = racket('entry', { balance: 'Even', flex: 'Medium', tier: 'Entry-level', weightMinG: 80, weightMaxG: 84 });
    const sPrem = scoreFit(premium, axesOf(premium)!, t, beginner, null);
    const sEntry = scoreFit(entry, axesOf(entry)!, t, beginner, null);
    expect(sPrem.penalty).toBeCloseTo((2 * 12) / 1.3, 5);
    expect(sEntry.penalty).toBe(0);
    expect(sPrem.score).toBeGreaterThan(70); // still a real candidate
    // An Intermediate reaching up pays the ordinary 6 per step (row matched to the Intermediate base on every other axis).
    const inter = input({ level: 'Intermediate', swing: 'medium' });
    const premiumMid = racket('prem2', { balance: 'Even', flex: 'Medium-Stiff', tier: 'Premium', weightMinG: 83, weightMaxG: 87 });
    expect(scoreFit(premiumMid, axesOf(premiumMid)!, buildTarget(inter, null), inter, null).penalty).toBeCloseTo(6 / 1.3, 5);
    // "Up" is past the TARGET's tier. A Beginner already playing a Premium
    // anchor is not steered down from it: Premium costs 0, and Entry pays the
    // ordinary 6 per step DOWN.
    const anchoredBeginner = input({ level: 'Beginner', anchor: ANCHOR, goal: 'happy', swing: 'fast' });
    const tA = buildTarget(anchoredBeginner, axesOf(ANCHOR)!);
    const premTwin = racket('ptwin', { balance: 'Head-heavy', flex: 'Stiff', tier: 'Premium', playStyle: 'Power' });
    const entryTwin = racket('etwin', { balance: 'Head-heavy', flex: 'Stiff', tier: 'Entry-level', playStyle: 'Power' });
    expect(scoreFit(premTwin, axesOf(premTwin)!, tA, anchoredBeginner, axesOf(ANCHOR)).penalty).toBe(0);
    expect(scoreFit(entryTwin, axesOf(entryTwin)!, tA, anchoredBeginner, axesOf(ANCHOR)).penalty).toBe(12);
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

  it('leads with the swing question when the goal is set and the swing is not', () => {
    const r = recommendFit(input({ anchor: ANCHOR, goal: 'more_power', ownedIds: new Set(['anchor']) }), catalog);
    expect(r.top!.reasons[0].key).toBe('reason.swingUnanswered');
    const withSwing = recommendFit(input({ anchor: ANCHOR, goal: 'more_power', swing: 'fast', ownedIds: new Set(['anchor']) }), catalog);
    expect(withSwing.top!.reasons.map((x) => x.key)).not.toContain('reason.swingUnanswered');
  });

  it('leads with the anchor being the problem when it is stiffer than the swing wants — one lead, and only when the pick IS softer', () => {
    // The shared catalog has nothing softer than Stiff; give it one row a
    // relaxed swing can use, and that row wins.
    const soft = [...catalog, racket('soft', { balance: 'Head-heavy', flex: 'Medium', tier: 'Premium', playStyle: 'Power' })];
    const r = recommendFit(input({ anchor: ANCHOR, goal: 'happy', swing: 'slow', ownedIds: new Set(['anchor']) }), soft);
    expect(r.top!.item.id).toBe('soft');
    expect(r.top!.reasons[0]).toEqual({ key: 'reason.anchorStifferThanSwing', params: { model: 'Astrox 88D Pro' } });
    expect(r.target!.flex).toBe(2);
    // The lead ladder is exclusive: no second lead sentence stacks under it,
    // and "like yours" (a claim about the anchor) does not follow a lead
    // that says the anchor is wrong.
    const keys = r.top!.reasons.map((x) => x.key);
    expect(keys.filter((k) => ['reason.anchoredDefault', 'reason.swingUnanswered', 'reason.levelOnly', 'reason.unanchored'].includes(k))).toEqual([]);
    expect(keys).not.toContain('reason.likeYours');
    // Same anchor, no goal, slow swing: still one lead, the stiffness one.
    const d = recommendFit(input({ anchor: ANCHOR, swing: 'slow', ownedIds: new Set(['anchor']) }), soft);
    expect(d.top!.reasons.map((x) => x.key).filter((k) => k.startsWith('reason.anchor'))).toEqual(['reason.anchorStifferThanSwing']);
    // When nothing softer exists, the claim is not made — the shared catalog
    // is exactly that case, and the pick falls back to the ordinary lead.
    const stiffOnly = recommendFit(input({ anchor: ANCHOR, goal: 'happy', swing: 'slow', ownedIds: new Set(['anchor']) }), catalog);
    expect(stiffOnly.top!.reasons.map((x) => x.key)).not.toContain('reason.anchorStifferThanSwing');
  });

  it('"less fatigue" credits a lighter swing-weight, never a softer shaft', () => {
    const inp = input({ anchor: ANCHOR, goal: 'less_fatigue', swing: 'fast' });
    const t = buildTarget(inp, axesOf(ANCHOR)!);
    const even = racket('even', { balance: 'Even', flex: 'Stiff', tier: 'Premium' });
    const softer = racket('soft', { balance: 'Head-heavy', flex: 'Medium-Stiff', tier: 'Premium' });
    expect(scoreFit(even, axesOf(even)!, t, inp, axesOf(ANCHOR)).reasons.map((x) => x.key)).toContain('reason.fatigueStep');
    expect(scoreFit(softer, axesOf(softer)!, t, inp, axesOf(ANCHOR)).reasons.map((x) => x.key)).not.toContain('reason.fatigueStep');
  });

  it('"headroom" is never said of a frame stiffer than the target', () => {
    const inp = input({ level: 'Beginner', swing: 'fast' }); // target flex 3, ceiling 5
    const t = buildTarget(inp, null);
    const stiff = racket('stiff', { balance: 'Even', flex: 'Stiff', tier: 'Entry-level' });
    expect(scoreFit(stiff, axesOf(stiff)!, t, inp, null).reasons.map((x) => x.key)).not.toContain('reason.flexHeadroom');
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
