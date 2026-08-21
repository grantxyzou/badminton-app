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
    setupAdminPin();
    process.env.NEXT_PUBLIC_FLAG_VALUE_HUB_SLICE = 'true';
    process.env.NEXT_PUBLIC_FLAG_GEAR_RECOMMENDER = 'true';
  });

  afterEach(() => {
    delete process.env.NEXT_PUBLIC_FLAG_VALUE_HUB_SLICE;
    delete process.env.NEXT_PUBLIC_FLAG_GEAR_RECOMMENDER;
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

  // Proving "absent category defaults to racket" needs more than "not a 400" —
  // with no member cookie and the recommender flag on, an unauthenticated
  // request 403s at the auth gate before category-default logic ever runs, so
  // that alone can't distinguish "defaulted to racket" from "defaulted to
  // anything". Use the admin path (bypasses the ownership gate) and check the
  // one thing that actually depends on which category was chosen: `racket` is
  // the sole ENGINE_CATEGORIES member, so only it reaches the profile check
  // and returns `needsCheckIn` (Lin has no assessment seeded here) — every
  // other category short-circuits to `unavailable: 'no_engine'` first.
  it('absent category defaults to racket, not a bare non-400', async () => {
    const res = await GET(makeGetRequest('http://localhost:3000/api/recommend?name=Lin', true));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.unavailable).not.toBe('no_engine');
    expect(body.needsCheckIn).toBe(true);
  });

  // bpm-stable runs VALUE_HUB_SLICE on and GEAR_RECOMMENDER off, so the
  // flag-off branch is live in production — and its catalog query is literally
  // `@category: 'racket'`. Before the pick rail nothing passed a category so
  // that never showed; the rail asks per category, and a racket returned under
  // the STRINGS card is exactly the wrong-recommendation class of bug this
  // redesign exists to kill.
  it('does not return a racket for a non-racket category with the engine flag off', async () => {
    process.env.NEXT_PUBLIC_FLAG_GEAR_RECOMMENDER = 'false';
    const res = await GET(
      makeRequest('GET', 'http://localhost:3000/api/recommend?name=Lin&category=string'),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.item).toBeNull();
    expect(body.unavailable).toBe('no_engine');
  });

  it('returns a reason list', async () => {
    // Admin path avoids minting a member cookie in this test.
    const res = await GET(
      makeGetRequest('http://localhost:3000/api/recommend?name=Lin&category=racket', true),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.reasons ?? [])).toBe(true);
  });

  /**
   * Gear reasons are grounded in how the member PLAYS, never in what they are
   * working on. The drill line ("You are working on drops — slow-drop target
   * zones is in this week's focus") used to be the whole visible why-this list:
   * it capped the engine at one slot, and the sheet spends slot zero on its
   * headline, so everything a member could actually read under WHY THIS was the
   * drill. Nothing computes a relationship between a drill and a frame, so the
   * line asserted a connection that was never scored.
   */
  it('never grounds a gear reason in the member\'s drills', async () => {
    seedRatedLin();
    const res = await GET(
      makeGetRequest('http://localhost:3000/api/recommend?name=Lin&category=racket', true),
    );
    const body = await res.json();
    expect(body.reasons.length).toBeGreaterThan(0);
    expect(body.reasons.join(' ')).not.toMatch(/working on|this week's focus/i);
  });

  // The real scoring engine (lib/racketRecommend.ts) routinely fills all 3 of
  // buildPickReasons' default `limit` slots with equipment-derived reasons on
  // its own (balance + category + format, etc.), so an end-to-end request with
  // a real profile can't observe the club line — it is ordered last and gets
  // sliced off. To exercise the wiring rather than the engine crowding it out,
  // stub `recommendRackets` to return a single equipment reason.
  it('surfaces club grounding when the engine reasons leave room', async () => {
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
    expect(
      body.reasons.some((r: string) => r.includes('people in the club already play it')),
    ).toBe(true);

    spy.mockRestore();
  });

  // The catch around the club read in the route is deliberate and narrow: a
  // read failure there must degrade *reasons*, never take the recommendation
  // itself down.
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
