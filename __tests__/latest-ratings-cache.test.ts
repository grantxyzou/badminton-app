import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * The club bands read every assessment ever stored on every request; the fold
 * is now memoized and cleared by the writers (lib/latestRatings.ts,
 * performance audit, 2026-10-19). It memoizes ONLY against real Cosmos, so
 * this file stands a fake one in for `lib/cosmos.ts` and sets the connection
 * string the module checks.
 */

const fetchAll = vi.fn();
vi.mock('@/lib/cosmos', () => ({
  ensureContainer: vi.fn(async () => {}),
  getContainer: vi.fn(() => ({ items: { query: () => ({ fetchAll }) } })),
}));

const rows = (...r: Array<{ memberId: string; takenAt: string; ratings: unknown[] }>) => ({ resources: r });

describe('latestRatingsByMember', () => {
  const saved = process.env.COSMOS_CONNECTION_STRING;

  beforeEach(async () => {
    vi.resetModules();
    fetchAll.mockReset();
    process.env.COSMOS_CONNECTION_STRING = 'AccountEndpoint=https://example.invalid/;AccountKey=x';
  });

  afterEach(() => {
    vi.useRealTimers();
    if (saved === undefined) delete process.env.COSMOS_CONNECTION_STRING;
    else process.env.COSMOS_CONNECTION_STRING = saved;
  });

  it('keeps each member’s latest check-in', async () => {
    fetchAll.mockResolvedValue(
      rows(
        { memberId: 'm-lin', takenAt: '2026-10-01T00:00:00Z', ratings: [1] },
        { memberId: 'm-lin', takenAt: '2026-10-08T00:00:00Z', ratings: [2] },
        { memberId: 'name:ghost', takenAt: '2026-10-02T00:00:00Z', ratings: [3] },
      ),
    );
    const { latestRatingsByMember } = await import('@/lib/latestRatings');
    const map = await latestRatingsByMember();
    expect(map.get('m-lin')?.ratings).toEqual([2]);
    // Synthetic subjects are kept in the fold; the bands route decides who counts.
    expect(map.has('name:ghost')).toBe(true);
  });

  it('ten requests together pay for one read', async () => {
    fetchAll.mockResolvedValue(rows());
    const { latestRatingsByMember } = await import('@/lib/latestRatings');
    await Promise.all(Array.from({ length: 10 }, () => latestRatingsByMember()));
    await latestRatingsByMember();
    expect(fetchAll).toHaveBeenCalledTimes(1);
  });

  it('a check-in clears it, so the next request reads again', async () => {
    fetchAll.mockResolvedValue(rows());
    const { latestRatingsByMember, invalidateLatestRatings } = await import('@/lib/latestRatings');
    await latestRatingsByMember();
    invalidateLatestRatings();
    await latestRatingsByMember();
    expect(fetchAll).toHaveBeenCalledTimes(2);
  });

  it('expires after a minute', async () => {
    vi.useFakeTimers();
    fetchAll.mockResolvedValue(rows());
    const { latestRatingsByMember } = await import('@/lib/latestRatings');
    await latestRatingsByMember();
    vi.advanceTimersByTime(61_000);
    await latestRatingsByMember();
    expect(fetchAll).toHaveBeenCalledTimes(2);
  });

  it('a failed read is not remembered', async () => {
    fetchAll.mockRejectedValueOnce(new Error('cosmos down')).mockResolvedValue(rows());
    const { latestRatingsByMember } = await import('@/lib/latestRatings');
    await expect(latestRatingsByMember()).rejects.toThrow('cosmos down');
    await expect(latestRatingsByMember()).resolves.toBeInstanceOf(Map);
    expect(fetchAll).toHaveBeenCalledTimes(2);
  });

  it('never memoizes against the mock store', async () => {
    delete process.env.COSMOS_CONNECTION_STRING;
    fetchAll.mockResolvedValue(rows());
    const { latestRatingsByMember } = await import('@/lib/latestRatings');
    await latestRatingsByMember();
    await latestRatingsByMember();
    expect(fetchAll).toHaveBeenCalledTimes(2);
  });
});

describe('every assessment writer and deleter clears the fold', () => {
  it('POST /api/assessments and purgeMember call invalidateLatestRatings', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const root = join(__dirname, '..');
    for (const f of ['app/api/assessments/route.ts', 'lib/memberPurge.ts']) {
      expect(readFileSync(join(root, f), 'utf8'), f).toMatch(/invalidateLatestRatings\(\)/);
    }
  });
});
