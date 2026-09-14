import { describe, it, expect } from 'vitest';
import { feelAnchor, parseFeel, hasFeel } from '../lib/racketFeel';
import { buildFitInput } from '../lib/racketFitInput';
import { recommendFit } from '../lib/racketFit';
import { FEEL_WORD_KEY, racketFeelLine } from '../lib/gearSetup';
import type { CatalogItem, GearItem, PlayerGear } from '../lib/types';
import en from '../messages/en.json';
import zh from '../messages/zh-CN.json';

/**
 * A racket the catalog does not have, logged by name and described by the
 * member (Grant, 2026-09-14). The answers are the fit engine's anchor only
 * when balance AND shaft are both answered.
 */

function racket(id: string, a: Record<string, string | number>): CatalogItem {
  return {
    id, category: 'racket', brand: 'Test', model: id, msrp: 200, skillRange: [1, 6],
    attributes: { weightMinG: 83, weightMaxG: 87, gripSize: 'G5', tier: 'Mid-range', playStyle: 'Power', ...a },
  };
}
const CATALOG = [
  racket('heavy-stiff', { balance: 'Head-heavy', flex: 'Stiff' }),
  racket('light-flex', { balance: 'Head-light', flex: 'Flexible' }),
  racket('even-medium', { balance: 'Even', flex: 'Medium' }),
];

const TYPED: GearItem = { id: 'g1', catalogId: null, category: 'racket', label: 'Victor Auraspeed 90S' };

function gearWith(item: GearItem, extra: Partial<PlayerGear> = {}): PlayerGear {
  return { id: 'gear-m', memberId: 'm', items: [item], activeRacketId: item.id, updatedAt: '', ...extra } as PlayerGear;
}

describe('feelAnchor', () => {
  it('needs balance AND shaft; either alone is no anchor', () => {
    expect(feelAnchor({ ...TYPED, feel: { balance: 'Head-heavy' } }, null)).toBeNull();
    expect(feelAnchor({ ...TYPED, feel: { flex: 'Stiff', weight: '4U' } }, null)).toBeNull();
    expect(feelAnchor(TYPED, null)).toBeNull();
    expect(feelAnchor({ ...TYPED, feel: { balance: 'Head-heavy', flex: 'Stiff' } }, null)).not.toBeNull();
  });

  it('carries the member\'s words, the weight class in grams, and the LEVEL tier', () => {
    const a = feelAnchor({ ...TYPED, feel: { balance: 'Even', flex: 'Medium', weight: '3U' } }, 'Beginner')!;
    expect(a.model).toBe('Victor Auraspeed 90S');
    expect(a.attributes).toMatchObject({ balance: 'Even', flex: 'Medium', weightMinG: 85, weightMaxG: 89, tier: 'Entry-level' });
    expect(feelAnchor({ ...TYPED, feel: { balance: 'Even', flex: 'Medium' } }, 'Advanced')!.attributes!.tier).toBe('Premium');
    expect(feelAnchor({ ...TYPED, feel: { balance: 'Even', flex: 'Medium' } }, null)!.attributes!.tier).toBe('Mid-range');
    // No weight answered → no grams invented.
    expect(feelAnchor({ ...TYPED, feel: { balance: 'Even', flex: 'Medium' } }, null)!.attributes!.weightMinG).toBeUndefined();
  });

  it('never anchors a catalog racket through feel answers', () => {
    expect(feelAnchor({ ...TYPED, catalogId: 'heavy-stiff', feel: { balance: 'Even', flex: 'Medium' } }, null)).toBeNull();
  });
});

describe('a typed racket in the fit engine', () => {
  it('with balance and shaft answered, it anchors the picks', () => {
    const gear = gearWith({ ...TYPED, feel: { balance: 'Head-heavy', flex: 'Stiff' } });
    const input = buildFitInput(gear, [], CATALOG);
    expect(input.anchor?.model).toBe('Victor Auraspeed 90S');
    const r = recommendFit(input, CATALOG);
    expect(r.fitState).toBe('anchored_default');
    expect(r.top?.item.id).toBe('heavy-stiff');
    expect(r.top?.reasons[0]).toEqual({ key: 'reason.anchoredDefault', params: { model: 'Victor Auraspeed 90S' } });
  });

  it('with shaft unanswered, it does not — the member is asked, not guessed at', () => {
    const gear = gearWith({ ...TYPED, feel: { balance: 'Head-heavy' } });
    const input = buildFitInput(gear, [], CATALOG);
    expect(input.anchor).toBeNull();
    expect(recommendFit(input, CATALOG).fitState).toBe('needsFit');
  });

  it('a described SPARE is not the anchor; only the racket in play is', () => {
    const spare: GearItem = { ...TYPED, feel: { balance: 'Head-heavy', flex: 'Stiff' } };
    const inPlay: GearItem = { id: 'g2', catalogId: 'light-flex', category: 'racket', label: 'Test light-flex' };
    const gear = { ...gearWith(spare), items: [spare, inPlay], activeRacketId: 'g2' } as PlayerGear;
    expect(buildFitInput(gear, [], CATALOG).anchor?.id).toBe('light-flex');
  });
});

describe('parseFeel', () => {
  it('keeps known answers, drops unknown keys, refuses an answer outside the vocabulary', () => {
    expect(parseFeel({ balance: 'Even', flex: null, other: 'x' })).toEqual({ balance: 'Even' });
    expect(parseFeel({ flex: 'Extra Stiff' })).toBeNull();
    expect(parseFeel('Even')).toBeNull();
    expect(parseFeel({})).toEqual({});
    expect(hasFeel({})).toBe(false);
    expect(hasFeel({ weight: '5U' })).toBe(true);
  });
});

describe('feel words', () => {
  it('every feel word key exists in both locales (check-i18n-keys cannot see a dynamic t())', () => {
    const setupEn = (en as unknown as { stats: { gear: { setup: Record<string, string> } } }).stats.gear.setup;
    const setupZh = (zh as unknown as { stats: { gear: { setup: Record<string, string> } } }).stats.gear.setup;
    for (const key of Object.values(FEEL_WORD_KEY)) {
      expect(setupEn[key], key).toBeTruthy();
      expect(setupZh[key], key).toBeTruthy();
    }
  });

  it('describes a typed racket in catalog order, and says nothing when nothing was answered', () => {
    const setupEn = (en as unknown as { stats: { gear: { setup: Record<string, string> } } }).stats.gear.setup;
    expect(racketFeelLine({ flex: 'Stiff', balance: 'Head-heavy', weight: '4U' }, (k) => setupEn[k])).toBe('4U · head-heavy · stiff');
    expect(racketFeelLine({}, (k) => setupEn[k])).toBeNull();
    expect(racketFeelLine(undefined, (k) => setupEn[k])).toBeNull();
  });
});
