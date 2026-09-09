import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { GET } from '@/app/api/recommend/route';
import { getContainer, ensureContainer } from '@/lib/cosmos';
import { __resetCatalogSeedForTests } from '@/lib/catalogSeed';
import { _resetCalibrationCache } from '@/lib/levelStore';
import { FIT_ENGINE_VERSION } from '@/lib/racketFit';
import { resetMockStore, getStore, seedMember, seedAdminMember, setupAdminPin, makeRequest, makeAdminRequest, memberCookieValue } from './helpers';

/**
 * `GET /api/recommend` with `NEXT_PUBLIC_FLAG_RACKET_FIT` on — the fit engine
 * behind the racket branch. The catalog is the REAL seed (`ensureCatalogSeeded`
 * fills the mock from `scripts/data/equipment-catalog.json`), so ids here are
 * real ids and a wrong one fails rather than passing vacuously.
 */
const BASE = 'http://localhost:3000/api/recommend';
const ASTROX = 'racket-yonex-astrox-88d-pro';
const cookie = { Cookie: `member_session=${memberCookieValue('Lin')}` };
const ask = (category = 'racket') => GET(makeRequest('GET', `${BASE}?name=Lin&category=${category}`, undefined, cookie));

async function seedGear(doc: Record<string, unknown>) {
  await ensureContainer('playerGear', '/memberId');
  await getContainer('playerGear').items.upsert({ id: 'gear-member-lin', memberId: 'member-lin', items: [], updatedAt: '2026-09-01', ...doc });
}
async function seedRatings(ratings: Array<{ skillKey: string; value: number }>) {
  await ensureContainer('assessments', '/memberId');
  await getContainer('assessments').items.upsert({ id: 'a-lin', memberId: 'member-lin', name: 'Lin', takenAt: '2026-09-01T00:00:00Z', ratings });
}
const THREE_RATINGS = [{ skillKey: 'smashes', value: 4 }, { skillKey: 'clears_lifts', value: 4 }, { skillKey: 'drives', value: 3 }];

describe('GET /api/recommend — the fit engine', () => {
  beforeEach(() => {
    resetMockStore();
    __resetCatalogSeedForTests();
    _resetCalibrationCache();
    setupAdminPin();
    process.env.NEXT_PUBLIC_FLAG_VALUE_HUB_SLICE = 'true';
    process.env.NEXT_PUBLIC_FLAG_GEAR_RECOMMENDER = 'true';
    process.env.NEXT_PUBLIC_FLAG_RACKET_FIT = 'true';
    seedMember('Lin', { id: 'member-lin' });
  });
  afterAll(() => {
    delete process.env.NEXT_PUBLIC_FLAG_VALUE_HUB_SLICE;
    delete process.env.NEXT_PUBLIC_FLAG_GEAR_RECOMMENDER;
    delete process.env.NEXT_PUBLIC_FLAG_RACKET_FIT;
  });

  it('still 403s without the member cookie — reasons quote the member', async () => {
    const res = await GET(makeRequest('GET', `${BASE}?name=Lin`));
    expect(res.status).toBe(403);
  });

  it('answers needsFit, not needsCheckIn, when there is no racket, no check-in and no fit answers', async () => {
    const body = await (await ask()).json();
    expect(body).toMatchObject({ item: null, needsFit: true, fitState: 'needsFit', engineVersion: FIT_ENGINE_VERSION });
    expect(body.needsCheckIn).toBeUndefined();
  });

  it('anchors on the active racket, excludes it, and returns a pick with keys, English, and two alternatives', async () => {
    await seedGear({
      items: [{ id: 'i1', catalogId: ASTROX, category: 'racket', label: 'Yonex Astrox 88D Pro' }],
      activeRacketId: 'i1', playFormat: 'doubles', fitGoal: 'more_power', fitSwing: 'fast',
    });
    const body = await (await ask()).json();
    expect(body.fitState).toBe('anchored');
    expect(body.engineVersion).toBe(FIT_ENGINE_VERSION);
    expect(body.item.id).not.toBe(ASTROX);
    expect(body.item.category).toBe('racket');
    expect(Array.isArray(body.reasonKeys)).toBe(true);
    expect(body.reasonKeys.length).toBeGreaterThan(0);
    // The English strings are the keys rendered, in the same order, with the club line allowed last.
    expect(typeof body.reason).toBe('string');
    expect(body.reasons[0]).not.toMatch(/^reason\./);
    expect(body.alternatives).toHaveLength(2);
    for (const alt of body.alternatives) {
      expect(alt.item.id).not.toBe(ASTROX);
      expect(alt.item.id).not.toBe(body.item.id);
      expect(alt.differsBy.length).toBeGreaterThan(0);
      expect(alt.differsByText.length).toBe(alt.differsBy.length);
    }
  });

  it('excludes a free-text racket by its label, and pairs from the fit answers alone when it is the only racket', async () => {
    await seedGear({
      items: [{ id: 'i1', catalogId: null, category: 'racket', label: 'Yonex Astrox 88D Pro' }],
      activeRacketId: 'i1', fitGoal: 'faster', fitSwing: 'medium',
    });
    const body = await (await ask()).json();
    expect(body.fitState).toBe('unanchored');
    expect(body.item.id).not.toBe(ASTROX);
    expect(body.reasonKeys[0]).toEqual({ key: 'reason.unanchored' });
  });

  it('a check-in alone gives a level-only pick; a check-in with an anchor and no goal is anchored_default', async () => {
    await seedRatings(THREE_RATINGS);
    let body = await (await ask()).json();
    expect(body.fitState).toBe('level_only');
    expect(body.reasonKeys[0]).toEqual({ key: 'reason.levelOnly' });

    await seedGear({ items: [{ id: 'i1', catalogId: ASTROX, category: 'racket', label: 'Yonex Astrox 88D Pro' }], activeRacketId: 'i1' });
    body = await (await ask()).json();
    expect(body.fitState).toBe('anchored_default');
    expect(body.reasonKeys[0]).toEqual({ key: 'reason.anchoredDefault', params: { model: 'Astrox 88D Pro' } });
  });

  it('a sore arm shows up as warnings, never as a hidden row', async () => {
    await seedGear({
      items: [{ id: 'i1', catalogId: ASTROX, category: 'racket', label: 'Yonex Astrox 88D Pro' }],
      activeRacketId: 'i1', fitGoal: 'happy', fitSwing: 'fast', fitArmComfort: 'often_sore',
    });
    const body = await (await ask()).json();
    // 'happy' next to a Stiff head-heavy anchor targets stiff + head-heavy, which a
    // sore arm caps — so the winner is one the ceilings allow, and any warned
    // rows still rank behind it rather than vanishing.
    expect(body.item).toBeTruthy();
    expect(Array.isArray(body.warningKeys)).toBe(true);
    expect(Array.isArray(body.warnings)).toBe(true);
    expect(body.warnings.length).toBe(body.warningKeys.length);
  });

  it('the string branch keeps needsCheckIn without ratings, and pairs against the FIT pick when no racket is owned', async () => {
    await seedGear({ fitGoal: 'faster', fitSwing: 'fast' });
    let body = await (await ask('string')).json();
    expect(body.needsCheckIn).toBe(true);

    await seedRatings(THREE_RATINGS);
    body = await (await ask('string')).json();
    expect(body.item?.category).toBe('string');
    expect(body.pairedWith?.source).toBe('recommended');
  });

  it('writes ONE pick_served per fit pick, for the owner only — an admin browsing writes nothing', async () => {
    await seedRatings(THREE_RATINGS);
    await (await ask()).json();
    const served = (getStore().events ?? []).filter((e) => (e as { kind?: string }).kind === 'pick_served') as Array<Record<string, unknown>>;
    expect(served).toHaveLength(1);
    expect(served[0]).toMatchObject({ memberId: 'member-lin', engineVersion: FIT_ENGINE_VERSION, category: 'racket' });
    expect(typeof served[0].catalogId).toBe('string');

    seedAdminMember();
    await (await GET(makeAdminRequest('GET', `${BASE}?name=Lin&category=racket`))).json();
    expect((getStore().events ?? []).filter((e) => (e as { kind?: string }).kind === 'pick_served')).toHaveLength(1);
  });

  it('with the fit flag OFF the racket branch is the old shape — no fitState, no alternatives', async () => {
    process.env.NEXT_PUBLIC_FLAG_RACKET_FIT = 'false';
    await seedRatings(THREE_RATINGS);
    const body = await (await ask()).json();
    expect(body.item).toBeTruthy();
    expect(body.fitState).toBeUndefined();
    expect(body.alternatives).toBeUndefined();
    expect(body.reasonKeys).toBeUndefined();
    // And no ratings → the old needsCheckIn, not needsFit.
    resetMockStore(); __resetCatalogSeedForTests(); setupAdminPin(); seedMember('Lin', { id: 'member-lin' });
    const empty = await (await ask()).json();
    expect(empty.needsCheckIn).toBe(true);
    expect(empty.needsFit).toBeUndefined();
  });
});
