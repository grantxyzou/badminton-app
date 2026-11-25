// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { GET } from '@/app/api/recommend/route';
import { NextRequest } from 'next/server';
import * as cosmos from '@/lib/cosmos';
import { __resetCatalogSeedForTests } from '@/lib/catalogSeed';
import { resetMockStore, getStore, seedMember, setupAdminPin, makeRequest, memberCookieValue } from './helpers';

describe('GET /api/recommend rate limit', () => {
  beforeEach(() => {
    resetMockStore();
    setupAdminPin();
  });

  it('allows 30 calls a minute from one IP, then throttles', async () => {
    const fixed = () => new NextRequest(new URL('/api/recommend?name=Anon', 'http://localhost/bpm'), {
      headers: { 'x-client-ip': `rec-burst-${process.pid}` },
    });
    for (let i = 0; i < 30; i++) {
      const body = await (await GET(fixed())).json();
      expect(body.unavailable ?? body.needsCheckIn ?? body.item ?? body.error).toBeDefined();
    }
    expect(await (await GET(fixed())).json()).toEqual({ item: null });
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

describe('/api/recommend', () => {
  beforeEach(() => {
    resetMockStore();
    // resetMockStore() wipes the store, but ensureCatalogSeeded caches its
    // "already seeded" promise at module scope — without this reset, tests
    // after the first would skip reseeding into the now-empty store.
    __resetCatalogSeedForTests();
    setupAdminPin();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // D8: reasons quote private per-skill ratings, so this must not be public.
  it('401s without a member cookie, so skill ratings cannot be probed by name', async () => {
    seedMember('Lin');
    const res = await GET(makeRequest('GET', `${BASE}?name=Lin`));
    // Refused at the members-only read gate, before the ownership check (403).
    expect(res.status).toBe(401);
  });

  it('403s when the member cookie belongs to someone else', async () => {
    seedMember('Lin');
    seedMember('Viktor'); // a real, active member — so the read gate passes and the ownership check answers
    const res = await GET(getAs('Lin', 'Viktor'));
    expect(res.status).toBe(403);
  });

  it('returns needsFit rather than guessing when there is no assessment, racket or fit answer', async () => {
    seedMember('Lin');
    const body = await (await GET(getAs('Lin'))).json();
    expect(body.needsFit).toBe(true);
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
    expect(Array.isArray(body.reasonKeys)).toBe(true);
    expect(body.reasonKeys.length).toBeGreaterThan(0);
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
