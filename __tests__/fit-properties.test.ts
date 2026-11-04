import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  recommendFit, buildTarget, axesOf, scoreFit, compareFit, sideBalance, goalDelta, comfortTensionDeltaLb,
  isScorable, canon, GOAL_DELTA, SLOW_SWING_POWER_DELTA, type FitInput,
} from '../lib/racketFit';
import { isOffered } from '../lib/catalogOffer';
import type { CatalogItem, FitGoal, FitSwing, FitArmComfort } from '../lib/types';

/**
 * PROPERTY TESTS for the fit engine (docs/plans/racket-fit-engine.md, "how to
 * validate alternatively", 2026-11-04). The golden set asks "is this the right
 * racket?", which needs an expert. These ask "does the engine obey the rules
 * it claims?", which needs none: the claims are in `lib/racketFit.ts`'s own
 * header, and each one here is a line of it turned into a check over EVERY
 * anchor in the real catalog — metamorphic tests, where changing one answer
 * must move the pick in a known direction or not at all.
 *
 * What they cannot say: whether the rules are the right rules. That stays
 * with the golden set and the bench.
 */
const catalogFile = JSON.parse(readFileSync(join(process.cwd(), 'scripts/data/equipment-catalog.json'), 'utf8')) as { items?: CatalogItem[] } | CatalogItem[];
const rackets = (Array.isArray(catalogFile) ? catalogFile : catalogFile.items ?? []).filter((i) => i.category === 'racket');
const scorable = rackets.filter((r) => isScorable(r) && isOffered(r) && axesOf(r) !== null);

function input(over: Partial<FitInput> = {}): FitInput {
  return {
    anchor: null, ownedIds: new Set(), ownedLabels: new Set(),
    format: 'both', level: null, hasRatings: false,
    ...over,
  };
}
const anchored = (anchor: CatalogItem, over: Partial<FitInput> = {}): FitInput =>
  input({ anchor, ownedIds: new Set([anchor.id]), ownedLabels: new Set([canon(`${anchor.brand} ${anchor.model}`)]), ...over });
const top3 = (r: ReturnType<typeof recommendFit>) => (r.top ? [r.top.item.id, ...r.alternatives.map((a) => a.item.id)] : []);

/** A deterministic shuffle, so an order-dependence shows the same way every run. */
function shuffled<T>(xs: T[], seed: number): T[] {
  const out = [...xs];
  let s = seed;
  for (let i = out.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const j = s % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const GOALS: FitGoal[] = ['happy', 'more_power', 'more_control', 'faster', 'less_fatigue'];
const SWINGS: (FitSwing | undefined)[] = [undefined, 'slow', 'medium', 'fast'];

describe('the catalog the properties run over', () => {
  it('has a real population to test against', () => {
    expect(scorable.length).toBeGreaterThan(100);
  });
});

describe('determinism', () => {
  it('the same input gives the same shortlist, and the catalog order does not matter', () => {
    for (const anchor of scorable.slice(0, 40)) {
      const inp = anchored(anchor, { goal: 'more_control', swing: 'medium' });
      const a = top3(recommendFit(inp, scorable));
      const b = top3(recommendFit(inp, scorable));
      const c = top3(recommendFit(inp, shuffled(scorable, 7)));
      expect(a).toEqual(b);
      expect(a, `${anchor.id}: a reordered catalog changed the shortlist`).toEqual(c);
    }
  });

  it('compareFit is a total order with no ties left to chance', () => {
    const inp = input({ goal: 'happy', swing: 'medium' });
    const target = buildTarget(inp, null);
    const scored = scorable.map((item) => scoreFit(item, axesOf(item)!, target, inp, null));
    const once = [...scored].sort(compareFit).map((s) => s.item.id);
    const again = shuffled(scored, 3).sort(compareFit).map((s) => s.item.id);
    expect(once).toEqual(again);
  });
});

describe('what the member owns is never handed back', () => {
  it('no owned id or label makes the shortlist, for every anchor', () => {
    for (const anchor of scorable) {
      for (const goal of GOALS) {
        const r = recommendFit(anchored(anchor, { goal, swing: 'medium' }), scorable);
        expect(top3(r), `${anchor.id} / ${goal}`).not.toContain(anchor.id);
      }
    }
  });

  it('a second owned racket is excluded too, by id and by label alone', () => {
    const [a, b] = scorable;
    const byId = recommendFit(input({ goal: 'happy', swing: 'medium', ownedIds: new Set([a.id, b.id]) }), scorable);
    expect(top3(byId)).not.toContain(a.id);
    expect(top3(byId)).not.toContain(b.id);
    const byLabel = recommendFit(input({ goal: 'happy', swing: 'medium', ownedLabels: new Set([canon(`${a.brand} ${a.model}`)]) }), scorable);
    expect(top3(byLabel)).not.toContain(a.id);
  });
});

describe('the goal deltas move the target the way the header says', () => {
  it('more power never lightens the head; faster and less fatigue never add weight; control never softens', () => {
    for (const anchor of scorable) {
      const ax = axesOf(anchor)!;
      for (const swing of ['medium', 'fast'] as FitSwing[]) {
        const happy = buildTarget(anchored(anchor, { goal: 'happy', swing }), ax);
        const power = buildTarget(anchored(anchor, { goal: 'more_power', swing }), ax);
        const faster = buildTarget(anchored(anchor, { goal: 'faster', swing }), ax);
        const fatigue = buildTarget(anchored(anchor, { goal: 'less_fatigue', swing }), ax);
        const control = buildTarget(anchored(anchor, { goal: 'more_control', swing }), ax);
        expect(power.balance, `${anchor.id} power/balance`).toBeGreaterThanOrEqual(happy.balance);
        expect(power.weight, `${anchor.id} power/weight`).toBeGreaterThanOrEqual(happy.weight);
        expect(faster.balance, `${anchor.id} faster/balance`).toBeLessThanOrEqual(happy.balance);
        expect(faster.weight, `${anchor.id} faster/weight`).toBeLessThanOrEqual(happy.weight);
        expect(fatigue.balance, `${anchor.id} fatigue/balance`).toBeLessThanOrEqual(happy.balance);
        expect(fatigue.weight, `${anchor.id} fatigue/weight`).toBeLessThanOrEqual(happy.weight);
        expect(control.flex, `${anchor.id} control/flex`).toBeGreaterThanOrEqual(happy.flex);
      }
    }
  });

  it('no goal touches flex except control (flex follows the swing, not the level)', () => {
    for (const goal of GOALS) {
      if (goal === 'more_control') continue;
      expect(GOAL_DELTA[goal].flex, goal).toBe(0);
    }
    expect(SLOW_SWING_POWER_DELTA.flex).toBe(0);
  });
});

describe('fit-3: a slow swing takes "more power" off the head', () => {
  it('for a slow swing the power delta leaves balance and grams alone; medium and fast keep the step', () => {
    expect(goalDelta('more_power', 'slow')).toEqual(SLOW_SWING_POWER_DELTA);
    expect(goalDelta('more_power', 'medium')).toEqual(GOAL_DELTA.more_power);
    expect(goalDelta('more_power', 'fast')).toEqual(GOAL_DELTA.more_power);
    for (const anchor of scorable) {
      const ax = axesOf(anchor)!;
      const slow = buildTarget(anchored(anchor, { goal: 'more_power', swing: 'slow' }), ax);
      expect(slow.balance, `${anchor.id}: slow power moved the head`).toBe(ax.balance);
    }
  });

  it('a slow swing is never handed a stiff frame without a warning saying so', () => {
    for (const anchor of scorable.slice(0, 60)) {
      const r = recommendFit(anchored(anchor, { goal: 'more_power', swing: 'slow' }), scorable);
      for (const pick of [r.top!, ...r.alternatives]) {
        const flex = axesOf(pick.item)!.flex;
        if (flex > 2) expect(pick.warnings.map((w) => w.key), `${anchor.id} → ${pick.item.id} (flex ${flex})`).toContain('warn.flexAboveCeiling');
      }
    }
  });
});

describe('comfort is a constraint on swing-weight and tension, never on flex', () => {
  it('the tension delta only ever eases, and more soreness eases more', () => {
    const order: FitArmComfort[] = ['fine', 'sometimes_sore', 'often_sore'];
    const deltas = order.map(comfortTensionDeltaLb);
    expect(deltas[0]).toBe(0);
    expect(deltas[1]).toBeLessThanOrEqual(deltas[0]);
    expect(deltas[2]).toBeLessThanOrEqual(deltas[1]);
    expect(comfortTensionDeltaLb(undefined)).toBe(0);
  });

  it('comfort never changes the flex target, and an often-sore arm caps the head at even', () => {
    for (const anchor of scorable) {
      const ax = axesOf(anchor)!;
      const fine = buildTarget(anchored(anchor, { goal: 'happy', swing: 'medium', armComfort: 'fine' }), ax);
      const sore = buildTarget(anchored(anchor, { goal: 'happy', swing: 'medium', armComfort: 'often_sore' }), ax);
      expect(sore.flex, anchor.id).toBe(fine.flex);
      expect(sore.flexCeil, anchor.id).toBe(fine.flexCeil);
      expect(sore.balanceCeil).toBe(2);
      expect(sore.weightCeil).toBe(83);
    }
  });

  it('with an often-sore arm, every head-heavy frame on the shortlist carries the warning', () => {
    for (const anchor of scorable.slice(0, 60)) {
      const r = recommendFit(anchored(anchor, { goal: 'happy', swing: 'medium', armComfort: 'often_sore' }), scorable);
      for (const pick of [r.top!, ...r.alternatives]) {
        if (axesOf(pick.item)!.balance === 3) expect(pick.warnings.map((w) => w.key), `${anchor.id} → ${pick.item.id}`).toContain('warn.headHeavyWithSoreArm');
      }
    }
  });
});

describe('a ceiling penalises, never hides', () => {
  it('a slow swing with a sore arm and a tight budget still gets a full shortlist', () => {
    const r = recommendFit(input({ goal: 'happy', swing: 'slow', armComfort: 'often_sore', budgetMaxCad: 60, level: 'Beginner' }), scorable);
    expect(r.top).not.toBeNull();
    expect(r.alternatives.length).toBe(2);
  });
});

describe('budget is a preference', () => {
  it('raising the budget never lowers any frame\'s score, and a frame within budget is unaffected by it', () => {
    const base = input({ goal: 'happy', swing: 'medium' });
    const target = buildTarget(base, null);
    for (const item of scorable) {
      if (typeof item.msrp !== 'number') continue;
      const tight = scoreFit(item, axesOf(item)!, target, { ...base, budgetMaxCad: 100 }, null).score;
      const loose = scoreFit(item, axesOf(item)!, target, { ...base, budgetMaxCad: 300 }, null).score;
      const none = scoreFit(item, axesOf(item)!, target, base, null).score;
      expect(loose, item.id).toBeGreaterThanOrEqual(tight);
      if (item.msrp <= 100) expect(tight, `${item.id} within budget`).toBe(none);
    }
  });
});

describe('an unanswered swing widens the tolerance instead of guessing', () => {
  it('sigma grows and no flex ceiling is set', () => {
    for (const anchor of scorable.slice(0, 40)) {
      const ax = axesOf(anchor)!;
      const known = buildTarget(anchored(anchor, { goal: 'happy', swing: 'medium' }), ax);
      const unknown = buildTarget(anchored(anchor, { goal: 'happy' }), ax);
      expect(unknown.sigma, anchor.id).toBeGreaterThan(known.sigma);
      expect(unknown.swingKnown).toBe(false);
      expect(unknown.flexCeil).toBe(5);
    }
  });
});

describe('fit-4: the side of a mixed court', () => {
  it('front starts head-light; back head-heavy, except for a slow swing or a sore arm; with an anchor the racket wins', () => {
    expect(sideBalance({ courtSide: 'front' })).toBe(1);
    expect(sideBalance({ courtSide: 'back', swing: 'fast' })).toBe(3);
    expect(sideBalance({ courtSide: 'back', swing: 'slow' })).toBeNull();
    expect(sideBalance({ courtSide: 'back', armComfort: 'often_sore' })).toBeNull();
    expect(sideBalance({ courtSide: null })).toBeNull();
    const front = buildTarget(input({ goal: 'happy', swing: 'medium', courtSide: 'front', level: 'Intermediate' }), null);
    expect(front.balance).toBe(1);
    for (const anchor of scorable.slice(0, 20)) {
      const ax = axesOf(anchor)!;
      const t = buildTarget(anchored(anchor, { goal: 'happy', swing: 'medium', courtSide: 'front' }), ax);
      expect(t.balance, `${anchor.id}: the side overrode the anchor`).toBe(ax.balance);
    }
  });
});

describe('every scorable shortlist is reachable under every answer', () => {
  it('no combination of goal and swing leaves a member with no pick', () => {
    for (const goal of GOALS) {
      for (const swing of SWINGS) {
        for (const anchor of scorable.slice(0, 15)) {
          const r = recommendFit(anchored(anchor, { goal, swing }), scorable);
          expect(r.top, `${anchor.id} / ${goal} / ${swing ?? 'unanswered'}`).not.toBeNull();
        }
      }
    }
  });
});
