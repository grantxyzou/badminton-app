// @vitest-environment node
import { describe, it, expect, beforeEach, afterAll, afterEach, vi } from 'vitest';
import { GET } from '@/app/api/recommend/route';
import { NextRequest } from 'next/server';
import * as cosmos from '@/lib/cosmos';
import { getContainer, ensureContainer } from '@/lib/cosmos';
import { _resetCalibrationCache } from '@/lib/levelStore';
import { __resetCatalogSeedForTests } from '@/lib/catalogSeed';
import { resetMockStore, getStore, seedMember, setupAdminPin, makeRequest, memberCookieValue } from './helpers';

// Unique IP per request — recommend is rate-limited 10/min; convention per helpers.ts.
function get(url: string): NextRequest {
  return new NextRequest(new URL(url, 'http://localhost/bpm'), {
    headers: { 'x-client-ip': `rec-${Math.random()}` },
  });
}

async function seedAssessment(memberId: string, name: string, overall: number) {
  await ensureContainer('assessments', '/memberId');
  await getContainer('assessments').items.upsert({
    id: `a-${memberId}`,
    memberId,
    name,
    takenAt: '2026-06-01T00:00:00Z',
    overall,
    ratings: [],
  });
}

describe('GET /api/recommend (flag-off / legacy stage-derived pick)', () => {
  beforeEach(async () => {
    resetMockStore();
    // Deliberately NOT resetting the catalog-seed cache here: after the first
    // test in this describe seeds it once, later tests rely on subsequent
    // calls being a no-op so the store (reset to just the 3 manually-upserted
    // fixture rackets below) stays uncontaminated by the full curated catalog.
    _resetCalibrationCache();
    process.env.NEXT_PUBLIC_FLAG_VALUE_HUB_SLICE = 'true';
    delete process.env.NEXT_PUBLIC_FLAG_GEAR_RECOMMENDER;
    delete process.env.NEXT_PUBLIC_FLAG_SKILL_CALIBRATION;
    delete process.env.NEXT_PUBLIC_FLAG_SKILL_SMOOTHING;
    const catalog = getContainer('equipmentCatalog');
    await catalog.items.upsert({ id: 'wide', category: 'racket', brand: 'Y', model: 'All-Round', skillRange: [1, 6], msrp: 120 });
    await catalog.items.upsert({ id: 'beg', category: 'racket', brand: 'Y', model: 'Starter', skillRange: [1, 2], msrp: 80 });
    await catalog.items.upsert({ id: 'adv', category: 'racket', brand: 'Y', model: 'Pro', skillRange: [5, 6], msrp: 220 });
  });

  it('returns an all-rounder for a member with no level signal at all', async () => {
    await getContainer('members').items.upsert({ id: 'm-anon', name: 'Anon', active: true });
    const res = await GET(get('/api/recommend?name=Anon'));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.item.id).toBe('wide');
    expect(typeof body.reason).toBe('string');
  });

  it('still honors a legacy Member.stage when there are no check-ins (back-compat)', async () => {
    await getContainer('members').items.upsert({ id: 'm-beg', name: 'Newbie', active: true, stage: 2 });
    const res = await GET(get('/api/recommend?name=Newbie'));
    const body = await res.json();
    expect(body.item.id).toBe('beg');
  });

  it('derives stage from self check-ins even when Member.stage is unset', async () => {
    // No stage on the member — only an assessment. Proves the rec no longer
    // depends on the legacy field: a 4.5 self-rating → stage ~5 → the Pro.
    await getContainer('members').items.upsert({ id: 'm-rated', name: 'Rated', active: true });
    await seedAssessment('m-rated', 'Rated', 4.5);
    const res = await GET(get('/api/recommend?name=Rated'));
    const body = await res.json();
    expect(body.item.id).toBe('adv');
  });

  it('lets game calibration lift the recommended stage when the flag is on', async () => {
    await getContainer('members').items.upsert({ id: 'm-climb', name: 'Climber', active: true });
    await seedAssessment('m-climb', 'Climber', 2.0); // self-only → stage 2 → the Starter
    await ensureContainer('gameResults', '/sessionId');
    const games = getContainer('gameResults');
    for (let i = 0; i < 12; i++) {
      await games.items.upsert({
        id: `g-${i}`, sessionId: 's', teamA: ['Climber'], teamB: ['Punching Bag'],
        scoreA: 21, scoreB: 5, loggedBy: 'Climber', loggedAt: `2026-06-${String(10 + i).padStart(2, '0')}T00:00:00Z`,
      });
    }

    // Flag OFF → self-only stage 2 → Starter.
    _resetCalibrationCache();
    const off = await (await GET(get('/api/recommend?name=Climber'))).json();
    expect(off.item.id).toBe('beg');

    // Flag ON → decisive wins lift the observed level → stage 3 → no longer the Starter.
    process.env.NEXT_PUBLIC_FLAG_SKILL_CALIBRATION = 'true';
    _resetCalibrationCache();
    const on = await (await GET(get('/api/recommend?name=Climber'))).json();
    expect(on.item.id).not.toBe('beg');
  });

  it('404s when the flag is off', async () => {
    process.env.NEXT_PUBLIC_FLAG_VALUE_HUB_SLICE = 'false';
    const res = await GET(get('/api/recommend?name=Anon'));
    expect(res.status).toBe(404);
  });
});

const BASE = 'http://localhost:3000/api/recommend';

function getAs(name: string, cookieName?: string) {
  return makeRequest('GET', `${BASE}?name=${encodeURIComponent(name)}`, undefined, {
    Cookie: `member_session=${memberCookieValue(cookieName ?? name)}`,
  });
}

function seedRatedAssessment(memberId: string, name: string, ratings: { skillKey: string; value: number }[]) {
  const store = getStore();
  if (!store['assessments']) store['assessments'] = [];
  store['assessments'].push({
    id: `a-${Math.random().toString(36).slice(2)}`, memberId, name,
    ratings: ratings.map((r) => ({ ...r, source: 'self' })),
    takenAt: '2026-06-01T00:00:00.000Z', overall: 3,
  });
}

describe('/api/recommend with the engine flag on', () => {
  beforeEach(() => {
    resetMockStore();
    // resetMockStore() wipes the store, but ensureCatalogSeeded caches its
    // "already seeded" promise at module scope — without this reset, tests
    // after the first would skip reseeding into the now-empty store.
    __resetCatalogSeedForTests();
    setupAdminPin();
    process.env.NEXT_PUBLIC_FLAG_VALUE_HUB_SLICE = 'true';
    process.env.NEXT_PUBLIC_FLAG_GEAR_RECOMMENDER = 'true';
  });
  afterAll(() => {
    delete process.env.NEXT_PUBLIC_FLAG_VALUE_HUB_SLICE;
    delete process.env.NEXT_PUBLIC_FLAG_GEAR_RECOMMENDER;
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // D8: reasons quote private per-skill ratings, so this must not be public.
  it('403s without a member cookie, so skill ratings cannot be probed by name', async () => {
    seedMember('Lin');
    const res = await GET(makeRequest('GET', `${BASE}?name=Lin`));
    expect(res.status).toBe(403);
  });

  it('403s when the member cookie belongs to someone else', async () => {
    seedMember('Lin');
    const res = await GET(getAs('Lin', 'Viktor'));
    expect(res.status).toBe(403);
  });

  it('returns needsCheckIn rather than guessing when there is no assessment', async () => {
    seedMember('Lin');
    const body = await (await GET(getAs('Lin'))).json();
    expect(body.needsCheckIn).toBe(true);
    expect(body.item).toBeNull();
  });

  it('returns a pick with reasons for a rated player', async () => {
    const m = seedMember('Lin');
    seedRatedAssessment(m.id, 'Lin', [
      { skillKey: 'smashes', value: 5 }, { skillKey: 'clears_lifts', value: 5 },
      { skillKey: 'drives', value: 1 }, { skillKey: 'net_play', value: 1 },
    ]);
    const body = await (await GET(getAs('Lin'))).json();
    expect(body.needsCheckIn).toBeFalsy();
    expect(body.item).toBeTruthy();
    expect(Array.isArray(body.reasons)).toBe(true);
    expect(body.reasons.length).toBeGreaterThan(0);
  });

  it('keeps the old public behaviour when the engine flag is off', async () => {
    process.env.NEXT_PUBLIC_FLAG_GEAR_RECOMMENDER = 'false';
    seedMember('Lin');
    const res = await GET(makeRequest('GET', `${BASE}?name=Lin`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.reasons).toBeUndefined();
  });

  // Controller override on the brief's sketch: a 404 gear read means "no gear
  // yet" and is fine to treat as null, but any OTHER failure must surface as
  // the route's 500 load_failed path rather than being swallowed into a lying
  // "no gear" — that would silently re-enable the recommend-a-racket-they-
  // already-own bug this feature exists to fix. Both branches of that
  // distinction are exercised here since the mock store's own `.item().read()`
  // never throws.
  it('surfaces a 500 when the gear read fails for a reason other than 404 (not a lying null)', async () => {
    seedMember('Lin');
    const realGetContainer = cosmos.getContainer;
    vi.spyOn(cosmos, 'getContainer').mockImplementation((name: string) => {
      if (name === 'playerGear') {
        return { item: () => ({ read: () => Promise.reject({ code: 500 }) }) } as unknown as ReturnType<typeof cosmos.getContainer>;
      }
      return realGetContainer(name);
    });
    const res = await GET(getAs('Lin'));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe('load_failed');
  });

  // resolveSubject (this route) must resolve to the exact same memberId as
  // resolveMemberId (app/api/equipment/gear/route.ts), or gear WRITTEN at
  // gear-<resolveMemberId> silently fails to be READ at gear-<resolveSubject>
  // whenever an admin rename leaves a stale same-name row behind (no
  // uniqueness constraint on Member.name). The inactive row is inserted
  // FIRST so an unfiltered "first match" query would wrongly pick it.
  it('resolves the same member id as resolveMemberId when a same-name inactive row exists', async () => {
    const inactive = seedMember('Dup', { active: false });
    const active = seedMember('Dup', { active: true });
    seedRatedAssessment(active.id, 'Dup', [
      { skillKey: 'smashes', value: 5 }, { skillKey: 'clears_lifts', value: 5 },
    ]);

    const realGetContainer = cosmos.getContainer;
    const gearReadIds: string[] = [];
    vi.spyOn(cosmos, 'getContainer').mockImplementation((name: string) => {
      const real = realGetContainer(name);
      if (name === 'playerGear') {
        return {
          ...real,
          item: (id: string, pk: string) => {
            gearReadIds.push(id);
            return real.item(id, pk);
          },
        } as unknown as ReturnType<typeof cosmos.getContainer>;
      }
      return real;
    });

    const res = await GET(getAs('Dup'));
    expect(res.status).toBe(200);
    // Same id resolveMemberId would compute for this name: gear-<active member id>.
    expect(gearReadIds).toEqual([`gear-${active.id}`]);
    expect(gearReadIds).not.toContain(`gear-${inactive.id}`);
  });

  it('treats a 404 gear read as "no gear yet" and still returns a pick', async () => {
    const m = seedMember('Lin');
    seedRatedAssessment(m.id, 'Lin', [
      { skillKey: 'smashes', value: 5 }, { skillKey: 'clears_lifts', value: 5 },
      { skillKey: 'drives', value: 1 }, { skillKey: 'net_play', value: 1 },
    ]);
    const realGetContainer = cosmos.getContainer;
    vi.spyOn(cosmos, 'getContainer').mockImplementation((name: string) => {
      if (name === 'playerGear') {
        return { item: () => ({ read: () => Promise.reject({ code: 404 }) }) } as unknown as ReturnType<typeof cosmos.getContainer>;
      }
      return realGetContainer(name);
    });
    const res = await GET(getAs('Lin'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.needsCheckIn).toBeFalsy();
    expect(body.item).toBeTruthy();
  });
});
