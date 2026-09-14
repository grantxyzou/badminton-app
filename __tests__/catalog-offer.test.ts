import { describe, it, expect } from 'vitest';
import { isOffered } from '../lib/catalogOffer';
import { recommendFit, type FitInput } from '../lib/racketFit';
import { recommendRackets } from '../lib/racketRecommend';
import type { PlayerProfile } from '../lib/racketProfile';
import type { CatalogItem } from '../lib/types';
import catalogSeed from '../scripts/data/equipment-catalog.json';

/**
 * `attributes.unlisted` withdraws a catalog row from being OFFERED — picked by
 * either engine, or listed to add — while the row stays resolvable for anyone
 * whose bag already points at it. Added with the catalog check of 2026-09-14,
 * which found rows that are not real rackets (docs/catalog-check-2026-09-14.md).
 */

function racket(id: string, a: Record<string, string | number>): CatalogItem {
  return {
    id, category: 'racket', brand: 'Test', model: id, msrp: 200, skillRange: [1, 6],
    attributes: { weightMinG: 83, weightMaxG: 87, gripSize: 'G5', tier: 'Premium', playStyle: 'Power', ...a },
  };
}

// Identical specs, so only the flag can separate them.
const LISTED = racket('listed', { balance: 'Head-heavy', flex: 'Stiff' });
const GHOST = racket('ghost', { balance: 'Head-heavy', flex: 'Stiff', unlisted: 'not_a_model' });

function input(over: Partial<FitInput> = {}): FitInput {
  return { anchor: null, ownedIds: new Set(), ownedLabels: new Set(), format: 'both', level: 'Intermediate', hasRatings: true, ...over };
}

function profile(): PlayerProfile {
  return {
    serves: 3, net_play: 3, clears: 3, drops: 3, drives: 3, smashes: 3, grip: 3,
    footwork: 3, court_coverage: 3, stamina: 3, game_reading: 3, consistency: 3, rules: 3, mindset: 3,
    format: 'both', ratedKeys: [],
  };
}

describe('unlisted catalog rows', () => {
  it('isOffered reads the flag, whatever reason it carries', () => {
    expect(isOffered(LISTED)).toBe(true);
    expect(isOffered(GHOST)).toBe(false);
    expect(isOffered(racket('d', { balance: 'Even', flex: 'Medium', unlisted: 'discontinued' }))).toBe(false);
  });

  it('the fit engine never picks an unlisted row, even as the only candidate', () => {
    const both = recommendFit(input(), [GHOST, LISTED]);
    const ids = [both.top?.item.id, ...both.alternatives.map((a) => a.item.id)];
    expect(ids).toContain('listed');
    expect(ids).not.toContain('ghost');
    expect(recommendFit(input(), [GHOST]).top).toBeNull();
  });

  it('a member whose racket is unlisted still anchors a pick — only offering is withdrawn', () => {
    const r = recommendFit(input({ anchor: GHOST, ownedIds: new Set(['ghost']) }), [GHOST, LISTED]);
    expect(r.fitState.startsWith('anchored')).toBe(true);
    expect(r.top?.item.id).toBe('listed');
  });

  it('the older recommender skips an unlisted row too', () => {
    const out = recommendRackets(profile(), [GHOST, LISTED]);
    expect(out.map((o) => o.item.id)).toEqual(['listed']);
  });

  it('the catalog withdraws exactly the rows the check found, each with a known reason', () => {
    const items = (catalogSeed as unknown as { items: CatalogItem[] }).items;
    const unlisted = Object.fromEntries(items.filter((i) => !isOffered(i)).map((i) => [i.id, i.attributes!.unlisted]));
    expect(unlisted).toEqual({
      'racket-victor-nitrolite-80x': 'not_a_model',
      'racket-li-ning-halberd-900': 'not_a_model',
      'racket-li-ning-g-force-superlite': 'not_a_model',
      'racket-li-ning-axforce-90-dragon': 'duplicate',
      'racket-yonex-nanoflare-700': 'discontinued',
      'racket-li-ning-air-force-79': 'discontinued',
    });
  });
});
