import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { CatalogItem } from '../lib/types';

/**
 * `lib/stringPair.ts` reads twelve fields off `attributes`. Every one of them
 * has a fallback, which is the problem this test exists for: a row that loses a
 * field does not throw, it silently scores as average and quietly stops being
 * a good pick. There is no error anywhere.
 *
 * This repo has shipped exactly that failure once. `isScorable` skipped 50 of
 * 71 rackets in PRODUCTION while every local test passed, because in dev the
 * seed JSON *is* the catalog — so the file and the database can disagree and
 * only the database is wrong. See CLAUDE.md, "Catalog seeding REFRESHES".
 */
const seed = JSON.parse(
  readFileSync(join(__dirname, '..', 'scripts/data/equipment-catalog.json'), 'utf8'),
) as { items: CatalogItem[] };

const strings = seed.items.filter((i) => i.category === 'string');

const NUMERIC = [
  'gaugeMm', 'repulsion', 'durability', 'feelScale',
  'priceSetUsdMin', 'priceSetUsdMax', 'tensionMinLbs', 'tensionMaxLbs',
] as const;
const TEXTUAL = ['stringType', 'feel', 'skillLevel', 'ratingSource'] as const;

describe('string catalog shape — every field the pairing engine reads', () => {
  it('ships strings at all', () => {
    expect(strings.length).toBeGreaterThanOrEqual(46);
  });

  for (const field of NUMERIC) {
    it(`has a numeric ${field} on every string`, () => {
      const bad = strings.filter((s) => typeof s.attributes?.[field] !== 'number');
      expect(bad.map((s) => s.id)).toEqual([]);
    });
  }

  for (const field of TEXTUAL) {
    it(`has a non-empty ${field} on every string`, () => {
      const bad = strings.filter((s) => {
        const v = s.attributes?.[field];
        return typeof v !== 'string' || !v.trim();
      });
      expect(bad.map((s) => s.id)).toEqual([]);
    });
  }

  it('rates every string on a scale the skill gate recognises', () => {
    const known = ['beginner', 'intermediate', 'advanced'];
    const bad = strings.filter(
      (s) => !known.includes(String(s.attributes?.skillLevel).toLowerCase()),
    );
    expect(bad.map((s) => s.id)).toEqual([]);
  });

  it('gives every string a tension window a stringer could use', () => {
    const bad = strings.filter((s) => {
      const lo = s.attributes?.tensionMinLbs as number;
      const hi = s.attributes?.tensionMaxLbs as number;
      return !(hi > lo);
    });
    expect(bad.map((s) => s.id)).toEqual([]);
  });
});
