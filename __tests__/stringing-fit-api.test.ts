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
});
