import { describe, it, expect } from 'vitest';
import type { CatalogItem } from '../lib/types';
import catalog from '../scripts/data/equipment-catalog.json';
import source from '../scripts/data/badminton_string_database.json';

interface StringRecord {
  id: string;
  brand: string;
  model: string;
  category: string;
  construction: string;
  gaugeCrossMm: number | null;
  skillLevel: string;
  ratingSource: string;
  priceSetUsdMin: number;
}

const all = (catalog as unknown as { items: CatalogItem[] }).items;
const strings = all.filter((i) => i.category === 'string');
const rows = source as unknown as StringRecord[];

describe('string db import', () => {
  it('brings in every source string, prefixed and lowercased', () => {
    expect(strings).toHaveLength(rows.length);
    const ids = new Set(strings.map((i) => i.id));
    for (const raw of rows) {
      expect(ids.has(`string-${raw.id.toLowerCase()}`)).toBe(true);
    }
  });

  it('keeps category as the partition key and never the source string type', () => {
    // The source `category` is the normalized string type ("Durability",
    // "Repulsion"). Writing that here would scatter rows across bogus
    // partitions and make GET ?category=string return nothing — the same
    // outage the racket import had to be fixed for.
    for (const i of strings) expect(i.category).toBe('string');
    const bg65 = strings.find((i) => i.id === 'string-yx-bg65');
    expect(bg65?.attributes?.stringType).toBe('Durability');
    expect('partitionKey' in (bg65 ?? {})).toBe(false);
  });

  it('derives skillRange from skillLevel on the shared 1-6 ACE scale', () => {
    const bands: Record<string, [number, number]> = {
      Beginner: [1, 3],
      Intermediate: [2, 5],
      Advanced: [4, 6],
    };
    for (const raw of rows) {
      const item = strings.find((i) => i.id === `string-${raw.id.toLowerCase()}`);
      expect(item?.skillRange).toEqual(bands[raw.skillLevel] ?? [1, 6]);
    }
  });

  it('converts the set price to CAD without clobbering anything curated', () => {
    const bg65 = strings.find((i) => i.id === 'string-yx-bg65');
    expect(bg65?.msrp).toBe(Math.round(8 * 1.38));
    expect(bg65?.attributes?.priceSetUsdMin).toBe(8);
    expect(bg65?.attributes?.priceSetUsdMax).toBe(12);
  });

  // The 1-10 figures are marketing numbers on three incompatible curves.
  // Carrying ratingSource is what lets a consumer tell a published figure from
  // a community estimate before ranking on either.
  it('carries ratingSource through unchanged on every row', () => {
    for (const raw of rows) {
      const item = strings.find((i) => i.id === `string-${raw.id.toLowerCase()}`);
      expect(item?.attributes?.ratingSource).toBe(raw.ratingSource);
    }
    const sources = new Set(strings.map((i) => i.attributes?.ratingSource));
    // Both kinds must survive the import — collapsing them would erase the
    // distinction the caveat depends on.
    expect(sources.has('Brand published')).toBe(true);
    expect(sources.has('Consensus estimate')).toBe(true);
  });

  it('does not normalize or rescale the brand rating axes', () => {
    // Yonex rates one string 11/10. If a future import "helpfully" clamps to
    // 1-10 it will have invented comparability across brands that does not
    // exist, so the out-of-range value is pinned here on purpose.
    const outOfRange = rows.filter((r) => {
      const item = strings.find((i) => i.id === `string-${r.id.toLowerCase()}`);
      const rep = item?.attributes?.repulsion;
      return typeof rep === 'number' && rep > 10;
    });
    const sourceOutOfRange = rows.filter(
      (r) => typeof (r as unknown as { repulsion?: number }).repulsion === 'number'
        && (r as unknown as { repulsion: number }).repulsion > 10,
    );
    expect(outOfRange).toHaveLength(sourceOutOfRange.length);
  });

  it('populates gaugeCrossMm only on hybrid construction', () => {
    for (const raw of rows) {
      const item = strings.find((i) => i.id === `string-${raw.id.toLowerCase()}`);
      const hasCross = item?.attributes?.gaugeCrossMm !== undefined;
      expect(hasCross).toBe(raw.construction === 'Hybrid' && raw.gaugeCrossMm !== null);
    }
  });

  it('flags every imported row as seeded so a deploy can refresh it', () => {
    for (const i of strings) expect(i.seeded).toBe(true);
  });

  it('leaves the racket catalog untouched', () => {
    // Union, never replace — no string id may collide with a racket id.
    expect(all.filter((i) => i.category === 'racket')).toHaveLength(71);
    const ids = all.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
