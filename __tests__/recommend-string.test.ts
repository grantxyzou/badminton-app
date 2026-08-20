import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GET } from '@/app/api/recommend/route';
import { makeGetRequest, setupAdminPin, resetMockStore, getStore } from './helpers';
import { __resetCatalogSeedForTests } from '@/lib/catalogSeed';
import { getContainer } from '@/lib/cosmos';

/**
 * D1 (spec): string pairing needs a frame, and resolves one in a fixed order —
 * the member's own catalog-linked racket, else the racket we'd recommend them,
 * else parked. The rung it landed on is reported in `pairedWith.source` so the
 * card can say which frame it assumed instead of hiding the assumption.
 */
const FRAME = {
  id: 'frame-hh', category: 'racket', brand: 'Yonex', model: 'Astrox Test',
  skillRange: [2, 5], msrp: 200,
  attributes: {
    balance: 'Head-heavy', flex: 'Stiff', playStyle: 'Power', weightMaxG: 88,
    tier: 'Premium', tensionMinLbs: 20, tensionMaxLbs: 28,
  },
};

const NO_CEILING = {
  ...FRAME, id: 'frame-unpublished',
  attributes: { ...FRAME.attributes, tensionMaxLbs: undefined },
};

const STRING = {
  id: 'string-test', category: 'string', brand: 'Yonex', model: 'BG Test',
  skillRange: [1, 5], msrp: 15,
  attributes: {
    stringType: 'Durability', gaugeMm: 0.7, repulsion: 5, durability: 10,
    control: 7, feel: 'Soft', feelScale: 2, skillLevel: 'Beginner',
    ratingSource: 'Brand published', priceSetUsdMin: 12, priceSetUsdMax: 14,
    tensionMinLbs: 19, tensionMaxLbs: 26,
  },
};

function seedMember(withRatings = true) {
  const store = getStore();
  store['members'] = [
    { id: 'm-lin', name: 'Lin', role: 'member', active: true, sessionCount: 0, createdAt: new Date().toISOString() },
  ];
  store['assessments'] = withRatings
    ? [{
        id: 'a-lin', memberId: 'm-lin', name: 'Lin', takenAt: '2026-06-01T00:00:00.000Z', overall: 3,
        ratings: [
          { skillKey: 'smashes', value: 4, source: 'self' },
          { skillKey: 'grip_deception', value: 4, source: 'self' },
          { skillKey: 'footwork_split_step', value: 3, source: 'self' },
        ],
      }]
    : [];
}

async function seedCatalog(frame: unknown = FRAME) {
  const catalog = getContainer('equipmentCatalog');
  await catalog.items.upsert(frame);
  await catalog.items.upsert(STRING);
}

async function seedGear(catalogId: string | null) {
  await getContainer('playerGear').items.upsert({
    id: 'gear-m-lin', memberId: 'm-lin',
    items: [{ id: 'g1', catalogId, category: 'racket', label: 'Astrox Test' }],
    activeRacketId: 'g1', playFormat: 'doubles',
    updatedAt: new Date().toISOString(),
  });
}

const ask = (cat = 'string') =>
  GET(makeGetRequest(`http://localhost:3000/api/recommend?name=Lin&category=${cat}`, true));

describe('GET /api/recommend?category=string', () => {
  beforeEach(async () => {
    resetMockStore();
    __resetCatalogSeedForTests();
    setupAdminPin();
    process.env.NEXT_PUBLIC_FLAG_VALUE_HUB_SLICE = 'true';
    process.env.NEXT_PUBLIC_FLAG_RACKET_RECOMMENDER = 'true';
  });

  afterEach(() => {
    delete process.env.NEXT_PUBLIC_FLAG_VALUE_HUB_SLICE;
    delete process.env.NEXT_PUBLIC_FLAG_RACKET_RECOMMENDER;
  });

  it('pairs against the racket the member actually owns', async () => {
    seedMember();
    await seedCatalog();
    await seedGear('frame-hh');

    const body = await (await ask()).json();
    expect(body.item?.category).toBe('string');
    expect(body.pairedWith).toEqual({ label: 'Yonex Astrox Test', source: 'owned' });
    expect(typeof body.tensionLbs).toBe('number');
  });

  it('falls back to the recommended racket, and says so', async () => {
    seedMember();
    await seedCatalog();
    // No gear doc at all — nothing owned to pair against.

    const body = await (await ask()).json();
    expect(body.item?.category).toBe('string');
    expect(body.pairedWith?.source).toBe('recommended');
  });

  it('treats a free-text racket as nothing to pair against', async () => {
    // catalogId null is a legacy row or the dev fixture: a label, with no
    // attributes behind it. It cannot be paired against, so it falls to rung 2.
    seedMember();
    await seedCatalog();
    await seedGear(null);

    const body = await (await ask()).json();
    expect(body.pairedWith?.source).toBe('recommended');
  });

  it('asks for a check-in rather than pairing against a guess', async () => {
    seedMember(false);
    await seedCatalog();

    const body = await (await ask()).json();
    expect(body.needsCheckIn).toBe(true);
    expect(body.item).toBeNull();
  });

  it('returns a null tension for a frame with no published ceiling', async () => {
    seedMember();
    await seedCatalog(NO_CEILING);
    await seedGear('frame-unpublished');

    const body = await (await ask()).json();
    expect(body.item?.category).toBe('string');
    expect(body.pairedWith?.label).toBe('Yonex Astrox Test');
    expect(body.tensionLbs).toBeNull();
    expect(body.reasons.join(' ')).toMatch(/ceiling unpublished/i);
  });

  it('still refuses an anonymous caller', async () => {
    seedMember();
    await seedCatalog();
    const res = await GET(
      makeGetRequest('http://localhost:3000/api/recommend?name=Lin&category=string', false),
    );
    expect(res.status).toBe(403);
  });
});
