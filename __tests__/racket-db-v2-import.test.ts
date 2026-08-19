import { describe, it, expect } from 'vitest';
import catalog from '../scripts/data/equipment-catalog.json';
import source from '../scripts/data/racket-database-v2.json';

const items = (catalog as { items: any[] }).items;

describe('v2 racket import', () => {
  it('merges by prefixed id rather than duplicating', () => {
    expect(items).toHaveLength(71);
    const ids = items.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const raw of source as any[]) {
      expect(ids).toContain(`racket-${raw.id}`);
    }
  });

  it('keeps category as the partition key and never the source play style', () => {
    for (const i of items) expect(i.category).toBe('racket');
    const astrox = items.find((i) => i.id === 'racket-yonex-astrox-100zz');
    expect(astrox.attributes.playStyle).toBe('Power');
    expect(astrox.attributes.partitionKey).toBeUndefined();
    expect((astrox as any).partitionKey).toBeUndefined();
  });

  it('carries the normalized fields the engine needs', () => {
    const astrox = items.find((i) => i.id === 'racket-yonex-astrox-100zz');
    expect(astrox.attributes.balance).toBe('Head-heavy');
    expect(astrox.attributes.flex).toBe('Extra Stiff');
    expect(astrox.attributes.tier).toBe('Premium');
    expect(astrox.attributes.weightMaxG).toBe(88);
    expect(astrox.skillRange).toEqual([4, 6]);
    expect(astrox.msrp).toBe(Math.round(220 * 1.38));
  });

  it('leaves the 11 legacy-only rackets in place', () => {
    const sourceIds = new Set((source as any[]).map((r) => `racket-${r.id}`));
    const legacy = items.filter((i) => !sourceIds.has(i.id));
    expect(legacy).toHaveLength(11);
  });
});
