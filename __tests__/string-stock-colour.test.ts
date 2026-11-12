import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { summarizeStringStock, validatePurchase, colourStockOf } from '@/lib/stringStock';
import { colourIdOf, PALETTE_EN, STRING_PALETTE } from '@/lib/stringPalette';
import { parseShelf, requestColours, type Shelf } from '@/lib/stringShelf';
import { GET as stockGET, POST as stockPOST } from '@/app/api/stringing/stock/route';
import { GET as stringsGET, PATCH as stringsPATCH } from '@/app/api/stringing/strings/route';
import { __resetCatalogSeedForTests } from '@/lib/catalogSeed';
import { resetShelfCache } from '@/lib/stringShelfRead';
import type { CatalogItem, StringPurchase, StringingJob } from '@/lib/types';
import { resetMockStore, seedDoc, seedMember, makeAdminRequest, setupAdminPin, seedTestAdminMember } from './helpers';

/**
 * String stock by colour (docs/plans/string-stock-by-colour.md). Grant,
 * 2026-11-11, on the request sheet's colour chips: "this need to match and be
 * dynamic to the strings inventory and string type".
 */

const BASE = 'http://localhost:3000/api';
const bg80: CatalogItem = {
  id: 'string-yx-bg80', category: 'string', brand: 'Yonex', model: 'BG80', skillRange: [1, 3],
  attributes: { gaugeMm: 0.68, setLengthM: 10, reelLengthM: 200, colors: 'White; Blue; Yellow; Red' },
} as CatalogItem;
const purchase = (over: Partial<StringPurchase>): StringPurchase => ({
  id: `sp-${Math.random().toString(16).slice(2, 18).padEnd(16, '0')}`, kind: 'stringPurchase', label: 'BG80',
  unit: 'set', units: 2, metresPerUnit: 10, totalCostCents: 2000, date: '2026-11-01', createdAt: '2026-11-01T00:00:00Z', createdBy: 'a', ...over,
});
const job = (stringColor?: string, status: StringingJob['status'] = 'strung') => ({ stringLabel: 'BG80', status, archivedAt: undefined, stringColor });
const summarize = (purchases: StringPurchase[], jobs: ReturnType<typeof job>[]) =>
  summarizeStringStock({ offered: ['BG80'], links: { BG80: bg80.id }, purchases, jobs, catalog: new Map([[bg80.id, bg80]]) }).lines[0];

describe('colourIdOf', () => {
  it('maps every palette English name, the catalog spellings and the id itself back to the id', () => {
    for (const id of STRING_PALETTE) {
      expect(colourIdOf(PALETTE_EN[id])).toBe(id);
      expect(colourIdOf(id)).toBe(id);
    }
    expect(colourIdOf('  fluorescent YELLOW ')).toBe('fluo_yellow');
    expect(colourIdOf('Gray')).toBe('grey');
    // A two-tone is no one palette colour; it counts in the mixed pool.
    expect(colourIdOf('White/Yellow')).toBeNull();
    expect(colourIdOf(undefined)).toBeNull();
  });
});

describe('summarizeStringStock, per colour', () => {
  it('counts each tagged colour on its own and a job against its colour', () => {
    const line = summarize(
      [purchase({ color: 'white', units: 3 }), purchase({ color: 'yellow', units: 1 })],
      [job('White'), job('white'), job('Yellow'), job('White', 'requested')],
    );
    expect(line.byColour).toEqual([
      { color: 'white', purchasedMetres: 30, usedSets: 2, remainingSets: 1 },
      { color: 'yellow', purchasedMetres: 10, usedSets: 1, remainingSets: 0 },
    ]);
    // The line's own total is unchanged by colours: 40 m, 3 sets in.
    expect(line).toMatchObject({ purchasedMetres: 40, usedSets: 3, remainingSets: 1, mixedRemainingSets: 0 });
    expect(colourStockOf(line)).toEqual({ inStock: ['white'], mixed: false });
  });

  it('puts untagged purchases, and jobs in a colour nobody tagged, in the mixed pool', () => {
    const line = summarize(
      [purchase({ color: 'white', units: 1 }), purchase({ units: 3 })],
      [job('Blue'), job(undefined), job('White/Yellow')],
    );
    expect(line.byColour).toEqual([{ color: 'white', purchasedMetres: 10, usedSets: 0, remainingSets: 1 }]);
    expect(line.mixedRemainingSets).toBe(0);
    expect(colourStockOf(line)).toEqual({ inStock: ['white'], mixed: false });
    const more = summarize([purchase({ color: 'white', units: 1 }), purchase({ units: 4 })], [job('Blue')]);
    expect(colourStockOf(more)).toEqual({ inStock: ['white'], mixed: true });
  });

  it('a colour that runs dry never borrows from another, and never goes below zero', () => {
    const line = summarize([purchase({ color: 'red', units: 1 }), purchase({ color: 'white', units: 2 })], [job('Red'), job('Red'), job('Red')]);
    expect(line.byColour.find((c) => c.color === 'red')).toMatchObject({ usedSets: 3, remainingSets: 0 });
    expect(line.byColour.find((c) => c.color === 'white')).toMatchObject({ usedSets: 0, remainingSets: 2 });
  });

  it('knows nothing per colour while no purchase carries one', () => {
    const line = summarize([purchase({})], [job('White')]);
    expect(line.byColour).toEqual([]);
    expect(line.mixedRemainingSets).toBe(1);
    expect(colourStockOf(line)).toBeNull();
  });
});

describe('validatePurchase, colour', () => {
  const base = { label: 'BG80', unit: 'reel', units: 1, metresPerUnit: 200, totalCostCents: 9000, date: '2026-11-11' };
  it('keeps a palette id and drops anything else as "Mixed / not sure"', () => {
    expect(validatePurchase({ ...base, color: 'yellow' }).color).toBe('yellow');
    expect(validatePurchase({ ...base, color: 'Yellow' })).not.toHaveProperty('color');
    expect(validatePurchase({ ...base, color: 'mixed' })).not.toHaveProperty('color');
    expect(validatePurchase(base)).not.toHaveProperty('color');
  });
});

describe('requestColours (what the request sheet offers)', () => {
  const shelf = (over: Partial<Shelf>): Shelf => ({ strings: ['BG80'], links: { BG80: bg80.id }, prices: {}, stock: {}, players: {}, colours: {}, colourStock: {}, notes: {}, ...over });
  const names = (s: Shelf | null) => requestColours(s, 'BG80', bg80).map((c) => c.name);

  it('falls back to the maker\'s colours when nothing is tagged and the stringer said none', () => {
    expect(names(shelf({}))).toEqual(['White', 'Blue', 'Yellow', 'Red']);
    expect(names(null)).toEqual(['White', 'Blue', 'Yellow', 'Red']);
  });

  it('takes the stringer\'s reel colours over the maker\'s', () => {
    expect(names(shelf({ colours: { BG80: ['white', 'navy'] } }))).toEqual(['White', 'Navy']);
  });

  it('offers only the tagged colours with stock, hiding the rest', () => {
    expect(names(shelf({ colourStock: { BG80: { inStock: ['white'], mixed: false } } }))).toEqual(['White']);
  });

  it('adds the base list while untagged stock is left, without repeating a colour', () => {
    expect(names(shelf({ colours: { BG80: ['white', 'yellow'] }, colourStock: { BG80: { inStock: ['white'], mixed: true } } }))).toEqual(['White', 'Yellow']);
  });

  it('offers nothing when every tagged colour is gone and nothing untagged is left', () => {
    expect(names(shelf({ colourStock: { BG80: { inStock: [], mixed: false } } }))).toEqual([]);
  });

  it('parseShelf reads colourStock and drops what is not a palette id', () => {
    const s = parseShelf({ strings: ['BG80'], colourStock: { BG80: { inStock: ['white', 'teal', 7], mixed: true }, X: 'junk' } });
    expect(s?.colourStock).toEqual({ BG80: { inStock: ['white'], mixed: true } });
    expect(parseShelf({ strings: ['BG80'] })?.colourStock).toEqual({});
  });
});

describe('the routes', () => {
  beforeEach(async () => {
    resetMockStore();
    __resetCatalogSeedForTests();
    resetShelfCache();
    await setupAdminPin();
    await seedTestAdminMember();
    process.env.NEXT_PUBLIC_FLAG_STRINGING = 'true';
  });
  afterEach(() => {
    delete process.env.NEXT_PUBLIC_FLAG_STRINGING;
  });

  it('a purchase saves its colour, and the shelf read says which colours are left, never how many', async () => {
    await stringsPATCH(makeAdminRequest('PATCH', `${BASE}/stringing/strings`, { strings: ['BG80'] }));
    const post = await stockPOST(makeAdminRequest('POST', `${BASE}/stringing/stock`, {
      label: 'BG80', unit: 'set', units: 2, metresPerUnit: 10, totalCostCents: 2000, date: '2026-11-10', color: 'yellow',
    }));
    expect(post.status).toBe(201);
    expect((await post.json()).purchase).toMatchObject({ color: 'yellow' });
    const lin = seedMember('Lin');
    seedDoc('stringingJobs', { id: 'j1', groupId: 'bpm', memberId: lin.id, stringLabel: 'BG80', stringColor: 'Yellow', status: 'strung' });
    resetShelfCache();

    const stock = await (await stockGET(makeAdminRequest('GET', `${BASE}/stringing/stock`))).json();
    expect(stock.lines[0].byColour).toEqual([{ color: 'yellow', purchasedMetres: 20, usedSets: 1, remainingSets: 1 }]);

    const shelf = await (await stringsGET(makeAdminRequest('GET', `${BASE}/stringing/strings`))).json();
    expect(shelf.colourStock).toEqual({ BG80: { inStock: ['yellow'], mixed: false } });
  });
});
