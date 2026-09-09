import { describe, it, expect, beforeEach } from 'vitest';
import { GET } from '@/app/api/admin/fit-preview/route';
import { getContainer, ensureContainer } from '@/lib/cosmos';
import { __resetCatalogSeedForTests } from '@/lib/catalogSeed';
import { resetMockStore, seedMember, seedAdminMember, setupAdminPin, makeGetRequest } from './helpers';

/**
 * The admin read the golden set is checked and drafted against. Read-only,
 * admin-only, anonymised: the skeleton it prints carries no names.
 */
const URL_BASE = 'http://localhost/bpm/api/admin/fit-preview';
const ASTROX = 'racket-yonex-astrox-88d-pro';

describe('GET /api/admin/fit-preview', () => {
  beforeEach(async () => {
    resetMockStore();
    __resetCatalogSeedForTests();
    setupAdminPin();
    seedAdminMember();
    process.env.NEXT_PUBLIC_FLAG_VALUE_HUB_SLICE = 'true';
    seedMember('Lin', { id: 'member-lin' });
    await ensureContainer('playerGear', '/memberId');
    await getContainer('playerGear').items.upsert({
      id: 'gear-member-lin', memberId: 'member-lin', updatedAt: '2026-09-01',
      items: [{ id: 'i1', catalogId: ASTROX, category: 'racket', label: 'Yonex Astrox 88D Pro' }],
      activeRacketId: 'i1', playFormat: 'doubles', fitGoal: 'more_power', fitSwing: 'fast',
    });
  });

  it('refuses without an admin cookie', async () => {
    expect((await GET(makeGetRequest(`${URL_BASE}?memberId=member-lin`))).status).toBe(401);
  });

  it('answers one member with the engine\'s top three and fitState, no reason text', async () => {
    const body = await (await GET(makeGetRequest(`${URL_BASE}?memberId=member-lin`, true))).json();
    expect(body.fitState).toBe('anchored');
    expect(body.top3).toHaveLength(3);
    expect(body.top3).not.toContain(ASTROX);
    expect(body).not.toHaveProperty('reasons');
  });

  it('with no member, prints anonymised golden-set skeletons — ids gNN, no names, acceptable empty', async () => {
    const body = await (await GET(makeGetRequest(URL_BASE, true))).json();
    expect(body.cases).toHaveLength(1);
    const c = body.cases[0];
    expect(c.id).toBe('g01');
    expect(JSON.stringify(c)).not.toMatch(/Lin|member-lin/);
    expect(c.gear.activeCatalogId).toBe(ASTROX);
    expect(c.gear.fitGoal).toBe('more_power');
    expect(c.acceptable).toEqual([]);
    expect(c.ratedBy).toBe('');
  });
});
