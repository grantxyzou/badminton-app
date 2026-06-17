import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { GET } from '../app/api/stats/drills/route';
import { _resetCalibrationCache } from '../lib/levelStore';
import {
  resetMockStore, getStore, seedMember, setupAdminPin, makeRequest, makeGetRequest, memberCookieValue,
} from './helpers';

const BASE = 'http://localhost:3000/api/stats/drills';

function getAs(name: string, cookieName?: string) {
  const cookie = `member_session=${memberCookieValue(cookieName ?? name)}`;
  return makeRequest('GET', `${BASE}?name=${encodeURIComponent(name)}`, undefined, { Cookie: cookie });
}

type Rating = { skillKey: string; value: number; source: 'self' };
function seedAssessment(memberId: string, name: string, ratings: Rating[], overall: number, takenAt: string) {
  const store = getStore();
  if (!store['assessments']) store['assessments'] = [];
  store['assessments'].push({ id: `a-${Math.random().toString(36).slice(2)}`, memberId, name, ratings, overall, takenAt });
}

// A spread of ratings whose three lowest are smashes(1), net_play(2), consistency(2).
const WEAK_RATINGS: Rating[] = [
  { skillKey: 'smashes', value: 1, source: 'self' },
  { skillKey: 'net_play', value: 2, source: 'self' },
  { skillKey: 'consistency', value: 2, source: 'self' },
  { skillKey: 'drives', value: 5, source: 'self' },
  { skillKey: 'footwork_split_step', value: 4, source: 'self' },
];

describe('/api/stats/drills', () => {
  beforeEach(() => {
    resetMockStore();
    setupAdminPin();
    _resetCalibrationCache();
    process.env.NEXT_PUBLIC_FLAG_SKILL_DRILLS = 'true';
  });
  afterAll(() => {
    delete process.env.NEXT_PUBLIC_FLAG_SKILL_DRILLS;
  });

  it('404s when the flag is off', async () => {
    process.env.NEXT_PUBLIC_FLAG_SKILL_DRILLS = 'false';
    const res = await GET(getAs('Lin'));
    expect(res.status).toBe(404);
  });

  it('400s when no name is supplied', async () => {
    const res = await GET(makeRequest('GET', BASE));
    expect(res.status).toBe(400);
  });

  it('403s without a member cookie (and not admin)', async () => {
    const res = await GET(makeRequest('GET', `${BASE}?name=Lin`));
    expect(res.status).toBe(403);
  });

  it('403s when the member cookie is for a different name', async () => {
    const res = await GET(getAs('Lin', 'Viktor'));
    expect(res.status).toBe(403);
  });

  it('returns drills for the owning member\'s weakest skills', async () => {
    const m = seedMember('Lin');
    seedAssessment(m.id, 'Lin', WEAK_RATINGS, 2.8, '2026-06-01T00:00:00.000Z');
    const res = await GET(getAs('Lin'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.drills)).toBe(true);
    expect(body.drills.length).toBeGreaterThan(0);
    expect(body.drills.length).toBeLessThanOrEqual(3);
    // The weakest skills drive the picks.
    const skillKeys = body.drills.map((d: { skillKey: string }) => d.skillKey);
    expect(skillKeys).toContain('smashes');
    expect(body.drills[0].reason).toMatch(/rated \d\/5/);
  });

  it('lets an admin browse another player without a member cookie', async () => {
    const m = seedMember('Viktor');
    seedAssessment(m.id, 'Viktor', WEAK_RATINGS, 2.8, '2026-06-01T00:00:00.000Z');
    const res = await GET(makeGetRequest(`${BASE}?name=Viktor`, true));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.drills.length).toBeGreaterThan(0);
  });

  it('returns an empty list for an owner with no check-ins yet', async () => {
    seedMember('Akane');
    const res = await GET(getAs('Akane'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.drills).toEqual([]);
  });
});
