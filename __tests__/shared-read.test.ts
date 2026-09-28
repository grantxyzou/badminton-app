import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { sharedRead, resetSharedReads } from '../lib/sharedRead';

/**
 * Two cards, one screen, one request. The three endpoints this exists for are
 * each read by two components that mount together — the saving is real only
 * if the second caller never reaches the network.
 */
describe('sharedRead', () => {
  beforeEach(() => { resetSharedReads(); });
  afterEach(() => { vi.unstubAllGlobals(); resetSharedReads(); });

  function stub(body: unknown) {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => body }));
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  it('two callers of the same URL make ONE request and both get the answer', async () => {
    const fetchMock = stub({ kudos: [{ count: 2 }] });
    const [a, b] = await Promise.all([sharedRead('/api/kudos?name=Lin'), sharedRead('/api/kudos?name=Lin')]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(a).toEqual({ kudos: [{ count: 2 }] });
    expect(b).toEqual(a);
  });

  it('different URLs are different reads', async () => {
    const fetchMock = stub({});
    await Promise.all([sharedRead('/api/kudos?name=Lin'), sharedRead('/api/kudos?name=Viktor')]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('a failure is never shared: the next caller tries again', async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, status: 403, json: async () => ({}) }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(sharedRead('/api/kudos?name=Lin')).rejects.toThrow('403');
    await expect(sharedRead('/api/kudos?name=Lin')).rejects.toThrow('403');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('a status becomes the error message, so a caller can still tell a 403 from a 500', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })));
    await expect(sharedRead('/api/x')).rejects.toThrow('500');
  });

  it('resetSharedReads drops the window — what pull-to-refresh relies on', async () => {
    const fetchMock = stub({ v: 1 });
    await sharedRead('/api/session');
    resetSharedReads();
    await sharedRead('/api/session');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('sharedFetch', () => {
  it('shares one request among concurrent callers and gives each its own body', async () => {
    const { sharedFetch, resetSharedReads } = await import('../lib/sharedRead');
    resetSharedReads();
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: 's1' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      const [a, b] = await Promise.all([sharedFetch('/api/session'), sharedFetch('/api/session')]);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      // Both clones are readable — a body reads once, so the original must stay unread.
      expect(await a.json()).toEqual({ id: 's1' });
      expect(await b.json()).toEqual({ id: 's1' });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('shares NOTHING once the request has settled — a refetch after a write goes to the server', async () => {
    const { sharedFetch, resetSharedReads } = await import('../lib/sharedRead');
    resetSharedReads();
    const fetchMock = vi.fn(async () => new Response('[]', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      await sharedFetch('/api/players');
      await sharedFetch('/api/players');
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('keeps a non-ok status for every sharer instead of throwing', async () => {
    const { sharedFetch, resetSharedReads } = await import('../lib/sharedRead');
    resetSharedReads();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })));
    try {
      const [a, b] = await Promise.all([sharedFetch('/api/session'), sharedFetch('/api/session')]);
      expect(a.status).toBe(404);
      expect(b.status).toBe(404);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('a rejected request is not shared with the next caller', async () => {
    const { sharedFetch, resetSharedReads } = await import('../lib/sharedRead');
    resetSharedReads();
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      await expect(sharedFetch('/api/session')).rejects.toThrow('offline');
      expect((await sharedFetch('/api/session')).ok).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
