import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GET, PATCH } from '../app/api/stringing/strings/route';
import { POST as stockPOST } from '../app/api/stringing/stock/route';
import { normaliseOfferedStrings, MAX_OFFERED } from '../lib/stringingStrings';
import { resetShelfCache } from '../lib/stringShelfRead';
import { __resetCatalogSeedForTests } from '../lib/catalogSeed';
import {
  resetMockStore,
  setupAdminPin,
  seedTestAdminMember,
  seedDoc,
  seedMember,
  makeRequest,
  makeAdminRequest,
  memberCookieValue,
} from './helpers';

/**
 * The list of strings the club stocks.
 *
 * It exists so the player-side field can be a DROPDOWN. Free text produces
 * "bg80", "BG-80", "Bg 80 white" and "yonex 80" for one spool, and the person
 * who reconciles that is the stringer.
 */
const FLAG = 'NEXT_PUBLIC_FLAG_STRINGING';
const flagBefore = process.env[FLAG];

beforeEach(async () => {
  resetMockStore();
  resetShelfCache();
  __resetCatalogSeedForTests();
  setupAdminPin();
  await seedTestAdminMember();
  process.env[FLAG] = 'true';
});
afterEach(() => {
  if (flagBefore === undefined) delete process.env[FLAG];
  else process.env[FLAG] = flagBefore;
});

describe('who can read and who can write', () => {
  it('lets an anonymous visitor read the list', async () => {
    // The request form is the entire audience. Which strings a badminton club
    // keeps on the shelf is not a secret.
    const res = await GET(makeRequest('GET', 'http://x/api/stringing/strings'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ strings: [], links: {}, prices: {}, stock: {}, players: {} });
  });

  it('returns the list and its per-label maps — no author, no timestamps', async () => {
    await PATCH(
      makeAdminRequest('PATCH', 'http://x/api/stringing/strings', { strings: ['BG80'] }),
    );
    const body = await (await GET(makeRequest('GET', 'http://x/api/stringing/strings'))).json();
    expect(Object.keys(body)).toEqual(['strings', 'links', 'prices', 'stock', 'players']);
  });

  it('refuses a player trying to set it', async () => {
    const res = await PATCH(
      makeRequest('PATCH', 'http://x/api/stringing/strings', { strings: ['X'] }, {
        Cookie: `member_session=${memberCookieValue('wei')}`,
      }),
    );
    expect(res.status).toBe(401);
  });

  it('round-trips an admin write', async () => {
    await PATCH(
      makeAdminRequest('PATCH', 'http://x/api/stringing/strings', {
        strings: ['BG80 white', 'Aerobite'],
      }),
    );
    const body = await (await GET(makeRequest('GET', 'http://x/api/stringing/strings'))).json();
    expect(body.strings).toEqual(['BG80 white', 'Aerobite']);
  });
});

describe('normalising what the stringer typed', () => {
  it('keeps the FIRST spelling when the same string is entered twice', () => {
    // Their capitalisation is what ends up on the shelf label, so it is the
    // one worth preserving.
    expect(normaliseOfferedStrings(['BG80 White', 'bg80 white', 'Aerobite'])).toEqual([
      'BG80 White',
      'Aerobite',
    ]);
  });

  it('trims and drops blanks rather than storing them', () => {
    expect(normaliseOfferedStrings(['  BG80  ', '', '   ', 'NBG95'])).toEqual(['BG80', 'NBG95']);
  });

  it('rejects a list that is not strings, or is absurdly long', () => {
    expect(normaliseOfferedStrings('BG80')).toBeNull();
    expect(normaliseOfferedStrings([1, 2])).toBeNull();
    expect(normaliseOfferedStrings(new Array(MAX_OFFERED + 1).fill('x'))).toBeNull();
    expect(normaliseOfferedStrings(['x'.repeat(61)])).toBeNull();
  });

  it('accepts an empty list — that is a real answer', () => {
    // "I have not said what I stock" is different from "the read failed", and
    // the form degrades to free text for it rather than showing an empty menu.
    expect(normaliseOfferedStrings([])).toEqual([]);
  });
});

describe('the build flag gates it', () => {
  it('404s both verbs when off', async () => {
    process.env[FLAG] = 'false';
    const get = await GET(makeRequest('GET', 'http://x/api/stringing/strings'));
    const patch = await PATCH(
      makeAdminRequest('PATCH', 'http://x/api/stringing/strings', { strings: [] }),
    );
    expect([get.status, patch.status]).toEqual([404, 404]);
  });
});

/**
 * The shelf (docs/design/strings-shelf-spec.md): a price per string, a stock
 * BAND and how many in the club play it, each keyed by offered label.
 */
describe('the shelf extras', () => {
  const read = async () => (await GET(makeRequest('GET', 'http://x/api/stringing/strings'))).json();
  const save = (body: Record<string, unknown>) => PATCH(makeAdminRequest('PATCH', 'http://x/api/stringing/strings', body));
  const purchase = (label: string, sets: number) =>
    stockPOST(makeAdminRequest('POST', 'http://x/api/stringing/stock', { label, unit: 'set', units: sets, metresPerUnit: 10, totalCostCents: 1000 * sets, date: '2026-10-01' }));

  it('round-trips prices, keeping null as "Ask" and dropping junk', async () => {
    const res = await save({ strings: ['BG80', 'BG66', 'House'], prices: { BG80: 3200, BG66: null, House: 12.5, Gone: 100 } });
    expect((await res.json()).prices).toEqual({ BG80: 3200, BG66: null });
    expect((await read()).prices).toEqual({ BG80: 3200, BG66: null });
  });

  it('keeps stored prices when an older client sends only the list', async () => {
    await save({ strings: ['BG80', 'BG66'], prices: { BG80: 3200, BG66: 2800 } });
    await save({ strings: ['BG80'] });
    expect((await read()).prices).toEqual({ BG80: 3200 });
  });

  it('gives a band, never sets, and leaves out a string with no purchase', async () => {
    await save({ strings: ['BG80', 'BG66', 'Aerobite', 'Never logged'] });
    await purchase('BG80', 10);
    await purchase('BG66', 2);
    await purchase('Aerobite', 1);
    const lin = seedMember('Lin');
    seedDoc('stringingJobs', { id: 'job-a', groupId: 'bpm', memberId: lin.id, stringLabel: 'aerobite', status: 'strung' });
    const body = await read();
    expect(body.stock).toEqual({ BG80: 'in', BG66: 'low', Aerobite: 'out' });
    const text = JSON.stringify(body);
    for (const leak of ['remainingSets', 'remainingMetres', 'costPerSetCents', 'totalCostCents', 'purchasedCostCents']) {
      expect(text).not.toContain(leak);
    }
  });

  it('counts players only from three up, by label or by the linked catalog name', async () => {
    await save({ strings: ['BG65 white', 'Exbolt'], links: { 'BG65 white': 'string-yx-bg65' } });
    const bag = (label: string) => ({ items: [{ id: 'g', catalogId: null, category: 'string', label }] });
    // Three bags hold the catalog's own name for the linked shelf label.
    for (const n of ['A', 'B', 'C']) seedDoc('playerGear', { id: `gear-${n}`, memberId: seedMember(`P${n}`).id, ...bag('Yonex BG65') });
    // Two hold Exbolt — below the cohort floor, so it is not said at all.
    for (const n of ['D', 'E']) seedDoc('playerGear', { id: `gear-${n}`, memberId: seedMember(`P${n}`).id, ...bag('Exbolt') });
    expect((await read()).players).toEqual({ 'BG65 white': 3 });
  });

  it('answers every field unknown when throttled', async () => {
    const ip = { 'X-Client-IP': 'strings-ratelimit-probe' };
    let last: Response | null = null;
    for (let i = 0; i < 121; i++) last = await GET(makeRequest('GET', 'http://x/api/stringing/strings', undefined, ip));
    expect(await last!.json()).toEqual({ strings: null, links: null, prices: null, stock: null, players: null });
  });
});
