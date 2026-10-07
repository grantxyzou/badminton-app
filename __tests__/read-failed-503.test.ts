import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { resetMockStore, makeGetRequest, setupAdminPin } from './helpers';

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
    const res = await GET(makeGetRequest('http://localhost/api/session'));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'read_failed' });
  });

  it('GET /api/members', async () => {
    vi.doMock('@/lib/roster', async (importOriginal) => {
      const mod = await importOriginal<typeof import('@/lib/roster')>();
      return { ...mod, rosterMembers: async () => { throw new Error('cosmos down'); } };
    });
    const { GET } = await import('../app/api/members/route');
    const res = await GET(makeGetRequest('http://localhost/api/members'));
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
});
