import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * `getActiveSessionId` memoizes the pointer per group for five seconds, but
 * ONLY against real Cosmos: the mock store is reset between tests, and a memo
 * there would carry one case's session into the next. `setActiveSessionId`
 * overwrites the memo in the same process, so an advance shows at once.
 */
const read = vi.fn();
const upsert = vi.fn();
vi.mock('@azure/cosmos', () => ({
  CosmosClient: class {
    database() {
      return {
        containers: { createIfNotExists: async () => ({}) },
        container: () => ({ item: () => ({ read: (...a: unknown[]) => read(...a) }), items: { upsert: (...a: unknown[]) => upsert(...a) } }),
      };
    }
  },
}));

describe('active-session pointer memo', () => {
  const saved = process.env.COSMOS_CONNECTION_STRING;
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    read.mockReset();
    upsert.mockReset();
    upsert.mockResolvedValue({});
    process.env.COSMOS_CONNECTION_STRING = 'AccountEndpoint=https://x.documents.azure.com:443/;AccountKey=dGVzdA==;';
  });
  afterEach(() => {
    vi.useRealTimers();
    if (saved === undefined) delete process.env.COSMOS_CONNECTION_STRING;
    else process.env.COSMOS_CONNECTION_STRING = saved;
  });

  it('reads the pointer once for a burst of calls, then again after the TTL', async () => {
    read.mockResolvedValue({ resource: { activeSessionId: 'session-2026-10-01' } });
    const { getActiveSessionId } = await import('../lib/cosmos');
    const ids = await Promise.all([getActiveSessionId('bpm'), getActiveSessionId('bpm')]);
    await getActiveSessionId('bpm');
    expect(ids).toEqual(['session-2026-10-01', 'session-2026-10-01']);
    // Concurrent first calls both miss (there is no in-flight dedupe, on
    // purpose — a point read is cheap and the memo is what matters), then
    // every call inside the window is served from memory.
    expect(read).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(5001);
    await getActiveSessionId('bpm');
    expect(read).toHaveBeenCalledTimes(3);
  });

  it('memoizes a missing pointer as the fallback too', async () => {
    read.mockRejectedValue(Object.assign(new Error('nf'), { code: 404 }));
    const { getActiveSessionId } = await import('../lib/cosmos');
    expect(await getActiveSessionId('bpm')).toBe('current-session');
    expect(await getActiveSessionId('bpm')).toBe('current-session');
    expect(await getActiveSessionId('other')).toBeNull();
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('never memoizes a failure that is not a 404', async () => {
    read.mockRejectedValueOnce(new Error('outage')).mockResolvedValue({ resource: { activeSessionId: 'session-x' } });
    const { getActiveSessionId } = await import('../lib/cosmos');
    await expect(getActiveSessionId('bpm')).rejects.toThrow('outage');
    expect(await getActiveSessionId('bpm')).toBe('session-x');
  });

  it('setActiveSessionId updates the memo in the same process', async () => {
    read.mockResolvedValue({ resource: { activeSessionId: 'session-old' } });
    const { getActiveSessionId, setActiveSessionId } = await import('../lib/cosmos');
    expect(await getActiveSessionId('bpm')).toBe('session-old');
    await setActiveSessionId('bpm', 'session-new');
    expect(await getActiveSessionId('bpm')).toBe('session-new');
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('is per group', async () => {
    read
      .mockResolvedValueOnce({ resource: { activeSessionId: 'session-a' } })
      .mockResolvedValueOnce({ resource: { activeSessionId: 'other:session-b' } });
    const { getActiveSessionId } = await import('../lib/cosmos');
    expect(await getActiveSessionId('bpm')).toBe('session-a');
    expect(await getActiveSessionId('other')).toBe('other:session-b');
    expect(await getActiveSessionId('bpm')).toBe('session-a');
    expect(read).toHaveBeenCalledTimes(2);
  });
});
