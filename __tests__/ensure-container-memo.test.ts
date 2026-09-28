import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * `ensureContainer` is memoized per process: the metadata round trip happens
 * once per (container, key), a rejected attempt is forgotten so the next
 * call retries, and mock mode never touches the client at all.
 */
const createIfNotExists = vi.fn();
vi.mock('@azure/cosmos', () => ({
  CosmosClient: class {
    database() {
      return { containers: { createIfNotExists: (...a: unknown[]) => createIfNotExists(...a) }, container: () => ({}) };
    }
  },
}));

describe('ensureContainer memo', () => {
  const saved = process.env.COSMOS_CONNECTION_STRING;
  beforeEach(() => {
    vi.resetModules();
    createIfNotExists.mockReset();
    process.env.COSMOS_CONNECTION_STRING = 'AccountEndpoint=https://x.documents.azure.com:443/;AccountKey=dGVzdA==;';
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.COSMOS_CONNECTION_STRING;
    else process.env.COSMOS_CONNECTION_STRING = saved;
  });

  it('calls createIfNotExists once for repeated and concurrent calls', async () => {
    createIfNotExists.mockResolvedValue({});
    const { ensureContainer } = await import('../lib/cosmos');
    await Promise.all([ensureContainer('kudos'), ensureContainer('kudos'), ensureContainer('kudos')]);
    await ensureContainer('kudos');
    expect(createIfNotExists).toHaveBeenCalledTimes(1);
    expect(createIfNotExists.mock.calls[0][0]).toEqual({ id: 'kudos', partitionKey: { paths: ['/recipientMemberId'] } });
  });

  it('forgets a rejected attempt so the next call retries', async () => {
    createIfNotExists.mockRejectedValueOnce(new Error('cosmos down')).mockResolvedValue({});
    const { ensureContainer } = await import('../lib/cosmos');
    await expect(ensureContainer('kudos')).rejects.toThrow('cosmos down');
    await expect(ensureContainer('kudos')).resolves.toBeUndefined();
    expect(createIfNotExists).toHaveBeenCalledTimes(2);
  });

  it('is a different memo entry per container', async () => {
    createIfNotExists.mockResolvedValue({});
    const { ensureContainer } = await import('../lib/cosmos');
    await ensureContainer('kudos');
    await ensureContainer('events');
    expect(createIfNotExists).toHaveBeenCalledTimes(2);
  });
});
