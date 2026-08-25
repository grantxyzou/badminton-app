import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { GET as CATALOG } from '../app/api/equipment/catalog/route';
import { GET as CLUB_GEAR } from '../app/api/stats/club/gear/route';
import { resetMockStore, setupAdminPin, makeRequest, getStore } from './helpers';
import { __resetCatalogSeedForTests } from '../lib/catalogSeed';
import { recommendTension, formatForToggle, MIN_LB, MAX_LB } from '../lib/tension';
import { tallyClubGear, CLUB_GEAR_MIN_COHORT } from '../lib/clubGear';

describe('lib/tension', () => {
  it('gives no advice without a level rather than inventing a middle number', () => {
    expect(recommendTension(null, 'doubles')).toBeNull();
    expect(recommendTension(Number.NaN, 'doubles')).toBeNull();
  });

  it('rises with level', () => {
    const low = recommendTension(1, 'doubles')!;
    const high = recommendTension(4.5, 'doubles')!;
    expect(high.lb).toBeGreaterThan(low.lb);
  });

  it('adds two pounds for singles', () => {
    expect(recommendTension(3, 'singles')!.lb - recommendTension(3, 'doubles')!.lb).toBe(2);
  });

  it('treats "both" as doubles — the safer number for someone who has not chosen', () => {
    expect(recommendTension(3, 'both')!.lb).toBe(recommendTension(3, 'doubles')!.lb);
  });

  // BOTH clamps are defensive, not load-bearing. Levels run 1-5, so a real
  // member lands in 22-28 inside a 20-30 scale and the knob never touches
  // either end. That is intended: the scale shows the whole space of sensible
  // tensions, and your advice sits somewhere in it. The clamps only guard
  // against a level arriving from somewhere unexpected.
  it('keeps every real level inside the printable scale', () => {
    for (const lvl of [1, 2, 3, 4, 5]) {
      for (const f of ['singles', 'doubles', 'both'] as const) {
        const lb = recommendTension(lvl, f)!.lb;
        expect(lb).toBeGreaterThanOrEqual(MIN_LB);
        expect(lb).toBeLessThanOrEqual(MAX_LB);
      }
    }
    // The actual achievable band, pinned so a formula change is visible.
    expect(recommendTension(1, 'doubles')!.lb).toBe(22);
    expect(recommendTension(5, 'singles')!.lb).toBe(28);
  });

  it('clamps a nonsense level rather than printing an absurd number', () => {
    expect(recommendTension(-99, 'doubles')!.lb).toBe(MIN_LB);
    expect(recommendTension(99, 'singles')!.lb).toBe(MAX_LB);
  });

  it('keeps the knob position inside the track', () => {
    for (const lvl of [0, 1, 2.5, 3.7, 5, 99]) {
      for (const f of ['singles', 'doubles', 'both'] as const) {
        const a = recommendTension(lvl, f)!;
        expect(a.position).toBeGreaterThanOrEqual(0);
        expect(a.position).toBeLessThanOrEqual(1);
      }
    }
  });

  it('is deterministic — same inputs, same answer', () => {
    expect(recommendTension(3.2, 'doubles')).toEqual(recommendTension(3.2, 'doubles'));
  });

  it('picks a reason band that matches the level', () => {
    expect(recommendTension(1.5, 'doubles')!.reasonKey).toBe('lowLevel');
    expect(recommendTension(3, 'doubles')!.reasonKey).toBe('midLevel');
    expect(recommendTension(4.5, 'doubles')!.reasonKey).toBe('highLevel');
  });

  it('maps "both" to the Doubles toggle position', () => {
    expect(formatForToggle('both')).toBe('doubles');
    expect(formatForToggle(undefined)).toBe('doubles');
    expect(formatForToggle('singles')).toBe('singles');
  });
});

describe('lib/clubGear', () => {
  const gear = (labels: [string, string][]) => ({
    items: labels.map(([category, label], i) => ({
      id: `i${i}`,
      catalogId: null,
      category,
      label,
    })),
  });

  it('drops anything below the cohort minimum — a count of one is a name', () => {
    const out = tallyClubGear([gear([['string', 'BG65']]), gear([['string', 'BG80']])] as never);
    expect(out).toEqual([]);
  });

  it('reports an entry once enough members own it', () => {
    const docs = Array.from({ length: CLUB_GEAR_MIN_COHORT }, () => gear([['string', 'BG65']]));
    const out = tallyClubGear(docs as never);
    expect(out).toEqual([{ category: 'string', label: 'BG65', count: 3 }]);
  });

  it('counts a member once even if they own three of the same thing', () => {
    // Otherwise the tally measures who buys in bulk, not what the club plays.
    const hoarder = gear([
      ['string', 'BG65'],
      ['string', 'BG65'],
      ['string', 'BG65'],
    ]);
    const out = tallyClubGear([hoarder, gear([['string', 'BG65']]), gear([['string', 'BG65']])] as never);
    expect(out[0].count).toBe(3);
  });

  it('is case-insensitive on the label', () => {
    const out = tallyClubGear([
      gear([['string', 'BG65']]),
      gear([['string', 'bg65']]),
      gear([['string', 'Bg65']]),
    ] as never);
    expect(out.length).toBe(1);
    expect(out[0].count).toBe(3);
  });

  it('treats a legacy item with no category as a racket', () => {
    const legacy = { items: [{ id: 'x', catalogId: null, label: 'Astrox 88D' }] };
    const out = tallyClubGear([legacy, legacy, legacy] as never);
    expect(out[0].category).toBe('racket');
  });

  it('ignores retired gear — that is not what the club plays now', () => {
    const retired = { items: [{ id: 'r', catalogId: null, category: 'string', label: 'BG65', retiredAt: '2026-01-01' }] };
    const out = tallyClubGear([retired, retired, retired] as never);
    expect(out).toEqual([]);
  });

  it('sorts most-played first', () => {
    const docs = [
      ...Array.from({ length: 5 }, () => gear([['string', 'BG65']])),
      ...Array.from({ length: 3 }, () => gear([['string', 'BG80']])),
    ];
    const out = tallyClubGear(docs as never);
    expect(out.map((e) => e.label)).toEqual(['BG65', 'BG80']);
  });

  it('tolerates junk docs', () => {
    expect(tallyClubGear([null, {}, { items: null }, { items: [null, { label: '  ' }] }] as never)).toEqual([]);
  });
});

describe('GET /api/equipment/catalog — category validation', () => {
  beforeEach(() => {
    resetMockStore();
    setupAdminPin();
    // ensureCatalogSeeded caches its promise, so wiping the mock store without
    // clearing that cache leaves the container permanently EMPTY for the rest
    // of the file. Every `items.every(...)` assertion then passes vacuously
    // on [] — which is exactly how the "defaults to rackets" case below was
    // passing while serving nothing at all.
    __resetCatalogSeedForTests();
    process.env.NEXT_PUBLIC_FLAG_VALUE_HUB_SLICE = 'true';
  });
  afterAll(() => {
    delete process.env.NEXT_PUBLIC_FLAG_VALUE_HUB_SLICE;
  });

  it('400s on an unrecognized category instead of silently returning rackets', async () => {
    // The design calls these "shoes"/"strings"/"shuttles"; the enum is
    // singular. A plural typo used to return RACKETS with a 200.
    for (const bad of ['shoes', 'strings', 'shuttles', 'nonsense']) {
      const res = await CATALOG(
        makeRequest('GET', `http://localhost:3000/api/equipment/catalog?category=${bad}`),
      );
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe('invalid_category');
    }
  });

  it('still defaults to rackets when no category is given', async () => {
    const res = await CATALOG(makeRequest('GET', 'http://localhost:3000/api/equipment/catalog'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items.every((i: { category: string }) => i.category === 'racket')).toBe(true);
  });

  it('accepts every valid singular category', async () => {
    for (const good of ['racket', 'string', 'shoe', 'shuttle', 'bag', 'grip']) {
      const res = await CATALOG(
        makeRequest('GET', `http://localhost:3000/api/equipment/catalog?category=${good}`),
      );
      expect(res.status).toBe(200);
    }
  });

  // End-to-end proof that the Gear rail un-parks Strings: the rail probes this
  // exact call and goes live when it returns rows. Asserting on the catalog
  // JSON alone would not show that seeding and the category filter agree.
  it('serves the imported strings, which is what un-parks the rail', async () => {
    const res = await CATALOG(
      makeRequest('GET', 'http://localhost:3000/api/equipment/catalog?category=string'),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toHaveLength(46);
    expect(body.items.every((i: { category: string }) => i.category === 'string')).toBe(true);
  });

  it('still serves no shoes or shuttles, so those stay parked', async () => {
    for (const unsourced of ['shoe', 'shuttle']) {
      const res = await CATALOG(
        makeRequest('GET', `http://localhost:3000/api/equipment/catalog?category=${unsourced}`),
      );
      expect((await res.json()).items).toHaveLength(0);
    }
  });
});

describe('GET /api/stats/club/gear', () => {
  beforeEach(() => {
    resetMockStore();
    setupAdminPin();
  });
  afterAll(() => {
  });

  it('returns counts only — the response has no seam for a name', async () => {
    const store = getStore();
    store['playerGear'] = Array.from({ length: 4 }, (_, i) => ({
      id: `gear-${i}`,
      memberId: `m${i}`,
      items: [{ id: `x${i}`, catalogId: null, category: 'string', label: 'BG65' }],
      updatedAt: '2026-01-01',
    }));
    const res = await CLUB_GEAR(makeRequest('GET', 'http://localhost:3000/api/stats/club/gear'));
    const body = await res.json();
    expect(body.entries).toEqual([{ category: 'string', label: 'BG65', count: 4 }]);
    const text = JSON.stringify(body);
    expect(text).not.toMatch(/memberId|m0|m1|gear-/);
  });

  it('drops sub-threshold entries rather than showing a small count', async () => {
    const store = getStore();
    store['playerGear'] = [
      { id: 'g1', memberId: 'm1', items: [{ id: 'a', catalogId: null, category: 'string', label: 'Rare' }], updatedAt: '' },
    ];
    const res = await CLUB_GEAR(makeRequest('GET', 'http://localhost:3000/api/stats/club/gear'));
    const body = await res.json();
    expect(body.entries).toEqual([]);
    expect(body.minCohort).toBe(CLUB_GEAR_MIN_COHORT);
  });
});
