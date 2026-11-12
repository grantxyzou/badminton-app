import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GET, PATCH } from '../app/api/stringing/strings/route';
import { mergeColours } from '../lib/stringingStrings';
import { resetShelfCache } from '../lib/stringShelfRead';
import { __resetCatalogSeedForTests } from '../lib/catalogSeed';
import { resetMockStore, setupAdminPin, seedTestAdminMember, seedMember, makeRequest, makeAdminRequest, memberCookieValue } from './helpers';

/**
 * A stringer who is not an admin may name a string and set its reel colours,
 * and nothing else (docs/plans/stringer-shelf-edits.md; Grant, 2026-11-12:
 * "open up reel and string name, colour for stringers").
 */
const FLAG = 'NEXT_PUBLIC_FLAG_STRINGING';
const URL = 'http://x/api/stringing/strings';

const as = (name: string, overrides: Record<string, unknown> = {}) => {
  const m = seedMember(name, overrides);
  return { Cookie: `member_session=${memberCookieValue(name, m.id)}` };
};
const patch = (body: unknown, headers: Record<string, string>) =>
  PATCH(makeRequest('PATCH', URL, body as Record<string, unknown>, headers));
const shelf = async () => (await (await GET(makeAdminRequest('GET', URL))).json()) as { strings: string[]; prices: Record<string, number | null>; colours: Record<string, string[]> };

beforeEach(async () => {
  resetMockStore();
  resetShelfCache();
  __resetCatalogSeedForTests();
  setupAdminPin();
  await seedTestAdminMember();
  process.env[FLAG] = 'true';
  await PATCH(makeAdminRequest('PATCH', URL, { strings: ['BG80', 'Aerobite'], prices: { BG80: 3000 }, colours: { BG80: ['white'] }, aliases: { 'BG-80': 'BG80' } }));
});
afterEach(() => {
  delete process.env[FLAG];
});

describe('a stringer on the shelf', () => {
  it('sets a string’s reel colours, merged into the stored map, and is told only the list and colours', async () => {
    const zach = as('Zach', { canString: true });
    const res = await patch({ colours: { Aerobite: ['red', 'white', 'nope'] } }, zach);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ strings: ['BG80', 'Aerobite'], colours: { BG80: ['white'], Aerobite: ['white', 'red'] } });
    const after = await shelf();
    expect(after.colours).toEqual({ BG80: ['white'], Aerobite: ['white', 'red'] });
    // The price the admin set is untouched.
    expect(after.prices).toEqual({ BG80: 3000 });
  });

  it('clears a string’s colours with an empty list', async () => {
    const res = await patch({ colours: { BG80: [] } }, as('Zach', { canString: true }));
    expect(res.status).toBe(200);
    expect((await shelf()).colours).toEqual({});
  });

  it('renames a string, keeping its price and colours', async () => {
    const res = await patch({ rename: { from: 'BG80', to: 'BG80 white' } }, as('Zach', { canString: true }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ strings: ['BG80 white', 'Aerobite'], colours: { 'BG80 white': ['white'] } });
    expect(body).not.toHaveProperty('aliases');
    expect((await shelf()).prices).toEqual({ 'BG80 white': 3000 });
  });

  it('gets the same name_taken refusal as an admin', async () => {
    const res = await patch({ rename: { from: 'BG80', to: 'aerobite' } }, as('Zach', { canString: true }));
    expect(res.status).toBe(409);
  });

  it('may not touch the list, a price, a link or an alias, or send two things at once', async () => {
    const zach = as('Zach', { canString: true });
    for (const body of [
      { strings: ['BG80'] },
      { prices: { BG80: 1 } },
      { links: { BG80: 'string-yx-bg80' } },
      { aliases: {} },
      { strings: ['BG80', 'Aerobite'], colours: { BG80: ['red'] } },
      { colours: { BG80: ['red'] }, rename: { from: 'BG80', to: 'X' } },
    ]) {
      const res = await patch(body, zach);
      expect(res.status, JSON.stringify(body)).toBe(403);
      expect(await res.json()).toEqual({ error: 'forbidden_field' });
    }
    expect(await shelf()).toMatchObject({ strings: ['BG80', 'Aerobite'], prices: { BG80: 3000 }, colours: { BG80: ['white'] } });
  });

  it('a member who does not string, or nobody signed in, is refused before anything is read', async () => {
    expect((await patch({ colours: { BG80: ['red'] } }, as('Lin'))).status).toBe(401);
    expect((await patch({ colours: { BG80: ['red'] } }, {})).status).toBe(401);
    expect((await shelf()).colours).toEqual({ BG80: ['white'] });
  });
});

describe('an admin', () => {
  it('may send the colours-only shape too, and still gets the full answer', async () => {
    const res = await PATCH(makeAdminRequest('PATCH', URL, { colours: { Aerobite: ['black'] } }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ prices: { BG80: 3000 }, aliases: { 'BG-80': 'BG80' }, colours: { BG80: ['white'], Aerobite: ['black'] } });
  });
});

describe('mergeColours', () => {
  it('replaces only the strings it names, drops labels not on the list, and refuses a non-map', () => {
    expect(mergeColours({ A: ['white'] }, { B: ['red'], Ghost: ['red'] }, ['A', 'B'])).toEqual({ A: ['white'], B: ['red'] });
    expect(mergeColours({ A: ['white'] }, { A: [] }, ['A'])).toEqual({});
    expect(mergeColours({}, ['red'], ['A'])).toBeNull();
    expect(mergeColours({}, null, ['A'])).toBeNull();
  });
});
