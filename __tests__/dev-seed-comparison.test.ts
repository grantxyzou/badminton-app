import { describe, it, expect, beforeAll, afterAll } from 'vitest';

/**
 * The dev seed must actually produce a VISIBLE club comparison and gear tally.
 *
 * Both surfaces are guarded by cohort minimums that hide them when there is
 * too little data — correctly, but the hidden state is indistinguishable from
 * a broken read when you are looking at localhost. Trimming the seeded cohort
 * from five members to four would silently switch the whole comparison off and
 * nothing else in the suite would notice.
 *
 * This runs the real routes against the real seeder rather than asserting my
 * arithmetic about tertiles, which is the part most likely to be wrong.
 */

const g = global as typeof globalThis & {
  _mockStore?: Record<string, unknown[]>;
  _devScenarioSeeded?: boolean;
};

describe('SEED_DEV_SCENARIO — comparison + tally are reachable', () => {
  let bandsBody: {
    cohort: number;
    minCohort: number;
    skills: { skillKey: string; band: string }[];
    dimensionMedians: Record<string, number | null>;
  };
  let gearBody: { minCohort: number; entries: { label: string; count: number }[] };

  beforeAll(async () => {
    delete process.env.COSMOS_CONNECTION_STRING;
    process.env.SEED_DEV_SCENARIO = 'fresh-thursday';
    process.env.NEXT_PUBLIC_FLAG_STATS_V2 = 'true';
    // Must be the SAME secret memberCookieValue signs with, or every request
    // 403s and the failure looks like missing seed data rather than auth.
    const { setupAdminPin } = await import('./helpers');
    setupAdminPin();
    g._mockStore = {};
    g._devScenarioSeeded = false;

    const { getContainer } = await import('../lib/cosmos');
    // First access triggers the scenario seeder.
    getContainer('members');

    // Lin has answered the prompt — the endpoint withholds bands otherwise,
    // which is the consent invariant, not a data problem.
    const members = g._mockStore!['members'] as { id: string; statsPrivacy?: unknown }[];
    const lin = members.find((m) => m.id === 'dev-member-lin')!;
    lin.statsPrivacy = { clubComparison: true, promptedAt: '2026-08-01T00:00:00.000Z' };

    const { makeRequest, memberCookieValue } = await import('./helpers');
    const { GET: BANDS } = await import('../app/api/stats/club/bands/route');
    const { GET: CLUB_GEAR } = await import('../app/api/stats/club/gear/route');

    const bandsRes = await BANDS(
      makeRequest('GET', 'http://localhost:3000/api/stats/club/bands?name=Lin', undefined, {
        Cookie: `member_session=${memberCookieValue('Lin')}`,
      }),
    );
    bandsBody = await bandsRes.json();

    const gearRes = await CLUB_GEAR(makeRequest('GET', 'http://localhost:3000/api/stats/club/gear'));
    gearBody = await gearRes.json();
  });

  afterAll(() => {
    delete process.env.SEED_DEV_SCENARIO;
    delete process.env.NEXT_PUBLIC_FLAG_STATS_V2;
    g._devScenarioSeeded = false;
    g._mockStore = {};
  });

  it('seeds exactly the minimum cohort, so the guard is exercised not bypassed', () => {
    expect(bandsBody.cohort).toBe(bandsBody.minCohort);
    expect(bandsBody.cohort).toBe(5);
  });

  it('produces real bands rather than an empty list', () => {
    expect(bandsBody.skills.length).toBeGreaterThan(0);
  });

  it('gives the median ticks three DIFFERENT positions, so the bars are worth looking at', () => {
    const { technical, physical, mental } = bandsBody.dimensionMedians;
    expect(technical).not.toBeNull();
    expect(physical).not.toBeNull();
    expect(mental).not.toBeNull();
    expect(new Set([technical, physical, mental]).size).toBe(3);
  });

  it("places Lin's sharpest and weakest skills in different bands", () => {
    // The card shows exactly these two, so two identical bands would make a
    // dull and slightly confusing demo.
    const byKey = new Map(bandsBody.skills.map((s) => [s.skillKey, s.band]));
    expect(byKey.get('serves_returns')).toBe('top');
    expect(byKey.get('net_play')).toBe('middle');
  });

  it('clears the gear tally threshold and ranks more than one entry', () => {
    expect(gearBody.entries.length).toBeGreaterThan(1);
    expect(gearBody.entries[0].count).toBeGreaterThanOrEqual(gearBody.minCohort);
    expect(gearBody.entries[0].count).toBeGreaterThan(gearBody.entries[1].count);
  });

  it('still never leaks a name through the tally', () => {
    expect(JSON.stringify(gearBody)).not.toMatch(/Lin|Viktor|dev-member/);
  });
});
