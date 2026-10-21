import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { resetMockStore, makeGetRequest, makeRequest, setupAdminPin, seedMember, memberCookieValue } from './helpers';

/** A signed-in member's GET — club-data reads refuse an anonymous caller (401) first. */
function memberGet(url: string) {
  seedMember('Lin');
  return makeRequest('GET', url, undefined, { Cookie: `member_session=${memberCookieValue('Lin')}` });
}

/**
 * A GET whose read throws answers 503 with `{ error }`, never a default or
 * empty body with a 200. The client's `loadError` path can only fire on a
 * non-ok status, so a 200 here renders a Cosmos outage as "no session yet" /
 * "empty roster" — the lying-empty-state rule CLAUDE.md forbids on the
 * client, which these three routes were breaking on the server.
 */
describe('read failures answer 503, not a lying 200', () => {
  let error: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    resetMockStore();
    setupAdminPin();
    vi.resetModules();
    error = vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.doUnmock('@/lib/cosmos');
    vi.doUnmock('@/lib/roster');
    vi.doUnmock('@/lib/groupScope');
    error.mockRestore();
  });

  it('GET /api/session', async () => {
    vi.doMock('@/lib/cosmos', async (importOriginal) => {
      const mod = await importOriginal<typeof import('@/lib/cosmos')>();
      return { ...mod, getActiveSessionId: async () => { throw new Error('cosmos down'); } };
    });
    const { GET } = await import('../app/api/session/route');
    const res = await GET(memberGet('http://localhost/api/session'));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'read_failed' });
  });

  it('GET /api/members', async () => {
    vi.doMock('@/lib/roster', async (importOriginal) => {
      const mod = await importOriginal<typeof import('@/lib/roster')>();
      // A member reads the roster through rosterPublicRows (three fields), an
      // admin through rosterMembers: both must fail the same way.
      return {
        ...mod,
        rosterMembers: async () => { throw new Error('cosmos down'); },
        rosterPublicRows: async () => { throw new Error('cosmos down'); },
      };
    });
    const { GET } = await import('../app/api/members/route');
    const res = await GET(memberGet('http://localhost/api/members'));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'read_failed' });
  });

  it('GET /api/sessions (admin)', async () => {
    vi.doMock('@/lib/groupScope', async (importOriginal) => {
      const mod = await importOriginal<typeof import('@/lib/groupScope')>();
      return {
        ...mod,
        groupScope: () => ({ query: async () => { throw new Error('cosmos down'); } }),
      };
    });
    const { GET } = await import('../app/api/sessions/route');
    const res = await GET(makeGetRequest('http://localhost/api/sessions', true));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'read_failed' });
  });

  // The money view is ALL OR NOTHING: six true buckets and one silent zero
  // would be the lying empty state with a straight face.
  it('GET /api/admin/ledger (admin)', async () => {
    vi.doMock('@/lib/groupScope', async (importOriginal) => {
      const mod = await importOriginal<typeof import('@/lib/groupScope')>();
      return {
        ...mod,
        groupScope: () => ({ query: async () => { throw new Error('cosmos down'); } }),
      };
    });
    const { GET } = await import('../app/api/admin/ledger/route');
    const res = await GET(makeGetRequest('http://localhost/api/admin/ledger', true));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'read_failed' });
  });

  // The probe answered a thrown read with a 200 of defaults until 2026-10-21:
  // `hasPin: false`, `statsPrivacy: null`, no `authed`. Profile's PIN row, the
  // first-PIN gate and the consent sheet all read that as a fact about the
  // member. Only the member's own PROBE throws here — the gate's point read
  // (`item().read()`) still works, so this is the signed-in member's read
  // failing, not a refused caller.
  describe('GET /api/members/me', () => {
    function mockMembersQueryThrows() {
      vi.doMock('@/lib/cosmos', async (importOriginal) => {
        const mod = await importOriginal<typeof import('@/lib/cosmos')>();
        return {
          ...mod,
          getContainer: (name: string) => {
            const real = mod.getContainer(name);
            if (name !== 'members') return real;
            return {
              ...real,
              items: {
                ...real.items,
                query: () => ({ fetchAll: async () => { throw new Error('cosmos down'); } }),
              },
            } as unknown as ReturnType<typeof mod.getContainer>;
          },
        };
      });
    }

    it('a thrown read answers 503, not hasPin: false', async () => {
      mockMembersQueryThrows();
      const { GET } = await import('../app/api/members/me/route');
      const res = await GET(memberGet('http://localhost/api/members/me?name=Lin'));
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ error: 'read_failed' });
    });

    it('no ?name is still the anonymous shape with a 200 — nothing was read', async () => {
      mockMembersQueryThrows();
      const { GET } = await import('../app/api/members/me/route');
      const res = await GET(memberGet('http://localhost/api/members/me'));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ role: 'member', hasPin: false, statsPrivacy: null });
    });
  });
});
