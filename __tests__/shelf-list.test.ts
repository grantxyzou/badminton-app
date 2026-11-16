import { describe, it, expect } from 'vitest';
import { FOLDED_BY_DEFAULT, shelfChips, shelfGroups, shelfStatus, type ShelfEntry } from '@/lib/shelfList';

/**
 * The shelf list's rules (Grant, 2026-11-16, on the canvas): low on stock,
 * out of stock, mismatched on top, then the shelf A–Z, then no stock logged;
 * a search and filters for a large shelf; the groups that need nobody folded
 * until opened, searched or filtered (canvas v3).
 */

const e = (label: string, status: ShelfEntry['status'], brand: string | null = 'Yonex'): ShelfEntry => ({ label, brand, status });

describe('shelfStatus', () => {
  const base = { hasStock: true, remainingSets: 10, overdrawnSets: 0, low: false, reorder: null } as const;
  it('reads each case', () => {
    expect(shelfStatus({ ...base, hasStock: false })).toBe('none');
    expect(shelfStatus({ ...base, remainingSets: 0, overdrawnSets: 3 })).toBe('mismatched');
    expect(shelfStatus({ ...base, remainingSets: 0 })).toBe('out');
    expect(shelfStatus({ ...base, remainingSets: 3, low: true })).toBe('low');
    expect(shelfStatus({ ...base, reorder: 'soon' })).toBe('low');
    expect(shelfStatus({ ...base, reorder: 'ok' })).toBe('shelf');
  });
});

describe('shelfGroups', () => {
  const shelf = [
    e('BG80', 'shelf'), e('Exbolt 63', 'low'), e('Aerobite', 'mismatched'), e('VBS-63', 'out', 'Victor'),
    e('aerosonic', 'shelf'), e('House string', 'none', null),
  ];

  it('orders the groups and sorts each A–Z, any case', () => {
    expect(shelfGroups(shelf).map((g) => [g.status, g.entries.map((x) => x.label)])).toEqual([
      ['low', ['Exbolt 63']], ['out', ['VBS-63']], ['mismatched', ['Aerobite']], ['shelf', ['aerosonic', 'BG80']], ['none', ['House string']],
    ]);
  });

  it('folds the groups that need nobody, and a search or a filter opens them', () => {
    const many = Array.from({ length: 12 }, (_, i) => e(`String ${i + 1}`, 'shelf')).concat([e('Exbolt 63', 'low'), e('House string', 'none', null)]);
    const first = shelfGroups(many, { folded: FOLDED_BY_DEFAULT });
    expect(first.map((g) => [g.status, g.folded, g.count, g.entries.length])).toEqual([
      ['low', false, 1, 1], ['shelf', true, 12, 0], ['none', true, 1, 0],
    ]);
    expect(shelfGroups(many).every((g) => !g.folded)).toBe(true);
    const searched = shelfGroups(many, { folded: FOLDED_BY_DEFAULT, query: 'string 1' });
    expect(searched.map((g) => [g.status, g.folded, g.entries.length])).toEqual([['shelf', false, 4]]);
    const filtered = shelfGroups(many, { folded: FOLDED_BY_DEFAULT, filter: { kind: 'other' } });
    expect(filtered.map((g) => [g.status, g.folded, g.entries.length])).toEqual([['none', false, 1]]);
  });

  it('searches by name and filters by status, brand or not-in-the-catalog', () => {
    expect(shelfGroups(shelf, { query: 'bg' }).flatMap((g) => g.entries.map((x) => x.label))).toEqual(['BG80']);
    expect(shelfGroups(shelf, { filter: { kind: 'brand', brand: 'Victor' } }).flatMap((g) => g.entries.map((x) => x.label))).toEqual(['VBS-63']);
    expect(shelfGroups(shelf, { filter: { kind: 'other' } }).flatMap((g) => g.entries.map((x) => x.label))).toEqual(['House string']);
    expect(shelfGroups(shelf, { filter: { kind: 'status', status: 'low' } }).map((g) => g.status)).toEqual(['low']);
  });

  it('chips: All, the statuses that have strings, brands A–Z, then not in the catalog', () => {
    expect(shelfChips(shelf).map((c) => [c.id, c.count])).toEqual([
      ['all', 6], ['status:low', 1], ['status:out', 1], ['status:mismatched', 1], ['brand:Victor', 1], ['brand:Yonex', 4], ['other', 1],
    ]);
  });
});
