import { describe, it, expect } from 'vitest';
import catalog from '../scripts/data/equipment-catalog.json';
import type { CatalogItem } from '../lib/types';

const items = catalog.items as unknown as CatalogItem[];

describe('equipment catalog data', () => {
  it('holds the 71-racket catalog after v2 import', () => {
    // Counted by category rather than by total length: strings now share this
    // file, and a bare length check would silently stop guarding the rackets
    // the moment another category arrived.
    expect(items.filter((i) => i.category === 'racket')).toHaveLength(71);
  });

  it('holds the 46-string catalog after the string import', () => {
    expect(items.filter((i) => i.category === 'string')).toHaveLength(46);
  });

  // category IS the Cosmos partition key. Each source file's `category` means
  // something else — play-style ("Power") for rackets, string type
  // ("Durability") for strings; writing either here scatters rows across bogus
  // partitions and GET ?category=racket returns nothing — the empty-catalog
  // outage fixed in de2505e.
  it('uses a real equipment category as the partition key, never a source play-style', () => {
    const VALID = ['racket', 'string', 'shoe', 'shuttle', 'bag', 'grip'];
    const SOURCE_PLAY_STYLES = ['Power', 'Speed', 'Control', 'All-round', 'Durability', 'Repulsion', 'Hybrid'];
    for (const item of items) {
      expect(VALID).toContain(item.category);
      expect(SOURCE_PLAY_STYLES).not.toContain(item.category);
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

  it('keeps ids unique and prefixed by their own category', () => {
    // The prefix is what stops two source files colliding on a bare model id
    // once the catalog holds more than one category.
    const ids = items.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const item of items) {
      expect(item.id.startsWith(`${item.category}-`)).toBe(true);
    }
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
    expect(zz?.attributes?.weightMinG).toBe(83);
    expect(zz?.attributes?.weightMaxG).toBe(88);
    expect(zz?.attributes?.playStyle).toBe('Power');
    expect(zz?.skillRange).toEqual([4, 6]); // tier: Premium
  });
});
