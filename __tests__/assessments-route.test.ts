import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { POST, GET } from '../app/api/assessments/route';
import {
  resetMockStore,
  getStore,
  seedMember,
  makeRequest,
  makeGetRequest,
  memberCookieValue,
  setupAdminPin,
  seedAdminMember,
  makeAdminRequest,
} from './helpers';

const BASE = 'http://localhost:3000/api/assessments';

function validRatings() {
  return [
    { skillKey: 'serves_returns', value: 4 },
    { skillKey: 'net_play', value: 2 },
    { skillKey: 'speed_stamina', value: 5 },
  ];
}

/** Cookie header for a valid member_session bound to the given member. */
function memberCookieHeader(name: string, memberId: string) {
  return { Cookie: `member_session=${memberCookieValue(name, memberId)}` };
}

describe('/api/assessments', () => {
  beforeEach(() => {
    resetMockStore();
    setupAdminPin();
    process.env.NEXT_PUBLIC_FLAG_SKILL_ASSESS = 'true';
  });

  afterAll(() => {
    delete process.env.NEXT_PUBLIC_FLAG_SKILL_ASSESS;
  });

  describe('POST', () => {
    it('404s when the flag is off', async () => {
      process.env.NEXT_PUBLIC_FLAG_SKILL_ASSESS = 'false';
      const res = await POST(makeRequest('POST', BASE, { name: 'Lin', ratings: validRatings() }));
      expect(res.status).toBe(404);
    });

    it('saves a snapshot with server-computed overall + phase and source:self', async () => {
      const member = seedMember('Lin');
      const res = await POST(
        makeRequest('POST', BASE, { name: 'Lin', ratings: validRatings() }, memberCookieHeader('Lin', member.id)),
      );
      expect(res.status).toBe(201);
      const doc = await res.json();
      expect(doc.name).toBe('Lin');
      expect(doc.overall).toBeCloseTo(11 / 3);
      expect(doc.dimensionScores.technical).toBe(3);
      expect(doc.dimensionScores.physical).toBe(5);
      expect(doc.dimensionScores.mental).toBeNull();
      expect(doc.phase).toBe('commitment'); // 3.67 → ≥3.4
      expect(doc.ratings.every((r: { source?: string }) => r.source === 'self')).toBe(true);
      expect(typeof doc.takenAt).toBe('string');
    });

    it('resolves memberId from the members container', async () => {
      const member = seedMember('Lin');
      const res = await POST(
        makeRequest('POST', BASE, { name: 'Lin', ratings: validRatings() }, memberCookieHeader('Lin', member.id)),
      );
      const doc = await res.json();
      expect(doc.memberId).toBe(member.id);
    });

    it('falls back to a name-derived id when the player is not a member', async () => {
      const res = await POST(makeRequest('POST', BASE, { name: 'Ghost', ratings: validRatings() }));
      const doc = await res.json();
      expect(doc.memberId).toBe('name:ghost');
    });

    it('400s when no valid ratings are supplied', async () => {
      const res = await POST(
        makeRequest('POST', BASE, { name: 'Lin', ratings: [{ skillKey: 'not_a_skill', value: 9 }] }),
      );
      expect(res.status).toBe(400);
    });

    it('400s when name is missing', async () => {
      const res = await POST(makeRequest('POST', BASE, { ratings: validRatings() }));
      expect(res.status).toBe(400);
    });

    it('ignores out-of-range and unknown ratings but keeps valid ones', async () => {
      const member = seedMember('Lin');
      const res = await POST(
        makeRequest(
          'POST',
          BASE,
          {
            name: 'Lin',
            ratings: [
              { skillKey: 'serves_returns', value: 4 },
              { skillKey: 'net_play', value: 99 }, // out of range — dropped
              { skillKey: 'bogus', value: 3 }, // unknown — dropped
            ],
          },
          memberCookieHeader('Lin', member.id),
        ),
      );
      const doc = await res.json();
      expect(doc.ratings).toHaveLength(1);
      expect(doc.overall).toBe(4);
    });
  });

  describe('POST auth (member-scoped writes)', () => {
    it('writes when the caller holds member_session for the target member', async () => {
      const member = seedMember('Lin');
      const res = await POST(
        makeRequest('POST', BASE, { name: 'Lin', ratings: validRatings() }, memberCookieHeader('Lin', member.id)),
      );
      expect(res.status).toBe(201);
    });

    it('writes for any member when the caller is admin', async () => {
      seedMember('Lin');
      seedAdminMember();
      const res = await POST(makeAdminRequest('POST', BASE, { name: 'Lin', ratings: validRatings() }));
      expect(res.status).toBe(201);
    });

    // Pins isAdminAuthedWithMember (async, re-reads the Member) over the cheap
    // sync isAdminAuthed (cookie signature/expiry only). Swapping to the sync
    // check would leave this green-before/401-after distinction unenforced:
    // a demoted-but-still-cookied admin would keep writing for anyone until
    // the 30-day cookie expired, defeating the whole point of WS#3.
    it('401s an admin whose cookie is valid but who has been demoted', async () => {
      seedMember('Lin');
      seedAdminMember({ role: 'member' });
      const res = await POST(makeAdminRequest('POST', BASE, { name: 'Lin', ratings: validRatings() }));
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toBe('needs_signin');
    });

    it('401s with needs_signin when the caller holds member_session for a DIFFERENT member', async () => {
      seedMember('Lin');
      const other = seedMember('Viktor');
      const res = await POST(
        makeRequest('POST', BASE, { name: 'Lin', ratings: validRatings() }, memberCookieHeader('Viktor', other.id)),
      );
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toBe('needs_signin');
    });

    it('401s with needs_signin when there is no cookie and the target is a member', async () => {
      seedMember('Lin');
      const res = await POST(makeRequest('POST', BASE, { name: 'Lin', ratings: validRatings() }));
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toBe('needs_signin');
    });

    it('writes unauthenticated when the target name has no member record (unchanged)', async () => {
      const res = await POST(makeRequest('POST', BASE, { name: 'Ghost', ratings: validRatings() }));
      expect(res.status).toBe(201);
      const doc = await res.json();
      expect(doc.memberId).toBe('name:ghost');
    });

    it('rate limits before checking auth', async () => {
      seedMember('Lin');
      const headers = { 'X-Client-IP': 'rl-test-ip' };
      // Exhaust the 20/min limit for this IP with non-member (unauthenticated-ok) writes.
      for (let i = 0; i < 20; i++) {
        await POST(makeRequest('POST', BASE, { name: 'Ghost', ratings: validRatings() }, headers));
      }
      // A 21st request targeting a real member, still with no cookie, must be
      // rate-limited (429) rather than falling through to the auth check (401).
      const res = await POST(makeRequest('POST', BASE, { name: 'Lin', ratings: validRatings() }, headers));
      expect(res.status).toBe(429);
    });
  });

  describe('GET', () => {
    it('404s when the flag is off', async () => {
      process.env.NEXT_PUBLIC_FLAG_SKILL_ASSESS = 'false';
      const res = await GET(makeGetRequest(`${BASE}?name=Lin`));
      expect(res.status).toBe(404);
    });

    it('returns only the requested player snapshots, oldest first', async () => {
      const store = getStore();
      store['assessments'] = [
        { id: 'a2', memberId: 'name:lin', name: 'Lin', takenAt: '2026-02-01T00:00:00.000Z', ratings: [], overall: 3, dimensionScores: {}, phase: 'switch' },
        { id: 'a1', memberId: 'name:lin', name: 'Lin', takenAt: '2026-01-01T00:00:00.000Z', ratings: [], overall: 2, dimensionScores: {}, phase: 'exploration' },
        { id: 'b1', memberId: 'name:viktor', name: 'Viktor', takenAt: '2026-01-15T00:00:00.000Z', ratings: [], overall: 4, dimensionScores: {}, phase: 'commitment' },
      ];
      const res = await GET(makeGetRequest(`${BASE}?name=Lin`));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.assessments.map((a: { id: string }) => a.id)).toEqual(['a1', 'a2']);
    });

    it('returns an empty list when no name is given', async () => {
      const res = await GET(makeGetRequest(BASE));
      const body = await res.json();
      expect(body.assessments).toEqual([]);
    });
  });
});
