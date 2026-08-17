import { describe, it, expect } from 'vitest';
import { playStyleLabel, weightLabel, specTiers, compareRackets } from '../lib/racketSpecs';
import type { CatalogItem } from '../lib/types';

function racket(attributes: Record<string, string>): CatalogItem {
  return { id: 'x', category: 'racket', brand: 'Yonex', model: 'M', skillRange: [1, 6], attributes };
}

describe('playStyleLabel', () => {
  it('keeps a plain value', () => {
    expect(playStyleLabel(racket({ playStyle: 'Power' }))).toBe('Power');
  });
  it('drops a parenthetical qualifier', () => {
    expect(playStyleLabel(racket({ playStyle: 'Power (beginner step-up)' }))).toBe('Power');
  });
  it('takes the first term of a slashed value', () => {
    expect(playStyleLabel(racket({ playStyle: 'All-round / Speed' }))).toBe('All-round');
    expect(playStyleLabel(racket({ playStyle: 'Speed/Control' }))).toBe('Speed');
  });
  it('returns null when absent', () => {
    expect(playStyleLabel(racket({}))).toBeNull();
  });
});

describe('weightLabel', () => {
  it('folds the gram range into the weight class', () => {
    expect(weightLabel(racket({ weight: '4U', weightGrams: '83-88' }))).toBe('4U (83–88g)');
  });
  // The 15 legacy rows have no weightGrams — degrade, never render "4U ()".
  it('renders the class alone when grams are missing', () => {
    expect(weightLabel(racket({ weight: '4U' }))).toBe('4U');
  });
  it('returns null when there is no weight at all', () => {
    expect(weightLabel(racket({}))).toBeNull();
  });
});

describe('specTiers', () => {
  it('splits plain language from specs', () => {
    const r = racket({ playStyle: 'Power', balance: 'Head-heavy', weight: '4U', weightGrams: '83-88', flex: 'Extra Stiff' });
    expect(specTiers(r)).toEqual({ plain: 'Power · Head-heavy', specs: '4U (83–88g) · Extra Stiff' });
  });
  it('omits the plain tier entirely when there is no play style', () => {
    const r = racket({ balance: 'Head-heavy', weight: '4U' });
    expect(specTiers(r)).toEqual({ plain: 'Head-heavy', specs: '4U' });
  });
  it('returns nulls for a bare item rather than empty strings', () => {
    expect(specTiers(racket({}))).toEqual({ plain: null, specs: null });
  });
});

describe('compareRackets', () => {
  const mine = racket({ weight: '3U', balance: 'Head-heavy', flex: 'Stiff' });

  it('reports weight first — the most felt difference', () => {
    const theirs = racket({ weight: '4U', balance: 'Head-light', flex: 'Flexible' });
    expect(compareRackets(mine, theirs)).toBe('lighter');
  });
  it('falls through to balance when weight ties', () => {
    const theirs = racket({ weight: '3U', balance: 'Head-light', flex: 'Flexible' });
    expect(compareRackets(mine, theirs)).toBe('moreHeadLight');
  });
  it('falls through to flex when weight and balance tie', () => {
    const theirs = racket({ weight: '3U', balance: 'Head-heavy', flex: 'Extra Stiff' });
    expect(compareRackets(mine, theirs)).toBe('stiffer');
  });
  it('returns null when nothing differs', () => {
    expect(compareRackets(mine, racket({ weight: '3U', balance: 'Head-heavy', flex: 'Stiff' }))).toBeNull();
  });
  it('returns null when the player has no racket to compare against', () => {
    expect(compareRackets(null, racket({ weight: '5U' }))).toBeNull();
  });
});
