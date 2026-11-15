import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  addCustomColours, colourIdOf, comboIdOf, comboParts, customColourError, customIdOf, isReelColourId,
  normaliseColourList, normaliseCustomColours, reelColourEnglish, STRING_PALETTE,
  type CustomColour, type ReelColourId,
} from '@/lib/stringPalette';
import { mergeColours, normaliseColours, readOfferedStringsWithLinks } from '@/lib/stringingStrings';
import { summarizeStringStock, colourStockOf, validatePurchase } from '@/lib/stringStock';
import { clubCombos, makerColourIds, parseShelf, reelColourFill, requestColours, stringColours, type Shelf } from '@/lib/stringShelf';
import { GET as stringsGET, PATCH as stringsPATCH } from '@/app/api/stringing/strings/route';
import { GET as stockGET, POST as stockPOST } from '@/app/api/stringing/stock/route';
import { __resetCatalogSeedForTests } from '@/lib/catalogSeed';
import { resetShelfCache } from '@/lib/stringShelfRead';
import { getContainer } from '@/lib/cosmos';
import type { CatalogItem, StringPurchase, StringingJob } from '@/lib/types';
import {
  resetMockStore, seedDoc, seedMember, makeRequest, makeAdminRequest, memberCookieValue, setupAdminPin, seedTestAdminMember,
} from './helpers';

/**
 * Two-colour sets and a club's own colours as first-class reel colours
 * (docs/plans/string-stock-by-colour.md, Decisions, 2026-11-12; Grant: "two
 * colour combo like aerobites, and custom picker for future").
 *
 *   combo:<mains>+<crosses>   English name "<mains> / <crosses>"
 *   custom:<rrggbb>           named on the club's strings doc
 */

const TEAL: CustomColour = { id: 'custom:14b8a6', name: 'Teal', hex: '#14b8a6' };

describe('the ids', () => {
  it('a set is mains first, two different single colours', () => {
    expect(comboIdOf('red', 'white')).toBe('combo:red+white');
    expect(comboIdOf('red', TEAL.id)).toBe('combo:red+custom:14b8a6');
    expect(comboIdOf('red', 'red')).toBeNull();
    expect(comboIdOf('red', 'combo:red+white')).toBeNull();
    expect(comboParts('combo:red+custom:14b8a6')).toEqual({ mains: 'red', crosses: 'custom:14b8a6' });
    expect(comboParts('combo:red+red')).toBeNull();
    expect(comboParts('combo:red')).toBeNull();
  });

  it('a club colour\'s id is its hex, lowercase, without "#"', () => {
    expect(customIdOf('#14B8A6')).toBe('custom:14b8a6');
    expect(customIdOf('14b8a6')).toBe('custom:14b8a6');
    expect(customIdOf('#14b8a')).toBeNull();
    for (const ok of ['white', 'custom:14b8a6', 'combo:red+white', 'combo:custom:14b8a6+navy']) expect(isReelColourId(ok)).toBe(true);
    for (const bad of ['teal', 'custom:14B8A6', 'custom:xyz123', 'combo:red+teal', 'combo:white+white', 7, null]) expect(isReelColourId(bad)).toBe(false);
  });
});

describe('names, both ways', () => {
  it('maps a set\'s English name back to its id, either spelling, mains first', () => {
    expect(colourIdOf('Red / White')).toBe('combo:red+white');
    expect(colourIdOf('Red/White')).toBe('combo:red+white');
    expect(colourIdOf('  white / RED ')).toBe('combo:white+red');
    expect(colourIdOf('Yellow/Gray')).toBe('combo:yellow+grey');
    expect(colourIdOf('Red / Red')).toBeNull();
    expect(colourIdOf('Red / White / Blue')).toBeNull();
    expect(colourIdOf('Red / Silver')).toBeNull();
  });

  it('finds a club colour by its name, alone or in a set, only with the club\'s list', () => {
    expect(colourIdOf('Teal')).toBeNull();
    expect(colourIdOf('teal', [TEAL])).toBe(TEAL.id);
    expect(colourIdOf('Red / Teal', [TEAL])).toBe('combo:red+custom:14b8a6');
  });

  it('every set and club colour round-trips through the name a job stores', () => {
    const ids: ReelColourId[] = [
      ...STRING_PALETTE,
      TEAL.id,
      'combo:red+white',
      'combo:fluo_yellow+turquoise',
      'combo:custom:14b8a6+navy',
    ];
    for (const id of ids) {
      const name = reelColourEnglish(id, [TEAL]);
      expect(name, id).not.toBeNull();
      expect(colourIdOf(name, [TEAL]), id).toBe(id);
    }
    expect(reelColourEnglish('combo:red+white')).toBe('Red / White');
    // A club colour the club has no name for has no name to send.
    expect(reelColourEnglish(TEAL.id)).toBeNull();
    expect(reelColourEnglish('combo:red+custom:14b8a6')).toBeNull();
  });
});

describe('a club colour: the rules for adding one', () => {
  it('refuses a bad hex, a name too long, a slash, a palette colour\'s name, and a name or colour the club has', () => {
    expect(customColourError([], 'Mint', '#12')).toBe('invalid_hex');
    expect(customColourError([], 'Mint', 'green')).toBe('invalid_hex');
    expect(customColourError([], 'x'.repeat(31), '#123456')).toBe('invalid_colour_name');
    expect(customColourError([], 'x'.repeat(30), '#123456')).toBeNull();
    expect(customColourError([], '   ', '#123456')).toBe('invalid_colour_name');
    expect(customColourError([], 'Sea/Sky', '#123456')).toBe('invalid_colour_name');
    expect(customColourError([], 'navy', '#123456')).toBe('invalid_colour_name');
    expect(customColourError([], 'Gray', '#123456')).toBe('invalid_colour_name');
    expect(customColourError([TEAL], 'TEAL', '#123456')).toBe('colour_name_taken');
    expect(customColourError([TEAL], 'Sea', '#14B8A6')).toBe('colour_taken');
  });

  it('adds all or none, and a colour the club already has (same name and hex) is a no-op', () => {
    expect(addCustomColours([], [{ name: 'Teal', hex: '#14B8A6' }])).toEqual({ ok: true, value: [TEAL] });
    expect(addCustomColours([TEAL], [{ name: 'teal', hex: '#14b8a6' }])).toEqual({ ok: true, value: [TEAL] });
    expect(addCustomColours([], [{ name: 'Mint', hex: '#84cc16' }, { name: 'mint', hex: '#000000' }])).toEqual({ ok: false, error: 'colour_name_taken' });
    expect(addCustomColours([], 'Teal')).toEqual({ ok: false, error: 'invalid_colour_name' });
    const many = Array.from({ length: 24 }, (_, i) => ({ name: `C${i}`, hex: `#0000${i.toString(16).padStart(2, '0')}` }));
    const full = addCustomColours([], many);
    expect(full.ok && full.value).toHaveLength(24);
    expect(addCustomColours(full.ok ? full.value : [], [{ name: 'One more', hex: '#abcdef' }])).toEqual({ ok: false, error: 'too_many_colours' });
  });

  it('reads a stored list defensively: an id that is not its hex, or a repeat, is dropped', () => {
    expect(normaliseCustomColours([
      TEAL,
      { id: 'custom:000000', name: 'Liar', hex: '#ffffff' },
      { id: 'custom:84cc16', name: 'teal', hex: '#84cc16' },
      { id: 'custom:84cc16', name: '  Mint ', hex: '#84CC16' },
      'junk',
    ])).toEqual([TEAL, { id: 'custom:84cc16', name: 'Mint', hex: '#84cc16' }]);
    expect(normaliseCustomColours(undefined)).toEqual([]);
  });
});

describe('the reel lists', () => {
  it('keep palette colours in palette order, then sets and club colours as sent', () => {
    expect(normaliseColourList(['combo:red+white', 'yellow', TEAL.id, 'white', 'combo:red+white'])).toEqual(['white', 'yellow', 'combo:red+white', TEAL.id]);
  });

  it('on the server, a club colour (alone or in a set) the club has not defined is dropped', () => {
    const ids = new Set([TEAL.id]);
    expect(normaliseColourList([TEAL.id, 'custom:84cc16', 'combo:red+custom:84cc16', 'combo:red+custom:14b8a6'], ids)).toEqual([TEAL.id, 'combo:red+custom:14b8a6']);
    expect(normaliseColours({ A: [TEAL.id, 'red'] }, ['A'])).toEqual({ A: ['red'] });
    expect(normaliseColours({ A: [TEAL.id, 'red'] }, ['A'], [TEAL])).toEqual({ A: ['red', TEAL.id] });
  });

  it('mergeColours takes sets and the club\'s colours', () => {
    expect(mergeColours({ A: ['white'] }, { B: ['combo:red+white', TEAL.id, 'custom:84cc16'] }, ['A', 'B'], [TEAL]))
      .toEqual({ A: ['white'], B: ['combo:red+white', TEAL.id] });
  });

  it('the club\'s sets are every set on any string, once', () => {
    expect(clubCombos({ A: ['white', 'combo:red+white'], B: ['combo:red+white', 'combo:blue+yellow'] })).toEqual(['combo:red+white', 'combo:blue+yellow']);
  });
});

describe('the maker\'s colours and the swatches', () => {
  const aerobite = { id: 'string-yx-aerobite', category: 'string', brand: 'Yonex', model: 'Aerobite', skillRange: [1, 3], attributes: { colors: 'Red/White' } } as CatalogItem;
  const boost = { ...aerobite, id: 'string-yx-boost', model: 'Aerobite Boost', attributes: { colors: 'Yellow/Grey' } } as CatalogItem;

  it('reads the catalog\'s "A/B" as ONE set with A the mains, never as two colours', () => {
    expect(makerColourIds(aerobite)).toEqual(['combo:red+white']);
    expect(makerColourIds(boost)).toEqual(['combo:yellow+grey']);
    expect(makerColourIds({ ...aerobite, attributes: { colors: 'White; Red/White; Silver' } } as CatalogItem)).toEqual(['white', 'combo:red+white']);
  });

  it('draws a set split down the middle, mains on the left, and a club colour from its hex', () => {
    expect(reelColourFill('combo:red+white')).toBe(`linear-gradient(90deg, ${reelColourFill('red')} 50%, ${reelColourFill('white')} 50%)`);
    expect(reelColourFill(TEAL.id)).toBe('#14b8a6');
    expect(reelColourFill('nonsense')).toBe('var(--text-muted)');
    // The maker's two-tone draws the same way the picker does.
    expect(stringColours(boost)[0].fill).toBe(reelColourFill('combo:yellow+grey'));
  });
});

describe('what the request sheet offers', () => {
  const base: Shelf = { strings: ['Aerobite'], links: {}, prices: {}, stock: {}, players: {}, colours: {}, colourStock: {}, notes: {}, customColours: [] };
  const aerobite = { id: 'string-yx-aerobite', category: 'string', brand: 'Yonex', model: 'Aerobite', skillRange: [1, 3], attributes: { colors: 'Red/White' } } as CatalogItem;

  it('offers a set by its English name, and a club colour by the name it was given', () => {
    const shelf = { ...base, colours: { Aerobite: ['combo:red+white', TEAL.id] as ReelColourId[] }, customColours: [TEAL] };
    expect(requestColours(shelf, 'Aerobite', aerobite).map((c) => [c.id, c.name])).toEqual([['combo:red+white', 'Red / White'], [TEAL.id, 'Teal']]);
  });

  it('turns the maker\'s two-tone into its set when the stringer said nothing', () => {
    expect(requestColours(base, 'Aerobite', aerobite).map((c) => [c.id, c.name])).toEqual([['combo:red+white', 'Red / White']]);
  });

  it('reads the club\'s colours off the public payload, and drops a reel colour the club no longer names', () => {
    const s = parseShelf({ strings: ['A'], colours: { A: ['red', TEAL.id, 'custom:84cc16'] }, customColours: [TEAL] });
    expect(s?.colours).toEqual({ A: ['red', TEAL.id] });
    expect(s?.customColours).toEqual([TEAL]);
  });
});

describe('stock per colour, for a set and a club colour', () => {
  const item = { id: 'string-yx-aerobite', category: 'string', brand: 'Yonex', model: 'Aerobite', skillRange: [1, 3], attributes: { setLengthM: 10 } } as CatalogItem;
  const purchase = (id: string, color?: string): StringPurchase => ({
    id, kind: 'stringPurchase', label: 'Aerobite', unit: 'set', units: 2, metresPerUnit: 10, totalCostCents: 4000,
    date: '2026-11-01', createdAt: '2026-11-01T00:00:00Z', createdBy: 'a', ...(color ? { color } : {}),
  });
  const job = (stringColor?: string) => ({ stringLabel: 'Aerobite', status: 'strung' as const, archivedAt: undefined, stringColor });

  it('a strung "Red / White" job draws from the set\'s pool, and "Teal" from the club colour\'s', () => {
    const line = summarizeStringStock({
      offered: ['Aerobite'], links: { Aerobite: item.id }, catalog: new Map([[item.id, item]]), customColours: [TEAL],
      purchases: [purchase('sp-1', 'combo:red+white'), purchase('sp-2', TEAL.id), purchase('sp-3', 'white')],
      jobs: [job('Red / White'), job('Red/White'), job('Teal'), job('White / Red')],
    }).lines[0];
    expect(line.byColour).toEqual([
      { color: 'white', purchasedMetres: 20, usedSets: 0, remainingSets: 2 },
      { color: 'combo:red+white', purchasedMetres: 20, usedSets: 2, remainingSets: 0 },
      { color: TEAL.id, purchasedMetres: 20, usedSets: 1, remainingSets: 1 },
    ]);
    // "White / Red" is the OTHER way round: no pool was bought for it, so it counts as mixed.
    expect(line.usedSets).toBe(4);
    expect(colourStockOf(line)).toEqual({ inStock: ['white', TEAL.id], mixed: false });
  });

  it('a purchase keeps a set or a club colour as its colour', () => {
    const base = { label: 'Aerobite', unit: 'set', units: 1, metresPerUnit: 10, totalCostCents: 1000, date: '2026-11-12' };
    expect(validatePurchase({ ...base, color: 'combo:red+white' })).toMatchObject({ color: 'combo:red+white' });
    expect(validatePurchase({ ...base, color: TEAL.id })).toMatchObject({ color: TEAL.id });
    expect(validatePurchase({ ...base, color: 'combo:red+red' })).not.toHaveProperty('color');
  });
});

describe('the strings route', () => {
  const URL = 'http://x/api/stringing/strings';
  const as = (name: string, overrides: Record<string, unknown> = {}) => {
    const m = seedMember(name, overrides);
    return { Cookie: `member_session=${memberCookieValue(name, m.id)}` };
  };
  const adminPatch = (body: Record<string, unknown>) => stringsPATCH(makeAdminRequest('PATCH', URL, body));

  beforeEach(async () => {
    resetMockStore();
    resetShelfCache();
    __resetCatalogSeedForTests();
    setupAdminPin();
    await seedTestAdminMember();
    process.env.NEXT_PUBLIC_FLAG_STRINGING = 'true';
    await adminPatch({ strings: ['BG80', 'Aerobite'], colours: { BG80: ['white'] } });
  });
  afterEach(() => {
    delete process.env.NEXT_PUBLIC_FLAG_STRINGING;
  });

  it('an old doc with no club colours reads exactly as before, and a save does not add the field', async () => {
    const body = await (await stringsGET(makeAdminRequest('GET', URL))).json();
    expect(body.customColours).toEqual([]);
    expect(body.colours).toEqual({ BG80: ['white'] });
    const { resources } = await getContainer('clubSettings').items.query({ query: 'SELECT * FROM c' }).fetchAll();
    const doc = resources.find((d: { id: string }) => d.id === 'stringing-strings');
    expect(doc).not.toHaveProperty('customColours');
  });

  it('an admin adds a club colour and picks it, and a set, in ONE save; every reader gets its name', async () => {
    const res = await adminPatch({
      strings: ['BG80', 'Aerobite'],
      colours: { BG80: ['white', TEAL.id], Aerobite: ['combo:red+white', 'combo:red+custom:14b8a6'] },
      addColours: [{ name: 'Teal', hex: '#14B8A6' }],
    });
    expect(res.status).toBe(200);
    const saved = await res.json();
    expect(saved.customColours).toEqual([TEAL]);
    expect(saved.colours).toEqual({ BG80: ['white', TEAL.id], Aerobite: ['combo:red+white', 'combo:red+custom:14b8a6'] });
    const lin = as('Lin');
    const read = await (await stringsGET(makeRequest('GET', URL, undefined, lin))).json();
    expect(read.customColours).toEqual([TEAL]);
    expect(read.colours.Aerobite).toEqual(['combo:red+white', 'combo:red+custom:14b8a6']);
    // Club-wide: the colours-only shape can pick it for another string later.
    const more = await adminPatch({ colours: { Aerobite: [TEAL.id] } });
    expect((await more.json()).colours.Aerobite).toEqual([TEAL.id]);
    const stored = await readOfferedStringsWithLinks('bpm');
    expect(stored?.customColours).toEqual([TEAL]);
  });

  it('a colour list naming a club colour nobody defined drops it', async () => {
    const res = await adminPatch({ colours: { BG80: ['white', 'custom:84cc16', 'combo:red+white'] } });
    expect((await res.json()).colours.BG80).toEqual(['white', 'combo:red+white']);
  });

  it('refuses a bad club colour, all or none, with nothing written', async () => {
    const cases: Array<[unknown, number, string]> = [
      [[{ name: 'Mint', hex: '#12' }], 400, 'invalid_hex'],
      [[{ name: 'x'.repeat(31), hex: '#123456' }], 400, 'invalid_colour_name'],
      [[{ name: 'Navy', hex: '#123456' }], 400, 'invalid_colour_name'],
      [[{ name: 'Mint', hex: '#84cc16' }, { name: 'MINT', hex: '#123456' }], 409, 'colour_name_taken'],
    ];
    for (const [addColours, status, error] of cases) {
      const res = await adminPatch({ colours: { BG80: ['custom:84cc16'] }, addColours });
      expect(res.status, error).toBe(status);
      expect(await res.json()).toEqual({ error });
    }
    await adminPatch({ strings: ['BG80', 'Aerobite'], addColours: [TEAL] });
    const dup = await adminPatch({ colours: { BG80: ['white'] }, addColours: [{ name: 'Sea', hex: '#14b8a6' }] });
    expect(dup.status).toBe(409);
    expect(await dup.json()).toEqual({ error: 'colour_taken' });
    expect((await readOfferedStringsWithLinks('bpm'))?.customColours).toEqual([TEAL]);
  });

  it('a stringer may pick a set and the club\'s colours, but may not add one', async () => {
    await adminPatch({ strings: ['BG80', 'Aerobite'], addColours: [TEAL] });
    const zach = as('Zach', { canString: true });
    const refused = await stringsPATCH(makeRequest('PATCH', URL, { colours: { BG80: ['custom:84cc16'] }, addColours: [{ name: 'Mint', hex: '#84cc16' }] }, zach));
    expect(refused.status).toBe(403);
    expect(await refused.json()).toEqual({ error: 'forbidden_field' });
    const ok = await stringsPATCH(makeRequest('PATCH', URL, { colours: { Aerobite: ['combo:red+white', TEAL.id, 'custom:84cc16'] } }, zach));
    expect(ok.status).toBe(200);
    const body = await ok.json();
    expect(body).toEqual({ strings: ['BG80', 'Aerobite'], colours: { BG80: ['white'], Aerobite: ['combo:red+white', TEAL.id] }, customColours: [TEAL] });
  });

  it('a rename keeps the club\'s colours', async () => {
    await adminPatch({ strings: ['BG80', 'Aerobite'], colours: { BG80: [TEAL.id] }, addColours: [TEAL] });
    const res = await adminPatch({ rename: { from: 'BG80', to: 'BG80 teal' } });
    const body = await res.json();
    expect(body.customColours).toEqual([TEAL]);
    expect(body.colours).toEqual({ 'BG80 teal': [TEAL.id] });
  });

  it('the stock read counts a set\'s purchase and its strung job, and says which are left', async () => {
    await adminPatch({ strings: ['BG80', 'Aerobite'], addColours: [TEAL] });
    for (const color of ['combo:red+white', TEAL.id]) {
      const post = await stockPOST(makeAdminRequest('POST', 'http://x/api/stringing/stock', {
        label: 'Aerobite', unit: 'set', units: 1, metresPerUnit: 10, totalCostCents: 2000, date: '2026-11-12', color,
      }));
      expect(post.status).toBe(201);
    }
    const lin = seedMember('Lin');
    seedDoc('stringingJobs', { id: 'j1', groupId: 'bpm', memberId: lin.id, stringLabel: 'Aerobite', stringColor: 'Red / White', status: 'strung' } as Partial<StringingJob>);
    resetShelfCache();
    const stock = await (await stockGET(makeAdminRequest('GET', 'http://x/api/stringing/stock'))).json();
    const line = stock.lines.find((l: { label: string }) => l.label === 'Aerobite');
    expect(line.byColour).toEqual([
      { color: 'combo:red+white', purchasedMetres: 10, usedSets: 1, remainingSets: 0 },
      { color: TEAL.id, purchasedMetres: 10, usedSets: 0, remainingSets: 1 },
    ]);
    const shelf = await (await stringsGET(makeAdminRequest('GET', URL))).json();
    expect(shelf.colourStock).toEqual({ Aerobite: { inStock: [TEAL.id], mixed: false } });
  });
});
