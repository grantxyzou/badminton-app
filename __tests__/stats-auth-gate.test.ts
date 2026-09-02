// @vitest-environment node
/**
 * The privacy gate on the name-keyed Stats routes.
 *
 * `/stats/insight`, `/stats/partners` and `/stats/attendance` shipped with no
 * auth at all — one member's AI coaching prose, social graph and attendance
 * history were readable by anyone, and member names are enumerable via the
 * public `GET /api/members`. The three-line gate their siblings carried was a
 * copy-pasted snippet, and a snippet can be silently forgotten. It now lives in
 * `ownsNameOrAdmin` (lib/auth.ts); this file pins the behaviour at the route
 * boundary for all three, plus the two legible-fail statuses the fix restored.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { NextRequest } from 'next/server';
import {
  resetMockStore,
  getStore,
  seedMember,
  seedSession,
  seedPlayer,
  seedPointer,
  setupAdminPin,
  makeRequest,
  makeAdminRequest,
  memberCookieValue,
} from './helpers';

// The insight route constructs an Anthropic client at module scope and calls it
// on a cache miss. Mocking it lets us assert the harder half of the finding: an
// unauthenticated caller must not be able to spend Anthropic budget.
const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }));
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: mockCreate };
  },
}));

import { GET as insightGET } from '@/app/api/stats/insight/route';
import { GET as partnersGET } from '@/app/api/stats/partners/route';
import { GET as attendanceGET } from '@/app/api/stats/attendance/route';

const INSIGHT = 'http://localhost:3000/api/stats/insight';
const PARTNERS = 'http://localhost:3000/api/stats/partners';
const ATTENDANCE = 'http://localhost:3000/api/stats/attendance';

/** Anonymous GET — no cookies at all. */
function anon(url: string): NextRequest {
  return makeRequest('GET', url);
}

/** GET carrying a `member_session` cookie bound to `cookieName`. */
function asMember(url: string, cookieName: string): NextRequest {
  return makeRequest('GET', url, undefined, {
    Cookie: `member_session=${memberCookieValue(cookieName)}`,
  });
}

describe('Stats privacy gate — /insight, /partners, /attendance', () => {
  beforeEach(() => {
    resetMockStore();
    setupAdminPin();
    mockCreate.mockReset();
    process.env.NEXT_PUBLIC_FLAG_VALUE_HUB_SLICE = 'true';
    process.env.ANTHROPIC_API_KEY = 'test-key';
    seedPointer('session-2026-06-17');
  });
  afterAll(() => {
    delete process.env.NEXT_PUBLIC_FLAG_VALUE_HUB_SLICE;
    delete process.env.ANTHROPIC_API_KEY;
  });

  /* ── /api/stats/insight ─────────────────────────────────────────────── */

  describe('/api/stats/insight', () => {
    function seedInsightWorld() {
      const m = seedMember('Viktor');
      mockCreate.mockResolvedValue({
        content: [{ type: 'text', text: JSON.stringify({ greeting: 'Nice week.', level: null, trend: null }) }],
      });
      return m;
    }

    it('403s an anonymous caller', async () => {
      seedInsightWorld();
      const res = await insightGET(anon(`${INSIGHT}?name=Viktor`));
      expect(res.status).toBe(403);
      expect((await res.json()).error).toBe('forbidden');
    });

    it("403s a caller holding another member's cookie", async () => {
      seedInsightWorld();
      const res = await insightGET(asMember(`${INSIGHT}?name=Viktor`, 'Lin'));
      expect(res.status).toBe(403);
    });

    it('200s for the owning member', async () => {
      seedInsightWorld();
      const res = await insightGET(asMember(`${INSIGHT}?name=Viktor`, 'Viktor'));
      expect(res.status).toBe(200);
      expect((await res.json()).account).toBe(true);
    });

    it('200s for an admin browsing another member', async () => {
      seedInsightWorld();
      const res = await insightGET(makeAdminRequest('GET', `${INSIGHT}?name=Viktor`));
      expect(res.status).toBe(200);
      expect((await res.json()).account).toBe(true);
    });

    // The second harm in the finding: a cache miss GENERATES, so an ungated
    // route let an anonymous caller spend Anthropic budget. The gate has to sit
    // above every generation path, not merely above the model call.
    it('never calls the Anthropic client on an unauthenticated request', async () => {
      seedInsightWorld();
      await insightGET(anon(`${INSIGHT}?name=Viktor`));
      await insightGET(asMember(`${INSIGHT}?name=Viktor`, 'Lin'));
      expect(mockCreate).not.toHaveBeenCalled();

      // Control: the same world DOES generate once the caller owns the name,
      // so the assertion above is about the gate, not a broken fixture.
      await insightGET(asMember(`${INSIGHT}?name=Viktor`, 'Viktor'));
      expect(mockCreate).toHaveBeenCalledTimes(1);
    });

    // Rule 3 (auth before DB): the gate compares the cookie against the query
    // param, so it needs no member lookup and must run before the containers
    // are touched at all.
    it('403s before reading any container (no member doc needed)', async () => {
      // Nothing seeded — an unauthenticated call must still be a clean 403,
      // not an "account: false" empty payload from the member lookup below it.
      const res = await insightGET(anon(`${INSIGHT}?name=Ghost`));
      expect(res.status).toBe(403);
    });
  });

  /* ── /api/stats/partners ────────────────────────────────────────────── */

  describe('/api/stats/partners', () => {
    beforeEach(() => {
      seedPlayer('session-2026-05-14', 'Lin');
      seedPlayer('session-2026-05-14', 'Viktor');
    });

    it('403s an anonymous caller', async () => {
      const res = await partnersGET(anon(`${PARTNERS}?name=Lin&weeks=520`));
      expect(res.status).toBe(403);
      expect((await res.json()).error).toBe('forbidden');
    });

    it("403s a caller holding another member's cookie", async () => {
      const res = await partnersGET(asMember(`${PARTNERS}?name=Lin&weeks=520`, 'Carolina'));
      expect(res.status).toBe(403);
    });

    it('200s for the owning member', async () => {
      const res = await partnersGET(asMember(`${PARTNERS}?name=Lin&weeks=520`, 'Lin'));
      expect(res.status).toBe(200);
      expect(Array.isArray((await res.json()).partners)).toBe(true);
    });

    it('200s for an admin browsing another member', async () => {
      const res = await partnersGET(makeAdminRequest('GET', `${PARTNERS}?name=Lin&weeks=520`));
      expect(res.status).toBe(200);
    });

    // Lying empty state: the throttle used to answer `{ partners: [] }` with
    // HTTP 200, which WhoYouPlayWithCard renders as "you haven't played with
    // anyone yet". A throttled read must be distinguishable from an empty one.
    it('returns a real 429 when throttled, not 200 with an empty list', async () => {
      const ip = `partners-throttle-${Math.random()}`;
      const fixedIp = (url: string) =>
        new NextRequest(new URL(url), {
          headers: {
            'x-client-ip': ip,
            cookie: `member_session=${memberCookieValue('Lin')}`,
          },
        });

      let res = await partnersGET(fixedIp(`${PARTNERS}?name=Lin`));
      expect(res.status).toBe(200);
      // Limit is 10/min on the same IP; burn through it.
      for (let i = 0; i < 12; i++) res = await partnersGET(fixedIp(`${PARTNERS}?name=Lin`));
      expect(res.status).toBe(429);
      const body = await res.json();
      expect(body.error).toBe('rate_limited');
      expect(body.partners).toBeUndefined();
    });

    // A missing name is a bad request, same reasoning as the 429.
    it('400s a missing name instead of returning an empty list', async () => {
      const res = await partnersGET(asMember(PARTNERS, 'Lin'));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe('name_required');
    });

    // Rule 4: the rate limiter must be the first thing in the handler, so a
    // flag flip cannot be used to skip past it.
    it('rate-limits before the flag check', async () => {
      const ip = `partners-order-${Math.random()}`;
      const req = () =>
        new NextRequest(new URL(`${PARTNERS}?name=Lin`), {
          headers: { 'x-client-ip': ip, cookie: `member_session=${memberCookieValue('Lin')}` },
        });
      for (let i = 0; i < 11; i++) await partnersGET(req());
      process.env.NEXT_PUBLIC_FLAG_VALUE_HUB_SLICE = 'false';
      const res = await partnersGET(req());
      expect(res.status).toBe(429);
    });
  });

  /* ── /api/stats/attendance ──────────────────────────────────────────── */

  describe('/api/stats/attendance', () => {
    beforeEach(() => {
      seedSession('session-2026-05-14', { datetime: '2026-05-14T18:00:00.000-04:00' });
      seedPlayer('session-2026-05-14', 'Lin');
    });

    it('403s an anonymous caller', async () => {
      const res = await attendanceGET(anon(`${ATTENDANCE}?name=Lin`));
      expect(res.status).toBe(403);
      expect((await res.json()).error).toBe('forbidden');
    });

    it("403s a caller holding another member's cookie", async () => {
      const res = await attendanceGET(asMember(`${ATTENDANCE}?name=Lin`, 'Viktor'));
      expect(res.status).toBe(403);
    });

    it('200s for the owning member', async () => {
      const res = await attendanceGET(asMember(`${ATTENDANCE}?name=Lin`, 'Lin'));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.name).toBe('Lin');
      // The outer beforeEach seeds an `active-session-pointer` doc into the
      // sessions container. The route's `WHERE c.id != @pointerId` clause must
      // still exclude it after the SELECT was narrowed to a projection — a
      // leaked pointer doc has no `datetime`, so it survives the future-session
      // filter (`!s.datetime || ...`) and lands in history as an extra
      // unattended entry, inflating history.length and breaking longestStreak.
      expect(body.history).toHaveLength(1);
      expect(
        body.history.some((h: { sessionId: string }) => h.sessionId === 'active-session-pointer'),
      ).toBe(false);
    });

    it('200s for an admin browsing another member', async () => {
      const res = await attendanceGET(makeAdminRequest('GET', `${ATTENDANCE}?name=Lin`));
      expect(res.status).toBe(200);
    });

    // The route previously had NO limiter at all — this pins that it now does.
    it('rate-limits by IP and returns 429 when the window is exhausted', async () => {
      const ip = `attendance-throttle-${Math.random()}`;
      const req = () =>
        new NextRequest(new URL(`${ATTENDANCE}?name=Lin`), {
          headers: { 'x-client-ip': ip, cookie: `member_session=${memberCookieValue('Lin')}` },
        });
      let res = await attendanceGET(req());
      expect(res.status).toBe(200);
      for (let i = 0; i < 62; i++) res = await attendanceGET(req());
      expect(res.status).toBe(429);
      expect((await res.json()).error).toBe('rate_limited');
    });

    // The projection swap (`SELECT *` → `SELECT c.id, c.datetime`) must not
    // change what the route computes.
    it('still computes attendance and streak after the query projection', async () => {
      resetMockStore();
      setupAdminPin();
      const ids = [0, 7, 14].map((d) => {
        const dt = new Date();
        dt.setDate(dt.getDate() - d - 1);
        return { id: `session-${dt.toISOString().slice(0, 10)}`, datetime: dt.toISOString() };
      });
      // A full-fat session doc: the fields the projection drops must be
      // irrelevant to the result.
      ids.forEach(({ id, datetime }) =>
        seedSession(id, {
          datetime,
          birdUsages: [{ purchaseId: 'pool', tubes: 2 }],
          approvedNames: ['Lin', 'Viktor'],
          prevCostPerPerson: 12.5,
        }),
      );
      ids.forEach(({ id }) => seedPlayer(id, 'Lin'));

      const res = await attendanceGET(asMember(`${ATTENDANCE}?name=Lin&weeks=12`, 'Lin'));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.attended).toBe(3);
      expect(body.streak).toBe(3);
      expect(body.history).toHaveLength(3);
      expect(body.history[0].datetime).toBeTruthy();
      expect(getStore()['sessions']).toHaveLength(3);
    });
  });
});
