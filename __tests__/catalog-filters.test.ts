import { describe, it, expect } from 'vitest';
import { applyFilters, facetValues, matchesFilters, valuesOf, FACETS, type Facet } from '../lib/catalogFilters';
import type { CatalogItem } from '../lib/types';
import catalogSeed from '../scripts/data/equipment-catalog.json';
import en from '../messages/en.json';
import zh from '../messages/zh-CN.json';

const rackets = (catalogSeed as unknown as { items: CatalogItem[] }).items.filter((i) => i.category === 'racket');

describe('catalog filters', () => {
  it('a dual weight class counts as both classes', () => {
    const row = rackets.find((r) => r.attributes?.weight === '3U/4U')!;
    expect(valuesOf(row, 'weight')).toEqual(['3U', '4U']);
    expect(matchesFilters(row, { weight: '4U' })).toBe(true);
    expect(matchesFilters(row, { weight: '5U' })).toBe(false);
  });

  it('every row left satisfies EVERY applied chip, across the real catalog', () => {
    for (const applied of [{ weight: '4U', balance: 'Even' }, { brand: 'Yonex', flex: 'Stiff' }, { balance: 'Head-heavy', weight: '3U', brand: 'Victor' }]) {
      const rows = applyFilters(rackets, applied);
      expect(rows.length).toBeGreaterThan(0);
      for (const r of rows) {
        for (const [facet, value] of Object.entries(applied)) {
          expect(valuesOf(r, facet as Facet), `${r.id} ${facet}`).toContain(value);
        }
      }
      // And nothing that satisfies them was dropped.
      expect(rows.length).toBe(rackets.filter((r) => matchesFilters(r, applied)).length);
    }
  });

  it('no filters returns the list untouched', () => {
    expect(applyFilters(rackets, {})).toBe(rackets);
  });

  it('offers values in their natural order, only ones the catalog uses', () => {
    expect(facetValues(rackets, 'weight')).toEqual(['3U', '4U', '5U']);
    expect(facetValues(rackets, 'balance')).toEqual(['Head-light', 'Even', 'Head-heavy']);
    expect(facetValues(rackets, 'flex')[0]).toBe('Flexible');
  });

  it('every facet label exists in both locales (the sheet reads them dynamically)', () => {
    const label: Record<string, string> = { brand: 'filterBrand', weight: 'filterWeight', balance: 'filterBalance', flex: 'filterShaft', type: 'filterType' };
    const setup = (m: unknown) => (m as { stats: { gear: { setup: Record<string, string> } } }).stats.gear.setup;
    for (const facet of [...FACETS.racket, ...FACETS.string]) {
      expect(setup(en)[label[facet]]).toBeTruthy();
      expect(setup(zh)[label[facet]]).toBeTruthy();
    }
  });
});
