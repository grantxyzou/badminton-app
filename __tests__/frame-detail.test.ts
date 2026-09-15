import { describe, it, expect } from 'vitest';
import { bandPosition, cadRange, closeToFrame, frameHistory, specCells } from '../lib/frameDetail';
import seed from '../scripts/data/equipment-catalog.json';
import type { CatalogItem, PlayerGear } from '../lib/types';

/** The frame page's rules: nothing the app does not hold is shown. */

const AF79 = {
  id: 'racket-li-ning-air-force-79', category: 'racket', brand: 'Li-Ning', model: 'Air Force 79',
  attributes: { balance: 'Even', flex: 'Medium', weight: '4U/5U', weightMinG: 77, weightMaxG: 84, tensionMinLbs: 19, tensionMaxLbs: 26, gripSize: 'G5/G6', priceMinUSD: 90, priceMaxUSD: 120, tier: 'Mid-range', playStyle: 'All-round' },
} as unknown as CatalogItem;

describe('specCells', () => {
  it('fills the six cells in the design order', () => {
    expect(specCells(AF79)).toEqual([
      { key: 'weight', value: '4U · 5U · 77–84 g' },
      { key: 'balance', value: 'Even' },
      { key: 'shaft', value: 'Medium' },
      { key: 'rated', value: '', bounds: [19, 26] },
      { key: 'grip', value: 'G5 · G6' },
      { key: 'price', value: '$125–$165' },
    ]);
  });

  it('leaves out what the row cannot say, and never invents a printed tension bound', () => {
    const bare = { ...AF79, attributes: { balance: 'Even', flex: 'Medium', tensionMaxLbs: 28 } } as unknown as CatalogItem;
    expect(specCells(bare).map((c) => c.key)).toEqual(['balance', 'shaft', 'rated']);
    expect(specCells(bare)[2].bounds).toEqual([null, 28]);
  });

  it('rounds a CAD range to five dollars and refuses an inverted one', () => {
    expect(cadRange(AF79)).toEqual([125, 165]);
    expect(cadRange({ ...AF79, attributes: { priceMinUSD: 120, priceMaxUSD: 90 } } as unknown as CatalogItem)).toBeNull();
  });
});

describe('closeToFrame', () => {
  const catalog = ((Array.isArray(seed) ? seed : (seed as { items: unknown[] }).items) as CatalogItem[]).filter((r) => r.category === 'racket');

  it('ranks the catalog by the fit engine’s distance, never the frame itself', () => {
    const row = catalog.find((r) => r.id === 'racket-yonex-astrox-88d-pro')!;
    const close = closeToFrame(row, catalog);
    expect(close).toHaveLength(3);
    expect(close.map((c) => c.id)).not.toContain(row.id);
    // The nearest shares the frame's balance: balance weighs the most.
    expect(close[0].attributes?.balance).toBe(row.attributes?.balance);
  });
});

describe('frameHistory', () => {
  const gear = {
    id: 'g', memberId: 'm', updatedAt: '', activeRacketId: 'r1',
    items: [
      { id: 'r1', catalogId: AF79.id, category: 'racket', label: 'AF79' },
      { id: 's1', catalogId: 'bg65', category: 'string', label: 'BG65', tensionLbs: 26 },
    ],
    stringLog: [
      { at: '2026-01-01', catalogId: 'x', racketCatalogId: AF79.id, tensionLbs: 23 },
      { at: '2026-02-01', catalogId: 'x', racketCatalogId: 'other', tensionLbs: 30 },
      { at: '2026-03-01', catalogId: 'x', racketCatalogId: AF79.id, tensionLbs: 24 },
      { at: '2026-04-01', catalogId: 'x', racketCatalogId: AF79.id },
      { at: '2026-05-01', catalogId: 'x', racketCatalogId: AF79.id, tensionLbs: 25 },
      { at: '2026-06-01', catalogId: 'x', racketCatalogId: AF79.id, tensionLbs: 26 },
      { at: '2026-07-01', catalogId: 'x', racketItemId: 'r1', tensionLbs: 26 },
    ],
  } as PlayerGear;

  it('reads restrings for this model only, newest first, and the last four tensions oldest first', () => {
    const h = frameHistory(gear, AF79.id);
    expect(h.inPlay).toBe(true);
    expect(h.restrings).toHaveLength(6);
    expect(h.restrings[0].at).toBe('2026-07-01');
    expect(h.lastFour).toEqual([24, 25, 26, 26]);
    expect(h.currentString?.label).toBe('BG65');
  });

  it('a frame not in the bag has no history and no current string', () => {
    const h = frameHistory(gear, 'racket-nope');
    expect(h).toEqual({ owned: null, inPlay: false, restrings: [], lastFour: [], currentString: null });
  });
});

describe('bandPosition', () => {
  it('maps 20–30 lb onto 0–1 and clamps outside it', () => {
    expect(bandPosition(24)).toBe(0.4);
    expect(bandPosition(26)).toBe(0.6);
    expect(bandPosition(18)).toBe(0);
    expect(bandPosition(33)).toBe(1);
  });
});
