import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GET, PATCH } from '../app/api/stringing/strings/route';
import { normaliseOfferedStrings, MAX_OFFERED } from '../lib/stringingStrings';
import {
  resetMockStore,
  setupAdminPin,
  seedTestAdminMember,
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
    expect(await res.json()).toEqual({ strings: [] });
  });

  it('returns only the list — no author, no timestamps', async () => {
    await PATCH(
      makeAdminRequest('PATCH', 'http://x/api/stringing/strings', { strings: ['BG80'] }),
    );
    const body = await (await GET(makeRequest('GET', 'http://x/api/stringing/strings'))).json();
    expect(Object.keys(body)).toEqual(['strings']);
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
