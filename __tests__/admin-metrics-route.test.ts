// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  resetMockStore,
  setupAdminPin,
  seedAdminMember,
  seedSession,
  seedPlayer,
  seedMember,
  seedDoc,
  makeGetRequest,
} from './helpers';

/**
 * GET /api/admin/metrics — the admin Metrics page's one read
 * (docs/plans/usage-metrics.md). The arithmetic is pinned in
 * metrics-math.test.ts; this file pins the route: who may read it, that a
 * failed read is a 503 and not a page of zeros, and that another club's rows
 * do not count.
 */

const URL_BASE = 'http://localhost/bpm/api/admin/metrics';
const DAY = 86_400_000;
const ago = (d: number) => new Date(Date.now() - d * DAY).toISOString();

beforeEach(() => {
  resetMockStore();
  setupAdminPin();
  seedAdminMember();
});

describe('GET /api/admin/metrics', () => {
  it('refuses a non-admin', async () => {
    const { GET } = await import('@/app/api/admin/metrics/route');
    const res = await GET(makeGetRequest(URL_BASE));
    expect(res.status).toBe(401);
  });

  it('answers the club totals for the admin', async () => {
    const { GET } = await import('@/app/api/admin/metrics/route');
    seedSession('session-2026-09-24', { datetime: ago(13), maxPlayers: 4 });
    seedSession('session-2026-10-01', { datetime: ago(6), maxPlayers: 4 });
    const lin = seedMember('Lin');
    seedPlayer('session-2026-09-24', 'Lin', { memberId: lin.id });
    seedPlayer('session-2026-10-01', 'Lin', { memberId: lin.id });
    seedPlayer('session-2026-10-01', 'Viktor');
    seedDoc('kudos', { id: 'k1', recipientMemberId: 'x', raterMemberId: lin.id, createdAt: ago(2) });

    const res = await GET(makeGetRequest(URL_BASE, true));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sessions.map((s: { confirmed: number }) => s.confirmed)).toEqual([1, 2]);
    expect(body.activeMembers.last4).toBe(2);
    expect(body.features.kudosGivers28d).toBe(1);
    expect(JSON.stringify(body)).not.toMatch(/\bLin\b|Viktor/);
  });

  it('does not count another club', async () => {
    const { GET } = await import('@/app/api/admin/metrics/route');
    seedSession('session-2026-10-01', { datetime: ago(6), maxPlayers: 4 });
    seedPlayer('session-2026-10-01', 'Ours');
    seedSession('other:session-2026-10-01', { datetime: ago(6), maxPlayers: 4, groupId: 'other' });
    seedPlayer('other:session-2026-10-01', 'Theirs', { groupId: 'other' });
    seedPlayer('session-2026-10-01', 'Leaked', { groupId: 'other' });

    const body = await (await GET(makeGetRequest(URL_BASE, true))).json();
    expect(body.sessions).toHaveLength(1);
    expect(body.sessions[0].confirmed).toBe(1);
  });

  it('honours ?sessions= and falls back to 8', async () => {
    const { GET } = await import('@/app/api/admin/metrics/route');
    for (let w = 1; w <= 10; w++) seedSession(`session-w${w}`, { datetime: ago(7 * w), maxPlayers: 4 });
    const eight = await (await GET(makeGetRequest(`${URL_BASE}?sessions=nine`, true))).json();
    const twelve = await (await GET(makeGetRequest(`${URL_BASE}?sessions=12`, true))).json();
    expect(eight.sessions).toHaveLength(8);
    expect(twelve.sessions).toHaveLength(10);
  });
});

describe('GET /api/admin/metrics — a failed read', () => {
  let error: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    vi.resetModules();
    error = vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.doUnmock('@/lib/roster');
    error.mockRestore();
  });

  it('is a 503, never a page of zeros', async () => {
    vi.doMock('@/lib/roster', async (importOriginal) => {
      const mod = await importOriginal<typeof import('@/lib/roster')>();
      return { ...mod, rosterMembers: async () => { throw new Error('cosmos down'); } };
    });
    const { GET } = await import('@/app/api/admin/metrics/route');
    const res = await GET(makeGetRequest(URL_BASE, true));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'read_failed' });
  });
});
