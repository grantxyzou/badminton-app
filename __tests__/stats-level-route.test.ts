import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { GET } from '../app/api/stats/level/route';
import { _resetCalibrationCache } from '../lib/levelStore';
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

function seedAssessment(memberId: string, name: string, overall: number, takenAt: string) {
  const store = getStore();
  if (!store['assessments']) store['assessments'] = [];
  store['assessments'].push({ id: `a-${Math.random().toString(36).slice(2)}`, memberId, name, overall, takenAt });
}

function seedGame(teamA: string[], teamB: string[], scoreA: number, scoreB: number, loggedAt: string) {
  const store = getStore();
  if (!store['gameResults']) store['gameResults'] = [];
  store['gameResults'].push({
    id: `g-${Math.random().toString(36).slice(2)}`, sessionId: 'session-x', teamA, teamB, scoreA, scoreB, loggedAt,
  });
}

describe('/api/stats/level', () => {
  beforeEach(() => {
    resetMockStore();
    setupAdminPin();
    _resetCalibrationCache();
    process.env.NEXT_PUBLIC_FLAG_SKILL_LEVEL = 'true';
  });
  afterAll(() => {
    delete process.env.NEXT_PUBLIC_FLAG_SKILL_LEVEL;
    delete process.env.NEXT_PUBLIC_FLAG_SKILL_CALIBRATION;
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
    seedAssessment(m.id, 'Lin', 3.0, '2026-06-01T00:00:00.000Z');
    const res = await GET(getAs('Lin'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.level.level).toBe(3.0);
    expect(body.level.phase).toBe('switch');
  });

  it('lets an admin browse another player without a member cookie', async () => {
    const m = seedMember('Viktor');
    seedAssessment(m.id, 'Viktor', 4.5, '2026-06-01T00:00:00.000Z');
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

  describe('with game calibration on (Phase 2)', () => {
    beforeEach(() => {
      process.env.NEXT_PUBLIC_FLAG_SKILL_CALIBRATION = 'true';
    });

    it('lights up basis.game and an "above" blind spot when games outrun the self-rating', async () => {
      const m = seedMember('Lin');
      seedAssessment(m.id, 'Lin', 3.0, '2026-06-01T00:00:00.000Z');
      // 10 decisive wins over a default-seeded opponent → observed climbs above 3.0.
      for (let i = 0; i < 10; i++) {
        seedGame(['Lin'], ['Bob'], 21, 11, `2026-06-${String(2 + i).padStart(2, '0')}T00:00:00.000Z`);
      }
      const body = await (await GET(getAs('Lin'))).json();
      expect(body.level.basis.game).not.toBeNull();
      expect(body.level.basis.game).toBeGreaterThan(3.0);
      expect(body.level.blindSpot?.direction).toBe('above');
      // Headline level is blended (self anchors it), so it sits between self and observed.
      expect(body.level.level).toBeGreaterThan(3.0);
      expect(body.level.level).toBeLessThan(body.level.basis.game);
    });

    // ── Issue #250: calibration seeds are joined by lowercased NAME, but
    // assessment docs are written under a `name:<lower>` subject when the
    // person is not a member. Without a guard, a document nobody had to
    // authenticate to write anchors a real member's calibration.
    //
    // #249 closed the write path for names that ARE members. These cases
    // cover the half it deliberately left open.

    it('a non-member assessment for a member’s name must not seed that member’s calibration', async () => {
      const m = seedMember('Lin');
      seedAssessment(m.id, 'Lin', 3.0, '2026-06-01T00:00:00.000Z');
      // Written under the unguarded name-derived subject, not Lin's memberId.
      // Same name, so the name-keyed seed join picks it up.
      seedAssessment('name:lin', 'Lin', 1.0, '2026-06-02T00:00:00.000Z');
      for (let i = 0; i < 10; i++) {
        seedGame(['Lin'], ['Bob'], 21, 11, `2026-06-${String(3 + i).padStart(2, '0')}T00:00:00.000Z`);
      }
      const body = await (await GET(getAs('Lin'))).json();
      // Lin won every game against a default-seeded opponent, so the observed
      // level must sit ABOVE her 3.0 self-rating. A 1.0 seed injected by the
      // name-derived doc drags it below.
      expect(body.level.basis.game).toBeGreaterThan(3.0);
    });

    it('a non-member’s own seed must not shift a member’s observed level through the shared fold', async () => {
      const m = seedMember('Lin');
      seedAssessment(m.id, 'Lin', 3.0, '2026-06-01T00:00:00.000Z');
      for (let i = 0; i < 10; i++) {
        seedGame(['Lin'], ['Bob'], 21, 11, `2026-06-${String(3 + i).padStart(2, '0')}T00:00:00.000Z`);
      }
      const clean = await (await GET(getAs('Lin'))).json();

      // Same world, plus an unauthenticated seed for Bob — who is not a member
      // but does appear in gameResults. The fold is group-wide, so inflating
      // Bob's anchor moves what beating him is worth.
      resetMockStore();
      setupAdminPin();
      _resetCalibrationCache();
      const m2 = seedMember('Lin');
      seedAssessment(m2.id, 'Lin', 3.0, '2026-06-01T00:00:00.000Z');
      seedAssessment('name:bob', 'Bob', 5.0, '2026-06-02T00:00:00.000Z');
      for (let i = 0; i < 10; i++) {
        seedGame(['Lin'], ['Bob'], 21, 11, `2026-06-${String(3 + i).padStart(2, '0')}T00:00:00.000Z`);
      }
      const poisoned = await (await GET(getAs('Lin'))).json();

      expect(poisoned.level.basis.game).toBe(clean.level.basis.game);
    });

    it('still lets a real member’s own assessment seed the fold', async () => {
      // The guard must exclude name-derived subjects ONLY — a member's own
      // seed is the whole point of the anchor and must keep working.
      const m = seedMember('Lin');
      seedAssessment(m.id, 'Lin', 5.0, '2026-06-01T00:00:00.000Z');
      seedGame(['Lin'], ['Bob'], 21, 19, '2026-06-05T00:00:00.000Z');
      const body = await (await GET(getAs('Lin'))).json();
      // Seeded at 5.0 and barely beat a default-seeded opponent: the observed
      // level stays high because the seed anchored it, not at DEFAULT_SEED.
      expect(body.level.basis.game).toBeGreaterThan(4.0);
    });

    it('leaves basis.game null when the calibration flag is off', async () => {
      process.env.NEXT_PUBLIC_FLAG_SKILL_CALIBRATION = 'false';
      const m = seedMember('Lin');
      seedAssessment(m.id, 'Lin', 3.0, '2026-06-01T00:00:00.000Z');
      seedGame(['Lin'], ['Bob'], 21, 5, '2026-06-05T00:00:00.000Z');
      const body = await (await GET(getAs('Lin'))).json();
      expect(body.level.basis.game).toBeNull();
      expect(body.level.level).toBe(3.0);
    });
  });
});
