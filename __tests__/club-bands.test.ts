import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { GET } from '../app/api/stats/club/bands/route';
import { resetMockStore, setupAdminPin, seedMember, makeRequest, memberCookieValue, getStore } from './helpers';
import { median, bandFor, computeClubBands, MIN_COHORT } from '../lib/clubBands';
import { SKILLS, type Rating } from '../lib/assessment';

const URL_BASE = 'http://localhost:3000/api/stats/club/bands';

describe('clubBands — median', () => {
  it('returns null for an empty list', () => {
    expect(median([])).toBeNull();
  });
  it('takes the middle of an odd-length list', () => {
    expect(median([3, 1, 2])).toBe(2);
  });
  it('averages the middle pair of an even-length list', () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });
});

describe('clubBands — bandFor', () => {
  it('puts a clear high value in the top third', () => {
    expect(bandFor(5, [1, 1, 2, 2, 3])).toBe('top');
  });
  it('puts a clear low value in the bottom third', () => {
    expect(bandFor(1, [3, 3, 4, 4, 5])).toBe('bottom');
  });
  it('puts a middling value in the middle', () => {
    expect(bandFor(3, [1, 2, 3, 4, 5])).toBe('middle');
  });

  // Ratings are a 1-5 integer scale, so ties are the common case. A tertile
  // cut-point comparison mishandles them; the mid-rank convention does not.
  it('calls a value tied with EVERYONE middle, not top', () => {
    expect(bandFor(3, [3, 3, 3, 3, 3])).toBe('middle');
  });

  it('is stable when the whole cohort is below', () => {
    expect(bandFor(4, [1, 1, 1, 1, 1])).toBe('top');
  });

  it('defaults to middle with no cohort rather than inventing a rank', () => {
    expect(bandFor(3, [])).toBe('middle');
  });
});

function ratings(map: Record<string, number>): Rating[] {
  return Object.entries(map).map(([skillKey, value]) => ({ skillKey, value }));
}

const TECH = SKILLS.filter((s) => s.dimension === 'technical').map((s) => s.key);

describe('clubBands — computeClubBands', () => {
  it('withholds everything below the cohort minimum', () => {
    const out = computeClubBands({
      viewer: ratings({ [TECH[0]]: 4 }),
      others: [ratings({ [TECH[0]]: 2 }), ratings({ [TECH[0]]: 3 })],
    });
    expect(out.cohort).toBe(2);
    expect(out.skills).toEqual([]);
    expect(out.dimensionMedians.technical).toBeNull();
  });

  it('still reports the cohort size when below the minimum', () => {
    // The client needs "too few people" to be distinguishable from "failed".
    const out = computeClubBands({ viewer: [], others: [ratings({ [TECH[0]]: 3 })] });
    expect(out.cohort).toBe(1);
    expect(out.minCohort).toBe(MIN_COHORT);
  });

  it('bands a skill once enough others have rated it', () => {
    const out = computeClubBands({
      viewer: ratings({ [TECH[0]]: 5 }),
      others: [1, 1, 2, 2, 3].map((v) => ratings({ [TECH[0]]: v })),
    });
    expect(out.skills).toEqual([{ skillKey: TECH[0], band: 'top' }]);
  });

  it('skips a skill too few others rated, even when the overall cohort is fine', () => {
    // A member may have rated 14 skills while only two others rated this one.
    const rare = TECH[1];
    const out = computeClubBands({
      viewer: ratings({ [TECH[0]]: 3, [rare]: 5 }),
      others: [
        ratings({ [TECH[0]]: 2, [rare]: 1 }),
        ratings({ [TECH[0]]: 2, [rare]: 2 }),
        ratings({ [TECH[0]]: 3 }),
        ratings({ [TECH[0]]: 4 }),
        ratings({ [TECH[0]]: 5 }),
      ],
    });
    expect(out.skills.some((s) => s.skillKey === TECH[0])).toBe(true);
    expect(out.skills.some((s) => s.skillKey === rare)).toBe(false);
  });

  it('never bands a skill the viewer has not rated', () => {
    const out = computeClubBands({
      viewer: ratings({ [TECH[0]]: 3 }),
      others: [1, 2, 3, 4, 5].map((v) => ratings({ [TECH[0]]: v, [TECH[1]]: v })),
    });
    expect(out.skills.some((s) => s.skillKey === TECH[1])).toBe(false);
  });

  it('computes a dimension median from the cohort', () => {
    const others = [1, 2, 3, 4, 5].map((v) =>
      ratings(Object.fromEntries(TECH.map((k) => [k, v]))),
    );
    const out = computeClubBands({ viewer: ratings({ [TECH[0]]: 3 }), others });
    expect(out.dimensionMedians.technical).toBe(3);
    // Nobody rated physical or mental — no median, not a zero.
    expect(out.dimensionMedians.physical).toBeNull();
  });
});

// ── Route ────────────────────────────────────────────────────────────────
function seedClub() {
  const store = getStore();
  store['assessments'] = [];
  // Viewer plus five others, all rating the same technical skill.
  const rows: [string, number, string][] = [
    ['member-lin', 4, '2026-08-01T00:00:00.000Z'],
    ['member-a', 1, '2026-08-01T00:00:00.000Z'],
    ['member-b', 1, '2026-08-01T00:00:00.000Z'],
    ['member-c', 2, '2026-08-01T00:00:00.000Z'],
    ['member-d', 2, '2026-08-01T00:00:00.000Z'],
    ['member-e', 3, '2026-08-01T00:00:00.000Z'],
  ];
  for (const [memberId, value, takenAt] of rows) {
    store['assessments'].push({
      id: `a-${memberId}`,
      memberId,
      takenAt,
      ratings: TECH.map((k) => ({ skillKey: k, value })),
      overall: value,
    });
  }
}

function getAs(name: string, cookieName = name) {
  return makeRequest('GET', `${URL_BASE}?name=${encodeURIComponent(name)}`, undefined, {
    Cookie: `member_session=${memberCookieValue(cookieName)}`,
  });
}

describe('GET /api/stats/club/bands', () => {
  beforeEach(() => {
    resetMockStore();
    setupAdminPin();
    process.env.NEXT_PUBLIC_FLAG_STATS_V2 = 'true';
  });
  afterAll(() => {
    delete process.env.NEXT_PUBLIC_FLAG_STATS_V2;
  });

  it('404s when the flag is off', async () => {
    delete process.env.NEXT_PUBLIC_FLAG_STATS_V2;
    const res = await GET(getAs('Lin'));
    expect(res.status).toBe(404);
    process.env.NEXT_PUBLIC_FLAG_STATS_V2 = 'true';
  });

  it('400s without a name', async () => {
    const res = await GET(makeRequest('GET', URL_BASE));
    expect(res.status).toBe(400);
  });

  it('403s without a cookie', async () => {
    seedMember('Lin');
    const res = await GET(makeRequest('GET', `${URL_BASE}?name=Lin`));
    expect(res.status).toBe(403);
  });

  it("403s with another member's cookie", async () => {
    seedMember('Lin');
    const res = await GET(getAs('Lin', 'Viktor'));
    expect(res.status).toBe(403);
  });

  it('returns the band once the member has answered the prompt', async () => {
    seedMember('Lin', {
      id: 'member-lin',
      statsPrivacy: { clubComparison: true, promptedAt: '2026-08-01T00:00:00.000Z' },
    });
    seedClub();
    const res = await GET(getAs('Lin'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.cohort).toBe(5);
    expect(body.skills.length).toBeGreaterThan(0);
    expect(body.skills[0].band).toBe('top');
  });

  // ── The consent invariant, server-side ─────────────────────────────────
  it('withholds skills from a member who has NOT been asked yet', async () => {
    // Default is clubComparison: true — the preference alone is not consent.
    seedMember('Lin', { id: 'member-lin' });
    seedClub();
    const res = await GET(getAs('Lin'));
    const body = await res.json();
    expect(body.skills).toEqual([]);
    // ...but the club spread is still there, so the consent sheet can show it.
    expect(body.dimensionMedians.technical).not.toBeNull();
  });

  it('withholds skills from a member who opted out', async () => {
    seedMember('Lin', {
      id: 'member-lin',
      statsPrivacy: { clubComparison: false, promptedAt: '2026-08-01T00:00:00.000Z' },
    });
    seedClub();
    const res = await GET(getAs('Lin'));
    const body = await res.json();
    expect(body.skills).toEqual([]);
  });

  it('keeps the club spread visible when a member opts out — opting out is not reciprocal', async () => {
    seedMember('Lin', {
      id: 'member-lin',
      statsPrivacy: { clubComparison: false, promptedAt: '2026-08-01T00:00:00.000Z' },
    });
    seedClub();
    const res = await GET(getAs('Lin'));
    const body = await res.json();
    expect(body.dimensionMedians.technical).not.toBeNull();
  });

  it('reports a small cohort rather than failing', async () => {
    seedMember('Lin', {
      id: 'member-lin',
      statsPrivacy: { clubComparison: true, promptedAt: '2026-08-01T00:00:00.000Z' },
    });
    const store = getStore();
    store['assessments'] = [
      { id: 'a1', memberId: 'member-lin', takenAt: '2026-08-01T00:00:00.000Z', ratings: [{ skillKey: TECH[0], value: 4 }] },
      { id: 'a2', memberId: 'member-x', takenAt: '2026-08-01T00:00:00.000Z', ratings: [{ skillKey: TECH[0], value: 2 }] },
    ];
    const res = await GET(getAs('Lin'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.cohort).toBe(1);
    expect(body.skills).toEqual([]);
    expect(body.minCohort).toBe(MIN_COHORT);
  });

  it('uses only the LATEST snapshot per member', async () => {
    seedMember('Lin', {
      id: 'member-lin',
      statsPrivacy: { clubComparison: true, promptedAt: '2026-08-01T00:00:00.000Z' },
    });
    seedClub();
    const store = getStore();
    // An older, much stronger snapshot for the viewer must be ignored.
    store['assessments'].push({
      id: 'a-lin-old',
      memberId: 'member-lin',
      takenAt: '2020-01-01T00:00:00.000Z',
      ratings: TECH.map((k) => ({ skillKey: k, value: 1 })),
    });
    const res = await GET(getAs('Lin'));
    const body = await res.json();
    expect(body.skills[0].band).toBe('top');
  });
});
