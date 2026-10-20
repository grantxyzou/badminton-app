import { describe, it, expect } from 'vitest';
import type { CatalogItem } from '../lib/types';
import catalog from '../scripts/data/equipment-catalog.json';
import source from '../scripts/data/racket-database-v2.json';

interface RacketDatabaseV2Record {
  id: string;
}

// Scoped to rackets: this file is about the RACKET import, and the catalog is
// now shared with strings. Asserting over every row would make this suite fail
// whenever an unrelated category is imported, which is noise rather than
// signal — the string import has its own coverage.
const items = (catalog as unknown as { items: CatalogItem[] }).items.filter(
  (i) => i.category === 'racket',
);

describe('v2 racket import', () => {
  it('merges by prefixed id rather than duplicating', () => {
    // 71 after the v2 import; 157 after the catalog check of 2026-09-14 added
    // 86 current (2024–2026) models through this importer.
    expect(items).toHaveLength(157);
    const ids = items.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const raw of source as RacketDatabaseV2Record[]) {
      expect(ids).toContain(`racket-${raw.id}`);
    }
  });

  it('keeps category as the partition key and never the source play style', () => {
    for (const i of items) expect(i.category).toBe('racket');
    const astrox = items.find((i) => i.id === 'racket-yonex-astrox-100zz');
    expect(astrox?.attributes?.playStyle).toBe('Power');
    expect(astrox?.attributes?.partitionKey).toBeUndefined();
    expect('partitionKey' in (astrox || {})).toBe(false);
  });

  it('carries the normalized fields the engine needs', () => {
    const astrox = items.find((i) => i.id === 'racket-yonex-astrox-100zz');
    expect(astrox!.attributes!.balance).toBe('Head-heavy');
    expect(astrox!.attributes!.flex).toBe('Extra Stiff');
    expect(astrox!.attributes!.tier).toBe('Premium');
    expect(astrox!.attributes!.weightMaxG).toBe(88);
    expect(astrox!.skillRange).toEqual([4, 6]);
    // A row with no curated price gets its CAD msrp from the USD floor.
    expect(astrox!.msrp).toBe(Math.round((astrox!.attributes!.priceMinUSD as number) * 1.38));
  });

  // Regression pin: the merge used to do `existing.attributes = mapped.attributes`,
  // a wholesale replace that silently dropped every pre-existing attribute key
  // v2 doesn't supply (35 rows lost `weightGrams`, which lib/racketSpecs.ts
  // reads to render "3U/4U (83-88g)"). The merge must be field-by-field:
  // v2's keys win on collision, but a curated key v2 never had is kept.
  it('merges attributes field-by-field: v2 keys win, curated-only keys survive', () => {
    const astrox = items.find((i) => i.id === 'racket-yonex-astrox-100zz');
    // Pre-existing, curated-only key (v2 has no `weightGrams` field at all) — preserved.
    expect(astrox?.attributes?.weightGrams).toBe('83-88');
    // v2-supplied normalized keys the pre-existing row never had — gained.
    expect(astrox?.attributes?.tier).toBe('Premium');
    expect(astrox?.attributes?.balance).toBe('Head-heavy');
  });

  // The importer is re-runnable, so a correction made to the catalog alone is
  // undone by the next run. The 2026-10-09 Astrox 88S relabel was, for eleven
  // days: Even in the catalog, Head-heavy in the source. Every field the
  // importer writes must already agree with the catalog.
  it('agrees with the catalog on every field the importer writes, so a re-run reverts nothing', () => {
    const FIELDS: Array<[string, string]> = [
      ['series', 'series'], ['category', 'playStyle'], ['subType', 'subType'],
      ['balance', 'balance'], ['flex', 'flex'], ['weightClass', 'weight'],
      ['weightMinG', 'weightMinG'], ['weightMaxG', 'weightMaxG'], ['tier', 'tier'],
      ['frameMaterial', 'frameMaterial'], ['tensionMinLbs', 'tensionMinLbs'],
      ['tensionMaxLbs', 'tensionMaxLbs'], ['gripSize', 'gripSize'],
      ['priceMinUSD', 'priceMinUSD'], ['priceMaxUSD', 'priceMaxUSD'],
      ['lastVerified', 'lastVerified'], ['notes', 'notes'], ['stringPattern', 'stringPattern'],
    ];
    const byId = new Map(items.map((i) => [i.id, i]));
    const drift: string[] = [];
    for (const raw of source as unknown as Array<Record<string, unknown>>) {
      const row = byId.get(`racket-${raw.id}`);
      for (const [from, to] of FIELDS) {
        const v = raw[from];
        if (v === undefined || v === null || v === '') continue;
        if (row?.attributes?.[to] !== v) drift.push(`${raw.id}.${to}: source ${String(v)}, catalog ${String(row?.attributes?.[to])}`);
      }
    }
    expect(drift).toEqual([]);
  });

  it('leaves the 11 legacy-only rackets in place', () => {
    const sourceIds = new Set((source as RacketDatabaseV2Record[]).map((r) => `racket-${r.id}`));
    const legacy = items.filter((i) => !sourceIds.has(i.id));
    expect(legacy).toHaveLength(11);
  });
});
