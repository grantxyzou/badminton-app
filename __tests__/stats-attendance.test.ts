import { describe, it, expect, beforeEach } from 'vitest';
import { GET } from '@/app/api/stats/attendance/route';
import {
  resetMockStore,
  seedSession,
  seedPlayer,
  makeRequest,
} from './helpers';

function isoForDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

function makeSessionIds(count: number): string[] {
  // Most recent first — session-2026-04-24, session-2026-04-17, ...
  return Array.from({ length: count }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - i * 7);
    return `session-${d.toISOString().slice(0, 10)}`;
  });
}

describe('GET /api/stats/attendance', () => {
  beforeEach(() => {
    resetMockStore();
  });

  it('returns 400 when name is missing', async () => {
    const res = await GET(makeRequest('GET', 'http://localhost:3000/api/stats/attendance'));
    expect(res.status).toBe(400);
  });

  it('returns zero counts when no sessions exist', async () => {
    const res = await GET(
      makeRequest('GET', 'http://localhost:3000/api/stats/attendance?name=Grant'),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.attended).toBe(0);
    expect(data.streak).toBe(0);
    expect(data.history).toEqual([]);
  });

  it('counts attended sessions, excludes waitlisted and removed', async () => {
    const ids = makeSessionIds(5);
    ids.forEach((id, i) => seedSession(id, { datetime: isoForDaysAgo(i * 7) }));

    seedPlayer(ids[0], 'Grant');
    seedPlayer(ids[1], 'Grant');
    seedPlayer(ids[2], 'Grant', { waitlisted: true });
    seedPlayer(ids[3], 'Grant', { removed: true });
    // ids[4] — no player row

    const res = await GET(
      makeRequest('GET', 'http://localhost:3000/api/stats/attendance?name=Grant&weeks=5'),
    );
    const data = await res.json();
    expect(data.attended).toBe(2);
    expect(data.history).toHaveLength(5);
    expect(data.history[0].attended).toBe(true);
    expect(data.history[1].attended).toBe(true);
    expect(data.history[2].attended).toBe(false);
    expect(data.history[3].attended).toBe(false);
    expect(data.history[4].attended).toBe(false);
  });

  it('name matching is case-insensitive', async () => {
    const ids = makeSessionIds(2);
    ids.forEach((id, i) => seedSession(id, { datetime: isoForDaysAgo(i * 7) }));
    seedPlayer(ids[0], 'GRANT');
    seedPlayer(ids[1], 'grant');

    const res = await GET(
      makeRequest('GET', 'http://localhost:3000/api/stats/attendance?name=Grant&weeks=2'),
    );
    const data = await res.json();
    expect(data.attended).toBe(2);
  });

  it('computes current streak from most-recent run', async () => {
    const ids = makeSessionIds(5);
    ids.forEach((id, i) => seedSession(id, { datetime: isoForDaysAgo(i * 7) }));
    seedPlayer(ids[0], 'Grant');
    seedPlayer(ids[1], 'Grant');
    seedPlayer(ids[2], 'Grant');
    // missed ids[3]
    seedPlayer(ids[4], 'Grant');

    const res = await GET(
      makeRequest('GET', 'http://localhost:3000/api/stats/attendance?name=Grant&weeks=5'),
    );
    const data = await res.json();
    expect(data.streak).toBe(3); // most-recent 3 in a row
    expect(data.longestStreak).toBe(3);
  });

  it('longestStreak finds the best run even when current streak is shorter', async () => {
    const ids = makeSessionIds(7);
    ids.forEach((id, i) => seedSession(id, { datetime: isoForDaysAgo(i * 7) }));
    // Most-recent first: played, missed, played, played, played, played, missed
    seedPlayer(ids[0], 'Grant');
    seedPlayer(ids[2], 'Grant');
    seedPlayer(ids[3], 'Grant');
    seedPlayer(ids[4], 'Grant');
    seedPlayer(ids[5], 'Grant');

    const res = await GET(
      makeRequest('GET', 'http://localhost:3000/api/stats/attendance?name=Grant&weeks=7'),
    );
    const data = await res.json();
    expect(data.streak).toBe(1); // only the latest, then a miss
    expect(data.longestStreak).toBe(4);
  });

  it('respects the weeks window parameter', async () => {
    const ids = makeSessionIds(20);
    ids.forEach((id, i) => seedSession(id, { datetime: isoForDaysAgo(i * 7) }));
    ids.forEach((id) => seedPlayer(id, 'Grant'));

    const res = await GET(
      makeRequest('GET', 'http://localhost:3000/api/stats/attendance?name=Grant&weeks=8'),
    );
    const data = await res.json();
    expect(data.history).toHaveLength(8);
    expect(data.attended).toBe(8);
  });

  it('clamps weeks to a reasonable range', async () => {
    const ids = makeSessionIds(3);
    ids.forEach((id, i) => seedSession(id, { datetime: isoForDaysAgo(i * 7) }));

    const res = await GET(
      makeRequest('GET', 'http://localhost:3000/api/stats/attendance?name=Grant&weeks=99999'),
    );
    const data = await res.json();
    expect(data.weeks).toBeLessThanOrEqual(52);
  });
});
