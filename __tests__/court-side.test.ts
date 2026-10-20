import { describe, it, expect } from 'vitest';
import { courtSideOf, sideFormat } from '../lib/courtSide';
import { recommendFit, buildTarget, axesOf, sideBalance, FIT_ENGINE_VERSION, type FitInput } from '../lib/racketFit';
import { buildProfile } from '../lib/racketProfile';
import { buildFitInput } from '../lib/racketFitInput';
import { recommendTension } from '../lib/tension';
import type { CatalogItem, PlayerGear } from '../lib/types';

/**
 * fit-4 (Grant, 2026-10-20: "mixed selection why is it ignored?"). Mixed ·
 * front and Mixed · back were stored and every engine read them as "both",
 * so both got All-around's racket. The side now sets the racket's starting
 * balance, and the string and tension engines read front as doubles and back
 * as singles. An explicit Doubles / Singles choice still wins.
 */

function racket(id: string, balance: string, flex = 'Medium'): CatalogItem {
  return {
    id, category: 'racket', brand: 'Yonex', model: id, msrp: 200, skillRange: [1, 6],
    attributes: { weightMinG: 83, weightMaxG: 87, gripSize: 'G4/G5', balance, flex, tier: 'Mid-range', playStyle: 'All-round' },
  } as CatalogItem;
}

const CATALOG = [racket('light', 'Head-light'), racket('even', 'Even'), racket('heavy', 'Head-heavy')];

function input(over: Partial<FitInput> = {}): FitInput {
  return { anchor: null, ownedIds: new Set(), ownedLabels: new Set(), format: 'both', level: 'Intermediate', hasRatings: true, ...over };
}

const gear = (over: Partial<PlayerGear>): PlayerGear => ({ name: 'Lin', items: [], ...over }) as PlayerGear;

describe('which side, and when it counts', () => {
  it('reads the side from a mixed answer while the format is undecided', () => {
    expect(courtSideOf(gear({ fitPlayStyle: 'mixed_front', playFormat: 'both' }))).toBe('front');
    expect(courtSideOf(gear({ fitPlayStyle: 'mixed_back' }))).toBe('back');
    expect(courtSideOf(gear({ fitPlayStyle: 'any', playFormat: 'both' }))).toBeNull();
    expect(courtSideOf(gear({ fitPlayStyle: 'mixed' }))).toBeNull();
    expect(courtSideOf(null)).toBeNull();
  });

  it('an explicit Doubles or Singles tap wins over the side', () => {
    expect(courtSideOf(gear({ fitPlayStyle: 'mixed_back', playFormat: 'doubles' }))).toBeNull();
    expect(sideFormat(gear({ fitPlayStyle: 'mixed_back', playFormat: 'doubles' }))).toBe('doubles');
  });

  it('front reads as doubles and back as singles to the string and tension engines', () => {
    expect(sideFormat(gear({ fitPlayStyle: 'mixed_front', playFormat: 'both' }))).toBe('doubles');
    expect(sideFormat(gear({ fitPlayStyle: 'mixed_back', playFormat: 'both' }))).toBe('singles');
    expect(sideFormat(gear({ fitPlayStyle: 'any', playFormat: 'both' }))).toBe('both');
  });
});

describe('the racket pick', () => {
  it('is versioned', () => expect(FIT_ENGINE_VERSION).toBe('fit-4'));

  it('starts a front-court player head-light and a back-court player head-heavy', () => {
    expect(buildTarget(input({ courtSide: 'front' }), null).balance).toBe(1);
    expect(buildTarget(input({ courtSide: 'back' }), null).balance).toBe(3);
    expect(buildTarget(input(), null).balance).toBe(2);
  });

  it('keeps a slow swing on the back court at even balance (fit-3: a heavy head slows it)', () => {
    expect(sideBalance({ courtSide: 'back', swing: 'slow' })).toBeNull();
    expect(buildTarget(input({ courtSide: 'back', swing: 'slow' }), null).balance).toBe(2);
  });

  it('a sore arm still caps the back court’s head-heavy start', () => {
    const r = recommendFit(input({ courtSide: 'back', armComfort: 'often_sore' }), CATALOG);
    expect(r.top!.item.id).not.toBe('heavy');
  });

  it('picks a different racket for each side, and says why', () => {
    const front = recommendFit(input({ courtSide: 'front' }), CATALOG);
    const back = recommendFit(input({ courtSide: 'back' }), CATALOG);
    const any = recommendFit(input(), CATALOG);
    expect(front.top!.item.id).toBe('light');
    expect(back.top!.item.id).toBe('heavy');
    expect(any.top!.item.id).toBe('even');
    expect(front.top!.reasons.map((r) => r.key)).toContain('reason.frontCourt');
    expect(back.top!.reasons.map((r) => r.key)).toContain('reason.backCourt');
  });

  it('with a racket in the bag, the side only breaks a tie in its favour', () => {
    const anchor = racket('mine', 'Even');
    const anchorAxes = axesOf(anchor)!;
    const target = buildTarget(input({ anchor, courtSide: 'front' }), anchorAxes);
    expect(target.balance).toBe(2); // the racket they play sets the start
  });

  it('reaches the engine from the gear doc', () => {
    const g = gear({ fitPlayStyle: 'mixed_front', playFormat: 'both' });
    expect(buildFitInput(g, [{ skillKey: 'smashes', value: 3 }], []).courtSide).toBe('front');
    expect(buildProfile({ ratings: [{ skillKey: 'smashes', value: 3 }], gear: g })!.format).toBe('doubles');
  });
});

describe('the tension', () => {
  it('back court reads a pound tighter than front, as singles does', () => {
    const front = recommendTension(3, sideFormat(gear({ fitPlayStyle: 'mixed_front', playFormat: 'both' })), 'medium')!;
    const back = recommendTension(3, sideFormat(gear({ fitPlayStyle: 'mixed_back', playFormat: 'both' })), 'medium')!;
    expect(back.lb - front.lb).toBe(1);
  });
});
