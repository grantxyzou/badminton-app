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
