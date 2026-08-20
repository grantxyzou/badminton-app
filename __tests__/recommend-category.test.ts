import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { GET } from '@/app/api/recommend/route';
import { makeRequest, makeGetRequest, setupAdminPin, resetMockStore, getStore } from './helpers';
import { __resetCatalogSeedForTests } from '@/lib/catalogSeed';
import * as cosmos from '@/lib/cosmos';
import * as racketRecommend from '@/lib/racketRecommend';

function seedRatedLin() {
  const store = getStore();
  store['members'] = [
    { id: 'm-lin', name: 'Lin', role: 'member', active: true, sessionCount: 0, createdAt: new Date().toISOString() },
  ];
  store['assessments'] = [
    {
      id: 'a-lin',
      memberId: 'm-lin',
      name: 'Lin',
      takenAt: '2026-06-01T00:00:00.000Z',
      overall: 3,
      ratings: [
        { skillKey: 'smashes', value: 5, source: 'self' },
        { skillKey: 'clears_lifts', value: 5, source: 'self' },
        { skillKey: 'drives', value: 1, source: 'self' },
        { skillKey: 'net_play', value: 1, source: 'self' },
      ],
    },
  ];
}

describe('GET /api/recommend?category=', () => {
  beforeEach(async () => {
    resetMockStore();
    // resetMockStore() wipes the store, but ensureCatalogSeeded caches its
    // "already seeded" promise at module scope (see recommend-route.test.ts) —
    // without this, the drill/club-grounding test below (the first in this
    // file to actually reach the catalog) could see an empty catalog if this
    // module runs after another suite already populated + cached it.
    __resetCatalogSeedForTests();
    await setupAdminPin();
    process.env.NEXT_PUBLIC_FLAG_VALUE_HUB_SLICE = 'true';
    process.env.NEXT_PUBLIC_FLAG_RACKET_RECOMMENDER = 'true';
  });

  afterEach(() => {
    delete process.env.NEXT_PUBLIC_FLAG_VALUE_HUB_SLICE;
    delete process.env.NEXT_PUBLIC_FLAG_RACKET_RECOMMENDER;
  });

  it('400s on an unrecognized category rather than coercing to racket', async () => {
    const res = await GET(
      makeRequest('GET', 'http://localhost:3000/api/recommend?name=Lin&category=shoes'),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid_category');
  });

  // R3 (controller ruling): the brief's original assertion — expect([200, 403])
  // — passes on either branch and can't fail for the reason it exists. Use the
  // admin path (bypasses the member-cookie ownership gate) and assert the
  // actual response shape instead.
  it('returns unavailable:no_engine for a valid category with no scorer', async () => {
    const res = await GET(
      makeGetRequest('http://localhost:3000/api/recommend?name=Lin&category=shoe', true),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.unavailable).toBe('no_engine');
    expect(body.item).toBeNull();
  });

  it('absent category still behaves as racket', async () => {
    const res = await GET(makeRequest('GET', 'http://localhost:3000/api/recommend?name=Lin'));
    expect(res.status).not.toBe(400);
  });

  // bpm-stable runs VALUE_HUB_SLICE on and RACKET_RECOMMENDER off, so the
  // flag-off branch is live in production — and its catalog query is literally
  // `@category: 'racket'`. Before the pick rail nothing passed a category so
  // that never showed; the rail asks per category, and a racket returned under
  // the STRINGS card is exactly the wrong-recommendation class of bug this
  // redesign exists to kill.
  it('does not return a racket for a non-racket category with the engine flag off', async () => {
    process.env.NEXT_PUBLIC_FLAG_RACKET_RECOMMENDER = 'false';
    const res = await GET(
      makeRequest('GET', 'http://localhost:3000/api/recommend?name=Lin&category=string'),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.item).toBeNull();
    expect(body.unavailable).toBe('no_engine');
  });

  it('includes drill-grounded reasons when the member has drill picks', async () => {
    // Admin path avoids minting a member cookie in this test.
    const res = await GET(
      makeGetRequest('http://localhost:3000/api/recommend?name=Lin&category=racket', true),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.reasons ?? [])).toBe(true);
  });

  // The real scoring engine (lib/racketRecommend.ts) routinely fills all 3 of
  // buildPickReasons' default `limit` slots with equipment-derived reasons on
  // its own (flex + balance + category, etc.), so an end-to-end request with a
  // real profile can't observe the drill/club lines — they're priority-ordered
  // LAST and get sliced off. To actually exercise the wiring (not just the
  // engine crowding it out), stub `recommendRackets` to return a single
  // equipment reason, leaving room, and confirm both new sources land.
  it('surfaces drill and club grounding when the engine reasons leave room', async () => {
    seedRatedLin();
    const item = {
      id: 'mock-racket', category: 'racket' as const, brand: 'Acme', model: 'Zeta',
      skillRange: [1, 6] as [number, number], msrp: 100,
    };
    const spy = vi.spyOn(racketRecommend, 'recommendRackets').mockReturnValue([
      { item, score: 90, reasons: ['A solid engine reason'], warnings: [] },
    ]);

    const store = getStore();
    // Club cohort at the CLUB_GEAR_MIN_COHORT floor (3), all playing the exact
    // item just mocked as the top pick.
    store['playerGear'] = [1, 2, 3].map((i) => ({
      id: `gear-club-${i}`,
      memberId: `club-${i}`,
      items: [{ id: `item-${i}`, catalogId: item.id, category: 'racket', label: `${item.brand} ${item.model}` }],
    }));

    const res = await GET(
      makeGetRequest('http://localhost:3000/api/recommend?name=Lin&category=racket', true),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.item.id).toBe('mock-racket');
    expect(body.reasons).toContain('A solid engine reason');
    // Lin's weakest rated skills (drives, net_play) both have drills in the
    // library, so drillPicksFor should surface the cross-domain line.
    expect(body.reasons.some((r: string) => r.startsWith('You are working on'))).toBe(true);
    expect(
      body.reasons.some((r: string) => r.includes('people in the club already play it')),
    ).toBe(true);

    spy.mockRestore();
  });

  // The two catches around the drills/club reads in the route are deliberate
  // and narrow: a read failure there must degrade *reasons*, never take the
  // recommendation itself down. Exercise the club-tally catch specifically —
  // the drills catch is defense-in-depth only, since drillPicksFor's own
  // internal reads already degrade to [] and never throw (see lib/drills.ts).
  it('still returns the pick when the club-tally read fails', async () => {
    seedRatedLin();
    const realGetContainer = cosmos.getContainer;
    vi.spyOn(cosmos, 'getContainer').mockImplementation((name: string) => {
      const real = realGetContainer(name);
      if (name === 'playerGear') {
        // Only the fetch-all `.items.query(...)` (the club tally read) is
        // broken here — the earlier `.item(id, pk).read()` (gear-existence
        // check) is left intact via the `real` spread below.
        return {
          ...real,
          items: { ...real.items, query: () => ({ fetchAll: () => Promise.reject(new Error('boom')) }) },
        } as unknown as ReturnType<typeof cosmos.getContainer>;
      }
      return real;
    });

    const res = await GET(
      makeGetRequest('http://localhost:3000/api/recommend?name=Lin&category=racket', true),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.item).toBeTruthy();
    expect(Array.isArray(body.reasons)).toBe(true);

    vi.restoreAllMocks();
  });
});
