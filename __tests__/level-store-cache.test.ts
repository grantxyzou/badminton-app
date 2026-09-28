import { describe, it, expect, beforeEach, vi } from 'vitest';
import { resetMockStore, getStore, seedMember } from './helpers';
import { getCanonicalLevel, invalidateGroupCalibration, _resetCalibrationCache } from '../lib/levelStore';

/**
 * The group-calibration memo is TTL-FIRST: inside the window no read is
 * made, and a game that lands is made visible by the writer calling
 * `invalidateGroupCalibration`, not by re-scanning two containers to compute
 * a signature. The first cut scanned first and cached second, which saved
 * the fold's CPU and none of the reads that were the cost.
 */
function seedGame(sessionId: string, winner: string, loser: string, loggedAt: string) {
  const store = getStore();
  if (!store['gameResults']) store['gameResults'] = [];
  store['gameResults'].push({
    id: `g-${Math.random().toString(36).slice(2, 8)}`,
    sessionId,
    groupId: 'bpm',
    teamA: [winner],
    teamB: [loser],
    scoreA: 21,
    scoreB: 10,
    loggedBy: winner,
    loggedAt,
  });
}

describe('level store calibration cache', () => {
  beforeEach(() => {
    resetMockStore();
    _resetCalibrationCache();
  });

  it('does not re-read within the TTL, and invalidation makes a new game visible', async () => {
    const lin = seedMember('Lin');
    seedMember('Viktor');
    const subject = { memberId: lin.id, name: 'Lin' };

    const before = await getCanonicalLevel(subject, 'bpm');
    expect(before.basis.game).toBeNull();

    // A game lands behind the cache's back (no writer, no invalidation).
    for (let i = 0; i < 10; i++) seedGame('session-2026-09-24', 'Lin', 'Viktor', `2026-09-24T${String(10 + i)}:00:00Z`);
    const cached = await getCanonicalLevel(subject, 'bpm');
    expect(cached.basis.game).toBeNull();

    invalidateGroupCalibration('bpm');
    const fresh = await getCanonicalLevel(subject, 'bpm');
    expect(fresh.basis.game).not.toBeNull();
  });

  it('re-reads once the TTL has passed', async () => {
    const lin = seedMember('Lin');
    seedMember('Viktor');
    const subject = { memberId: lin.id, name: 'Lin' };
    vi.useFakeTimers();
    try {
      await getCanonicalLevel(subject, 'bpm');
      for (let i = 0; i < 10; i++) seedGame('session-2026-09-24', 'Lin', 'Viktor', `2026-09-24T${String(10 + i)}:00:00Z`);
      vi.advanceTimersByTime(31_000);
      const after = await getCanonicalLevel(subject, 'bpm');
      expect(after.basis.game).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('a no-argument invalidation drops every group', async () => {
    const lin = seedMember('Lin');
    seedMember('Viktor');
    const subject = { memberId: lin.id, name: 'Lin' };
    await getCanonicalLevel(subject, 'bpm');
    for (let i = 0; i < 10; i++) seedGame('session-2026-09-24', 'Lin', 'Viktor', `2026-09-24T${String(10 + i)}:00:00Z`);
    invalidateGroupCalibration();
    expect((await getCanonicalLevel(subject, 'bpm')).basis.game).not.toBeNull();
  });
});
