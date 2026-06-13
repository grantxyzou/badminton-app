import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { GET } from '../app/api/stats/level/route';
import {
  resetMockStore, getStore, seedMember, setupAdminPin, makeRequest, makeGetRequest, memberCookieValue,
} from './helpers';

const BASE = 'http://localhost:3000/api/stats/level';

function getAs(name: string, cookieName?: string) {
  // A GET carrying a member_session cookie bound to `cookieName` (defaults to
  // the queried name → owns it).
  const cookie = `member_session=${memberCookieValue(cookieName ?? name)}`;
  return makeRequest('GET', `${BASE}?name=${encodeURIComponent(name)}`, undefined, { Cookie: cookie });
}

function seedAssessment(memberId: string, overall: number, takenAt: string) {
  const store = getStore();
  if (!store['assessments']) store['assessments'] = [];
  store['assessments'].push({ id: `a-${Math.random().toString(36).slice(2)}`, memberId, overall, takenAt });
}

describe('/api/stats/level', () => {
  beforeEach(() => {
    resetMockStore();
    setupAdminPin();
    process.env.NEXT_PUBLIC_FLAG_SKILL_LEVEL = 'true';
  });
  afterAll(() => {
    delete process.env.NEXT_PUBLIC_FLAG_SKILL_LEVEL;
  });

  it('404s when the flag is off', async () => {
    process.env.NEXT_PUBLIC_FLAG_SKILL_LEVEL = 'false';
    const res = await GET(getAs('Lin'));
    expect(res.status).toBe(404);
  });

  it('400s when no name is supplied', async () => {
    const res = await GET(makeRequest('GET', BASE));
    expect(res.status).toBe(400);
  });

  it('403s when there is no member cookie and the caller is not admin', async () => {
    const res = await GET(makeRequest('GET', `${BASE}?name=Lin`));
    expect(res.status).toBe(403);
  });

  it('403s when the member cookie is for a different name', async () => {
    const res = await GET(getAs('Lin', 'Viktor'));
    expect(res.status).toBe(403);
  });

  it('returns the level to the owning member (matching cookie)', async () => {
    const m = seedMember('Lin');
    seedAssessment(m.id, 3.0, '2026-06-01T00:00:00.000Z');
    const res = await GET(getAs('Lin'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.level.level).toBe(3.0);
    expect(body.level.phase).toBe('switch');
  });

  it('lets an admin browse another player without a member cookie', async () => {
    const m = seedMember('Viktor');
    seedAssessment(m.id, 4.5, '2026-06-01T00:00:00.000Z');
    const res = await GET(makeGetRequest(`${BASE}?name=Viktor`, true));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.level.level).toBe(4.5);
    expect(body.level.phase).toBe('advanced');
  });

  it('returns a null level (with a CTA) for an owner who has no check-ins yet', async () => {
    seedMember('Akane');
    const res = await GET(getAs('Akane'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.level.level).toBeNull();
    expect(body.level.explanation[0]).toMatch(/check-in/i);
  });

  it('resolves a non-member name via the name-fallback id (still owner-gated)', async () => {
    // No seeded member → subject id is name:ghost; the cookie for "Ghost" still
    // owns the name, so the gate passes and the level is null.
    const res = await GET(getAs('Ghost'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.level.level).toBeNull();
  });
});
