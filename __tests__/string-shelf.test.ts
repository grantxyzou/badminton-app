import { describe, it, expect } from 'vitest';
import { stockBand, LOW_STOCK_SETS } from '../lib/stringStockMath';
import { normalisePrices } from '../lib/stringingStrings';
import { parseShelf, shelfPrice, sortShelf, stringColours, typeBand, type ShelfEntry } from '../lib/stringShelf';
import type { CatalogItem } from '../lib/types';

/**
 * The strings shelf's pure parts (docs/design/strings-shelf-spec.md): the
 * stock band a player sees, the price map the stringer saves, and how the
 * client reads and orders what the API sends.
 */

const item = (id: string, attributes: Record<string, string | number>): CatalogItem =>
  ({ id, category: 'string', brand: 'Yonex', model: id, attributes } as unknown as CatalogItem);

describe('stockBand', () => {
  it('is unknown, never "out", until a purchase is logged', () => {
    expect(stockBand({ purchases: 0, remainingSets: 0 })).toBeNull();
  });
  it('reads out at zero sets, low up to the threshold, in above it', () => {
    expect(LOW_STOCK_SETS).toBe(3);
    expect(stockBand({ purchases: 1, remainingSets: 0 })).toBe('out');
    expect(stockBand({ purchases: 1, remainingSets: 1 })).toBe('low');
    expect(stockBand({ purchases: 1, remainingSets: 3 })).toBe('low');
    expect(stockBand({ purchases: 1, remainingSets: 4 })).toBe('in');
  });
});

describe('normalisePrices', () => {
  const strings = ['BG80', 'BG66'];
  it('keeps whole cents in range and null ("Ask")', () => {
    expect(normalisePrices({ BG80: 3200, BG66: null }, strings)).toEqual({ BG80: 3200, BG66: null });
  });
  it('drops unknown labels, floats, negatives and values over the cap', () => {
    expect(normalisePrices({ Other: 100, BG80: 32.5, BG66: -1 }, strings)).toEqual({});
    expect(normalisePrices({ BG80: 100001 }, strings)).toEqual({});
    expect(normalisePrices({ BG80: '3200' }, strings)).toEqual({});
  });
  it('treats a non-object as no prices', () => {
    expect(normalisePrices(null, strings)).toEqual({});
    expect(normalisePrices([1, 2], strings)).toEqual({});
  });
});

describe('parseShelf', () => {
  it('is null when the list is unknown', () => {
    expect(parseShelf({ strings: null, links: null, prices: null, stock: null, players: null })).toBeNull();
    expect(parseShelf(null)).toBeNull();
  });
  it('keeps a failed stock read as null, distinct from "nothing known"', () => {
    expect(parseShelf({ strings: ['A'], stock: null })!.stock).toBeNull();
    expect(parseShelf({ strings: ['A'], stock: {} })!.stock).toEqual({});
  });
  it('drops values of the wrong shape', () => {
    const s = parseShelf({ strings: ['A', 3], links: { A: 'string-a', B: 4 }, prices: { A: '3', B: null }, stock: { A: 'lots', B: 'low' }, players: { A: '8' } })!;
    expect(s).toEqual({ strings: ['A'], links: { A: 'string-a' }, prices: { B: null }, stock: { B: 'low' }, players: {} });
  });
  it('tells "Ask" from "no price set"', () => {
    const s = parseShelf({ strings: ['A', 'B', 'C'], prices: { A: 3200, B: null } })!;
    expect(shelfPrice(s, 'A')).toBe('$32');
    expect(shelfPrice(s, 'B')).toBeNull();
    expect(shelfPrice(s, 'C')).toBeUndefined();
  });
});

describe('sortShelf', () => {
  it('sorts by power, then durability, then label; unrated next; unknown last', () => {
    const entries: ShelfEntry[] = [
      { label: 'House', item: null },
      { label: 'Unrated', item: item('u', { gaugeMm: 0.7 }) },
      { label: 'B', item: item('b', { repulsion: 8, durability: 6 }) },
      { label: 'A', item: item('a', { repulsion: 8, durability: 6 }) },
      { label: 'Tough', item: item('t', { repulsion: 8, durability: 9 }) },
      { label: 'Fast', item: item('f', { repulsion: 10, durability: 4 }) },
    ];
    expect(sortShelf(entries).map((e) => e.label)).toEqual(['Fast', 'Tough', 'A', 'B', 'Unrated', 'House']);
  });
});

describe('stringColours', () => {
  it('splits on ";" and draws a "/" name half-and-half', () => {
    const c = stringColours(item('x', { colors: 'White; Orange ;White/Yellow' }));
    expect(c.map((x) => x.name)).toEqual(['White', 'Orange', 'White/Yellow']);
    expect(c[0].fill).toBe('#f1f5f9');
    expect(c[2].fill).toBe('linear-gradient(90deg, #f1f5f9 50%, #facc15 50%)');
  });
  it('gives an unknown colour the muted token', () => {
    expect(stringColours(item('x', { colors: 'Teal' }))[0].fill).toBe('var(--text-muted)');
  });
  it('is empty without the attribute', () => {
    expect(stringColours(item('x', {}))).toEqual([]);
    expect(stringColours(null)).toEqual([]);
  });
});

describe('typeBand', () => {
  it('tints by type and falls back to the neutral fill', () => {
    expect(typeBand('hybrid')).toContain('#c4b5fd');
    expect(typeBand('all_round')).toBe('var(--inner-card-bg)');
    expect(typeBand(null)).toBe('var(--inner-card-bg)');
  });
});
