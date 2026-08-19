import { describe, it, expect } from 'vitest';
import { recommendRackets } from '../lib/racketRecommend';
import type { PlayerProfile } from '../lib/racketProfile';
import type { CatalogItem } from '../lib/types';

function profile(over: Partial<PlayerProfile> = {}): PlayerProfile {
  return {
    serves: 3, net_play: 3, clears: 3, drops: 3, drives: 3, smashes: 3, grip: 3,
    footwork: 3, court_coverage: 3, stamina: 3,
    game_reading: 3, consistency: 3, rules: 3, mindset: 3,
    format: 'both', ...over,
  };
}

function racket(id: string, attrs: Record<string, string | number>, msrp = 150): CatalogItem {
  return {
    id, category: 'racket', brand: 'Test', model: id, msrp,
    skillRange: [2, 5], attributes: { tier: 'Mid-range', ...attrs },
  };
}

const HEAD_HEAVY = racket('hh', { balance: 'Head-heavy', flex: 'Medium', playStyle: 'Power', weightMaxG: 88 });
const HEAD_LIGHT = racket('hl', { balance: 'Head-light', flex: 'Medium', playStyle: 'Speed', weightMaxG: 83 });
const EVEN = racket('ev', { balance: 'Even', flex: 'Medium', playStyle: 'All-round', weightMaxG: 85 });

describe('recommendRackets', () => {
  it('ranks head-heavy first for a power-led player', () => {
    const p = profile({ smashes: 5, clears: 5, drives: 1, net_play: 1 });
    const out = recommendRackets(p, [HEAD_LIGHT, EVEN, HEAD_HEAVY]);
    expect(out[0].item.id).toBe('hh');
    expect(out[0].reasons.join(' ')).toMatch(/head-heavy/i);
  });

  it('ranks head-light first for a speed-led player', () => {
    const p = profile({ drives: 5, net_play: 5, smashes: 1, clears: 1 });
    const out = recommendRackets(p, [HEAD_HEAVY, EVEN, HEAD_LIGHT]);
    expect(out[0].item.id).toBe('hl');
  });

  it('warns and penalises a shaft stiffer than the player can load', () => {
    const stiff = racket('xs', { balance: 'Even', flex: 'Extra Stiff', playStyle: 'Power', weightMaxG: 85 });
    const p = profile({ consistency: 1, grip: 1, smashes: 1 });
    const out = recommendRackets(p, [stiff, EVEN]);
    expect(out[0].item.id).toBe('ev');
    const stiffRec = out.find((r) => r.item.id === 'xs')!;
    expect(stiffRec.warnings.join(' ')).toMatch(/demanding/i);
  });

  it('never recommends the racket the player already owns', () => {
    const p = profile({ currentRacketId: 'ev' });
    const out = recommendRackets(p, [EVEN]);
    expect(out).toHaveLength(0);
  });

  // Spec D6: prices are USD-derived and go stale. An over-budget racket must
  // sink, never vanish — a silent exclusion is invisible when the price is wrong.
  it('sinks an over-budget racket but does not remove it', () => {
    const pricey = racket('exp', { balance: 'Even', flex: 'Medium', playStyle: 'All-round', weightMaxG: 85 }, 500);
    const p = profile({ budgetMaxCad: 200 });
    const out = recommendRackets(p, [pricey, EVEN]);
    expect(out.map((r) => r.item.id)).toContain('exp');
    expect(out[0].item.id).toBe('ev');
  });

  // Spec D4: the 11 legacy rows lack normalized fields. Scoring them would
  // invent values the data does not have.
  it('skips rackets missing the normalized fields it scores on', () => {
    const legacy = { id: 'old', category: 'racket', brand: 'Old', model: 'Legacy', skillRange: [1, 6], attributes: { weight: '4U' } } as CatalogItem;
    const out = recommendRackets(profile(), [legacy, EVEN]);
    expect(out.map((r) => r.item.id)).toEqual(['ev']);
  });

  it('scores 0-100 and returns at most topN, best first', () => {
    const out = recommendRackets(profile(), [HEAD_HEAVY, HEAD_LIGHT, EVEN], 2);
    expect(out).toHaveLength(2);
    expect(out[0].score).toBeGreaterThanOrEqual(out[1].score);
    for (const r of out) {
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(100);
    }
  });
});
