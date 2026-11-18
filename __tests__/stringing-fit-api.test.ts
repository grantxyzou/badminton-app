import { describe, it, expect, beforeEach } from 'vitest';
import { GET } from '@/app/api/stringing/fit/route';
import { makeRequest, memberCookieValue, resetMockStore, getStore, setupAdminPin } from './helpers';
import { __resetCatalogSeedForTests } from '@/lib/catalogSeed';
import { getContainer } from '@/lib/cosmos';

/**
 * "Based on your racket and skill" (docs/plans/stringing-canvas-redesign.md,
 * Decision 9): one string against the caller's OWN frame, through the same
 * pairing engine as the Stats card. It says nothing rather than guess.
 */
const FRAME = {
  id: 'frame-hh', category: 'racket', brand: 'Yonex', model: 'Astrox Test',
  skillRange: [2, 5], msrp: 200,
  attributes: { balance: 'Head-heavy', flex: 'Stiff', playStyle: 'Power', weightMaxG: 88, tier: 'Premium', tensionMinLbs: 20, tensionMaxLbs: 28 },
};
const STRING = {
  id: 'string-test', category: 'string', brand: 'Yonex', model: 'BG Test',
  skillRange: [1, 5], msrp: 15,
  attributes: {
    stringType: 'Durability', gaugeMm: 0.7, repulsion: 5, durability: 10, control: 7, feel: 'Soft', feelScale: 2,
    skillLevel: 'Intermediate', ratingSource: 'Brand published', priceSetUsdMin: 12, priceSetUsdMax: 14,
    tensionMinLbs: 19, tensionMaxLbs: 26,
  },
};

function seedLin(withRatings = true) {
  const store = getStore();
  store['members'] = [{ id: 'm-lin', name: 'Lin', role: 'member', active: true, sessionCount: 0, createdAt: new Date().toISOString() }];
  store['assessments'] = withRatings
    ? [{ id: 'a-lin', memberId: 'm-lin', name: 'Lin', takenAt: '2026-06-01T00:00:00.000Z', overall: 3,
        ratings: [{ skillKey: 'smashes', value: 4, source: 'self' }, { skillKey: 'footwork_split_step', value: 3, source: 'self' }] }]
    : [];
}

async function seedGear(catalogId: string | null) {
  await getContainer('playerGear').items.upsert({
    id: 'gear-m-lin', memberId: 'm-lin',
    items: [{ id: 'g1', catalogId, category: 'racket', label: 'Astrox Test' }],
    activeRacketId: 'g1', playFormat: 'doubles', updatedAt: new Date().toISOString(),
  });
}

const ask = (id = 'string-test') =>
  GET(makeRequest('GET', `http://localhost:3000/api/stringing/fit?id=${id}`, undefined, {
    cookie: `member_session=${memberCookieValue('Lin', 'm-lin')}`,
  }));

beforeEach(async () => {
  resetMockStore();
  setupAdminPin();
  __resetCatalogSeedForTests();
  const catalog = getContainer('equipmentCatalog');
  await catalog.items.upsert(FRAME);
  await catalog.items.upsert(STRING);
});

describe('GET /api/stringing/fit', () => {
  it('pairs the string with the member’s own frame and names it', async () => {
    seedLin();
    await seedGear('frame-hh');
    const res = await ask();
    expect(res.status).toBe(200);
    const { fit } = await res.json();
    expect(fit.racket).toBe('Yonex Astrox Test');
    expect(['good_match', 'worth_a_look']).toContain(fit.verdict);
    expect(fit.frameTension).toEqual([20, 28]);
    expect(fit.stringTension).toEqual([19, 26]);
    expect(fit.stringLevel).toBe('Intermediate');
    expect(['Beginner', 'Intermediate', 'Advanced']).toContain(fit.level);
  });

  it('says nothing without a check-in, rather than pairing on default skills', async () => {
    seedLin(false);
    await seedGear('frame-hh');
    expect(await (await ask()).json()).toEqual({ fit: null, reason: 'needs_check_in' });
  });

  it('says nothing for a racket the catalog does not know — never a frame they do not own', async () => {
    seedLin();
    await seedGear(null);
    expect(await (await ask()).json()).toEqual({ fit: null, reason: 'no_frame' });
  });

  it('refuses a malformed id and 404s an unknown string', async () => {
    seedLin();
    await seedGear('frame-hh');
    expect((await ask('../etc')).status).toBe(400);
    expect((await ask('string-nope')).status).toBe(404);
  });

  it('takes no frame from the query string', async () => {
    // A racketId parameter would let any caller pair any frame; the route
    // reads the caller's own gear and nothing else.
    seedLin();
    await seedGear(null);
    const res = await GET(makeRequest('GET', 'http://localhost:3000/api/stringing/fit?id=string-test&racketId=frame-hh', undefined, {
      cookie: `member_session=${memberCookieValue('Lin', 'm-lin')}`,
    }));
    expect((await res.json()).fit).toBeNull();
  });
  /* The map's glow (the canvas, 2026-11-12): one answer for the shelf. */
  it('answers verdicts for a list of strings, against the member’s own frame', async () => {
    seedLin();
    await seedGear('frame-hh');
    const res = await GET(makeRequest('GET', 'http://localhost:3000/api/stringing/fit?ids=string-test,string-nope', undefined, {
      cookie: `member_session=${memberCookieValue('Lin', 'm-lin')}`,
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.racket).toBe('Yonex Astrox Test');
    expect(Object.keys(body.fits)).toEqual(['string-test']);
    expect(['good_match', 'worth_a_look', 'not_for_frame']).toContain(body.fits['string-test']);
  });

  it('says nothing for the list without a frame, and refuses a bad or oversized list', async () => {
    seedLin();
    await seedGear(null);
    const ask2 = (q: string) => GET(makeRequest('GET', `http://localhost:3000/api/stringing/fit?${q}`, undefined, {
      cookie: `member_session=${memberCookieValue('Lin', 'm-lin')}`,
    }));
    expect(await (await ask2('ids=string-test')).json()).toEqual({ fits: null, reason: 'no_frame' });
    expect((await ask2('ids=../etc')).status).toBe(400);
    expect((await ask2(`ids=${Array.from({ length: 41 }, (_, i) => `s-${i}`).join(',')}`)).status).toBe(400);
  });

  /* "Change" on the map's strip (docs/plans/map-racket-choice.md): the
     member picks which of THEIR OWN rackets the answer is for. */
  describe('the racket choice', () => {
    // A second frame the test string cannot go on at all (its tension window
    // sits above the string's), so the verdict visibly changes with the pick.
    const FRAME_2 = { ...FRAME, id: 'frame-tight', model: 'Nanoflare Test', attributes: { ...FRAME.attributes, tensionMinLbs: 30, tensionMaxLbs: 34 } };
    const lin = { cookie: `member_session=${memberCookieValue('Lin', 'm-lin')}` };
    const get = (q: string) => GET(makeRequest('GET', `http://localhost:3000/api/stringing/fit?${q}`, undefined, lin));

    async function seedBag(items: Record<string, unknown>[], activeRacketId = 'g1') {
      await getContainer('equipmentCatalog').items.upsert(FRAME_2);
      await getContainer('playerGear').items.upsert({
        id: 'gear-m-lin', memberId: 'm-lin', items, activeRacketId, playFormat: 'doubles', updatedAt: new Date().toISOString(),
      });
    }
    const TWO = [
      { id: 'g1', catalogId: 'frame-hh', category: 'racket', label: 'Astrox Test' },
      { id: 'g2', catalogId: 'frame-tight', category: 'racket', label: 'Nanoflare Test' },
    ];

    it('with no choice answers for the racket in play, and lists the rackets it can pair', async () => {
      seedLin();
      await seedBag([...TWO, { id: 'g3', catalogId: null, category: 'racket', label: 'Typed in' }]);
      const body = await (await get('ids=string-test')).json();
      expect(body.racket).toBe('Yonex Astrox Test');
      expect(body.racketId).toBe('g1');
      expect(body.rackets).toEqual([
        { id: 'g1', name: 'Yonex Astrox Test', inPlay: true },
        { id: 'g2', name: 'Yonex Nanoflare Test', inPlay: false },
      ]);
      expect(body.fits['string-test']).not.toBe('not_for_frame');
    });

    it('answers for the chosen racket, and the verdicts change with it', async () => {
      seedLin();
      await seedBag(TWO);
      const body = await (await get('ids=string-test&racket=g2')).json();
      expect(body.racket).toBe('Yonex Nanoflare Test');
      expect(body.racketId).toBe('g2');
      expect(body.fits['string-test']).toBe('not_for_frame');
      // The racket in play is still marked as such: the choice moves the map only.
      expect(body.rackets.find((r: { id: string }) => r.id === 'g1').inPlay).toBe(true);
      // One string's page answers for the same racket.
      const one = await (await get('id=string-test&racket=g2')).json();
      expect(one.fit.racket).toBe('Yonex Nanoflare Test');
      expect(one.fit.verdict).toBe('not_for_frame');
    });

    it('never pairs a frame that is not in the caller’s own bag', async () => {
      seedLin();
      await seedBag([TWO[0]]);
      // Viktor owns the tight frame; Lin does not.
      await getContainer('playerGear').items.upsert({
        id: 'gear-m-viktor', memberId: 'm-viktor', activeRacketId: 'v1', updatedAt: new Date().toISOString(),
        items: [{ id: 'v1', catalogId: 'frame-tight', category: 'racket', label: 'Nanoflare Test' }],
      });
      // Another member's bag row, a catalog id, and nonsense: each answers
      // for Lin's racket in play, exactly as with no parameter.
      for (const racket of ['v1', 'frame-tight', '../etc', 'x'.repeat(500)]) {
        const body = await (await get(`ids=string-test&racket=${encodeURIComponent(racket)}`)).json();
        expect(body.racket).toBe('Yonex Astrox Test');
        expect(body.racketId).toBe('g1');
        expect(body.rackets).toEqual([{ id: 'g1', name: 'Yonex Astrox Test', inPlay: true }]);
        const one = await (await get(`id=string-test&racket=${encodeURIComponent(racket)}`)).json();
        expect(one.fit.racket).toBe('Yonex Astrox Test');
      }
    });

    it('does not offer a typed-in or retired racket, or one the catalog has lost', async () => {
      seedLin();
      await seedBag([
        TWO[0],
        { id: 'g3', catalogId: null, category: 'racket', label: 'Typed in' },
        { id: 'g4', catalogId: 'frame-tight', category: 'racket', label: 'Nanoflare Test', retiredAt: '2026-01-01T00:00:00.000Z' },
        { id: 'g5', catalogId: 'frame-gone', category: 'racket', label: 'Gone' },
      ]);
      for (const racket of ['g3', 'g4', 'g5']) {
        const body = await (await get(`ids=string-test&racket=${racket}`)).json();
        expect(body.racketId).toBe('g1');
        expect(body.rackets.map((r: { id: string }) => r.id)).toEqual(['g1']);
      }
    });

    it('still says nothing when the racket in play is typed in and nothing was chosen', async () => {
      seedLin();
      await seedBag([{ id: 'g1', catalogId: null, category: 'racket', label: 'Typed in' }, TWO[1]]);
      expect(await (await get('ids=string-test')).json()).toEqual({ fits: null, reason: 'no_frame' });
    });
  });
});
