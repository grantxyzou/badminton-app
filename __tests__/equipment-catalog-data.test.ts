import { describe, it, expect } from 'vitest';
import catalog from '../scripts/data/equipment-catalog.json';
import type { CatalogItem } from '../lib/types';

const items = catalog.items as unknown as CatalogItem[];

describe('equipment catalog data', () => {
  it('holds the merged 50-racket catalog', () => {
    expect(items).toHaveLength(50);
  });

  // category IS the Cosmos partition key. The source file's `category` means
  // play-style ("Power"); writing it here scatters rows across bogus
  // partitions and GET ?category=racket returns nothing — the empty-catalog
  // outage fixed in de2505e.
  it('uses racket as the partition key on every row, never a play-style', () => {
    for (const item of items) {
      expect(item.category).toBe('racket');
    }
  });

  it('never carries the source partitionKey field', () => {
    for (const item of items) {
      expect(item).not.toHaveProperty('partitionKey');
    }
  });

  it('gives every row a two-element skillRange the recommender can read', () => {
    for (const item of items) {
      expect(item.skillRange).toHaveLength(2);
      expect(item.skillRange[0]).toBeLessThanOrEqual(item.skillRange[1]);
    }
  });

  it('keeps ids unique and racket-prefixed', () => {
    const ids = items.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id.startsWith('racket-')).toBe(true);
  });

  // The 4 overlaps keep their curated CAD msrp + retailer links rather than
  // being overwritten by the import.
  it('preserves the curated data on rackets that existed before the import', () => {
    const astrox = items.find((i) => i.id === 'racket-yonex-astrox-88d-pro');
    expect(astrox?.msrp).toBe(309);
    expect(astrox?.sources?.[0]?.retailer).toBe('Yumo');
  });

  it('imports new rackets with converted pricing and derived skillRange', () => {
    const zz = items.find((i) => i.id === 'racket-yonex-astrox-100zz');
    expect(zz?.brand).toBe('Yonex');
    expect(zz?.attributes?.weightGrams).toBe('83-88');
    expect(zz?.attributes?.playStyle).toBe('Power');
    expect(zz?.skillRange).toEqual([4, 6]); // tier: Premium
  });
});
