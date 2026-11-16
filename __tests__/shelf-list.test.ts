import { describe, it, expect } from 'vitest';
import { SHELF_PAGE, shelfChips, shelfGroups, shelfStatus, type ShelfEntry } from '@/lib/shelfList';

/**
 * The shelf list's rules (Grant, 2026-11-16, on the canvas): low on stock,
 * out of stock, mismatched on top, then the shelf A–Z, then no stock logged;
 * a search and filters for a large shelf; "Show N more" on the shelf group.
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

  it('pages the shelf group until shown in full, a search or a filter', () => {
    const many = Array.from({ length: SHELF_PAGE + 4 }, (_, i) => e(`String ${i + 1}`, 'shelf'));
    const first = shelfGroups(many);
    expect(first[0].entries).toHaveLength(SHELF_PAGE);
    expect(first[0].hidden).toBe(4);
    expect(shelfGroups(many, { showAll: true })[0].hidden).toBe(0);
    expect(shelfGroups(many, { query: 'string' })[0].entries).toHaveLength(SHELF_PAGE + 4);
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
