import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { POST, GET } from '../app/api/kudos/route';
import {
  resetMockStore, getStore, seedMember, setupAdminPin, makeRequest, makeGetRequest, memberCookieValue,
} from './helpers';

const BASE = 'http://localhost:3000/api/kudos';

function postAs(name: string, body: Record<string, unknown>) {
  const cookie = `member_session=${memberCookieValue(name)}`;
  return makeRequest('POST', BASE, body, { Cookie: cookie });
}
function getAs(name: string, cookieName?: string) {
  const cookie = `member_session=${memberCookieValue(cookieName ?? name)}`;
  return makeRequest('GET', `${BASE}?name=${encodeURIComponent(name)}`, undefined, { Cookie: cookie });
}

/** Seed a non-removed roster for the active (fallback) session so co-play passes. */
function seedRoster(names: string[]) {
  const store = getStore();
  if (!store['players']) store['players'] = [];
  for (const n of names) {
    store['players'].push({ id: `p-${n.toLowerCase()}`, sessionId: 'current-session', name: n, removed: false });
  }
}

describe('/api/kudos', () => {
  beforeEach(() => {
    resetMockStore();
    setupAdminPin();
    process.env.NEXT_PUBLIC_FLAG_KUDOS = 'true';
  });
  afterAll(() => {
    delete process.env.NEXT_PUBLIC_FLAG_KUDOS;
  });

  describe('POST', () => {
    it('404s when the flag is off', async () => {
      process.env.NEXT_PUBLIC_FLAG_KUDOS = 'false';
      const res = await POST(postAs('Viktor', { recipientName: 'Lin', tag: 'clutch' }));
      expect(res.status).toBe(404);
    });

    it('401s without a member cookie (rater identity comes from the cookie)', async () => {
      const res = await POST(makeRequest('POST', BASE, { recipientName: 'Lin', tag: 'clutch' }));
      expect(res.status).toBe(401);
    });

    it('400s on an invalid tag', async () => {
      seedRoster(['Viktor', 'Lin']);
      const res = await POST(postAs('Viktor', { recipientName: 'Lin', tag: 'mvp' }));
      expect(res.status).toBe(400);
    });

    it('403s on self-kudos', async () => {
      seedRoster(['Viktor']);
      const res = await POST(postAs('Viktor', { recipientName: 'Viktor', tag: 'clutch' }));
      expect(res.status).toBe(403);
    });

    it('403s when the two did not play together', async () => {
      seedRoster(['Viktor']); // Lin not in the session
      seedMember('Lin');
      const res = await POST(postAs('Viktor', { recipientName: 'Lin', tag: 'clutch' }));
      expect(res.status).toBe(403);
      expect((await res.json()).error).toBe('not_co_player');
    });

    it('201s on a valid co-play kudos, and a duplicate is 409', async () => {
      seedRoster(['Viktor', 'Lin']);
      seedMember('Lin');
      const ok = await POST(postAs('Viktor', { recipientName: 'Lin', tag: 'clutch' }));
      expect(ok.status).toBe(201);
      const dupe = await POST(postAs('Viktor', { recipientName: 'Lin', tag: 'clutch' }));
      expect(dupe.status).toBe(409);
      // A DIFFERENT tag from the same rater is allowed.
      const other = await POST(postAs('Viktor', { recipientName: 'Lin', tag: 'nice_shot' }));
      expect(other.status).toBe(201);
    });

    it('accepts co-play proven via a logged game (not just the roster)', async () => {
      const store = getStore();
      store['gameResults'] = [{ id: 'g1', sessionId: 'current-session', teamA: ['Viktor', 'Lin'], teamB: ['A', 'B'], scoreA: 21, scoreB: 10, loggedAt: '2026-06-13T00:00:00Z' }];
      seedMember('Lin');
      const res = await POST(postAs('Viktor', { recipientName: 'Lin', tag: 'good_sport' }));
      expect(res.status).toBe(201);
    });
  });

  describe('GET', () => {
    async function sendKudos(rater: string, recipient: string, tag: string) {
      seedRoster([rater, recipient]);
      const res = await POST(postAs(rater, { recipientName: recipient, tag }));
      expect(res.status).toBe(201);
    }

    it('404s when the flag is off', async () => {
      process.env.NEXT_PUBLIC_FLAG_KUDOS = 'false';
      const res = await GET(getAs('Lin'));
      expect(res.status).toBe(404);
    });

    it('400s with no name', async () => {
      const res = await GET(makeRequest('GET', BASE));
      expect(res.status).toBe(400);
    });

    it('403s for a non-owner without admin', async () => {
      const res = await GET(getAs('Lin', 'Viktor'));
      expect(res.status).toBe(403);
    });

    it('returns counts to the owning member and never leaks rater identity', async () => {
      seedMember('Lin');
      await sendKudos('Viktor', 'Lin', 'clutch');
      await sendKudos('Akane', 'Lin', 'clutch');
      const res = await GET(getAs('Lin'));
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).not.toMatch(/raterName|raterMemberId|Viktor|Akane/);
      const body = JSON.parse(text);
      expect(body.kudos).toEqual([{ tag: 'clutch', count: 2 }]);
    });

    it('lets an admin read another member\'s counts', async () => {
      seedMember('Lin');
      await sendKudos('Viktor', 'Lin', 'nice_shot');
      const res = await GET(makeGetRequest(`${BASE}?name=Lin`, true));
      expect(res.status).toBe(200);
      expect((await res.json()).kudos).toEqual([{ tag: 'nice_shot', count: 1 }]);
    });
  });
});
