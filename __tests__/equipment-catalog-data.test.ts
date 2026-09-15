import { describe, it, expect } from 'vitest';
import catalog from '../scripts/data/equipment-catalog.json';
import { isScorable } from '../lib/racketRecommend';
import type { CatalogItem } from '../lib/types';

const items = catalog.items as unknown as CatalogItem[];

describe('equipment catalog data', () => {
  it('holds the 157-racket catalog (v2 import + the 2026-09-14 catalog check)', () => {
    // Counted by category rather than by total length: strings now share this
    // file, and a bare length check would silently stop guarding the rackets
    // the moment another category arrived.
    expect(items.filter((i) => i.category === 'racket')).toHaveLength(157);
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

  // The 4 overlaps keep their retailer links rather than being overwritten by
  // the import. Their curated CAD msrp did NOT survive: on 2026-09-14 every
  // price moved to one source (lib/catalogPrice.ts), because the hand-set
  // figures had drifted from the sourced ranges shown on the racket page.
  it('preserves the curated retailer links on rackets that existed before the import', () => {
    const astrox = items.find((i) => i.id === 'racket-yonex-astrox-88d-pro');
    expect(astrox?.sources?.[0]?.retailer).toBe('Yumo');
    expect(astrox?.msrp).toBe(Math.round(Number(astrox?.attributes?.priceMinUSD) * 1.38));
  });

  /* ── Vocabulary ─────────────────────────────────────────────────────────
     The failure this guards is invisible at runtime: `recommendRackets` skips
     a row it cannot score honestly, and a skipped row looks exactly like a row
     that scored badly. Nothing errors, nothing logs, the rail still renders a
     confident pick — from a smaller catalog than anyone thinks.

     It has now cost this catalog twice. Once in production, when Cosmos held
     pre-v2 row shapes the seed file had already moved past and 50 of 71
     rackets went unscored (see CLAUDE.md). And once in the seed file itself:
     11 rows carried `"head-heavy"` / `"extra-stiff"` and a sentence where
     `playStyle` takes a vocabulary word, so they were unrecommendable from the
     day they were written until 2026-08-21.

     A vocabulary check is the only cheap thing that catches either. */
  const VOCAB = {
    balance: ['Head-heavy', 'Head-light', 'Even'],
    flex: ['Flexible', 'Medium', 'Medium-Stiff', 'Stiff', 'Extra Stiff'],
    playStyle: ['Power', 'Speed', 'Control', 'All-round'],
    tier: ['Entry-level', 'Mid-range', 'Premium'],
  } as const;

  const rackets = () => items.filter((i) => i.category === 'racket');

  it('can actually score every racket it ships', () => {
    const skipped = rackets().filter((r) => !isScorable(r)).map((r) => r.id);
    expect(skipped).toEqual([]);
  });

  for (const [field, allowed] of Object.entries(VOCAB)) {
    it(`keeps every racket's ${field} inside the vocabulary the scorers match on`, () => {
      const offenders = rackets()
        .map((r) => ({ id: r.id, value: r.attributes?.[field as keyof typeof VOCAB] }))
        .filter((r) => !(allowed as readonly string[]).includes(String(r.value)));
      expect(offenders).toEqual([]);
    });
  }

  it('gives every racket a weight range the weight scorer can read', () => {
    const offenders = rackets()
      .filter((r) => typeof r.attributes?.weightMaxG !== 'number')
      .map((r) => r.id);
    expect(offenders).toEqual([]);
  });

  /* Tension is the one field deliberately NOT backfilled. `scoreTension` has a
     first-class branch for a frame with no published ceiling — it scores mid
     and says "verify before stringing" — so an absent value degrades honestly,
     while a value invented from series convention would be a fabricated spec
     driving a real stringing decision. Pinned so nobody "fixes" it by guessing. */
  it('leaves the unpublished tension ceilings absent rather than guessing them', () => {
    const withoutCeiling = rackets().filter((r) => typeof r.attributes?.tensionMaxLbs !== 'number');
    // 11 before the 2026-09-14 check. That check found a published range for 5
    // of them, and added 38 new models whose makers print none — without one,
    // by the same rule (11 − 5 + 38).
    expect(withoutCeiling.length).toBe(44);
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
