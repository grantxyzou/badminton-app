import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { resetMockStore, getStore, seedMember, memberCookieValue, setupAdminPin } from './helpers';

/**
 * `GET /api/games?all=true&name=` reads ONE player's games, narrowed in SQL to
 * games naming them (performance audit, 2026-10-19). It used to read every
 * game the club ever logged and filter in JS.
 *
 * The mock store ignores `@needle`, so the filter itself is the JS one the
 * route keeps (games.test.ts covers what comes back). What this file holds is
 * the query the route ASKS for, and the fallback: the subquery form is new to
 * this codebase and nothing in CI runs it against Cosmos, so a refused query
 * must fall back to the full read rather than fail the Stats card.
 */

const queries: Array<{ container: string; where?: string; params?: Array<{ name: string; value: unknown }> }> = [];
let refuseNarrowed = false;

vi.mock('@/lib/groupScope', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/groupScope')>();
  return {
    ...actual,
    groupScope: (groupId: string) => {
      const scope = actual.groupScope(groupId);
      return new Proxy(scope, {
        get(target, prop, receiver) {
          if (prop !== 'query') return Reflect.get(target, prop, receiver);
          return (container: string, q?: { where?: string; params?: Array<{ name: string; value: unknown }> }) => {
            queries.push({ container, where: q?.where, params: q?.params });
            if (refuseNarrowed && container === 'gameResults' && q?.where?.includes('EXISTS')) {
              return Promise.reject(new Error('Syntax error, incorrect syntax near EXISTS'));
            }
            return target.query(container as never, q as never);
          };
        },
      });
    },
  };
});

const { GET } = await import('@/app/api/games/route');

function getAs(name: string, memberId: string) {
  return new NextRequest(new URL(`/api/games?all=true&name=${encodeURIComponent(name)}`, 'http://localhost/bpm'), {
    headers: { cookie: `member_session=${memberCookieValue(name, memberId)}`, 'x-client-ip': `games-narrow-${Math.random()}` },
  });
}

describe('GET /api/games?all=true — narrowed in SQL', () => {
  beforeEach(() => {
    resetMockStore();
    setupAdminPin();
    queries.length = 0;
    refuseNarrowed = false;
    seedMember('Lin', { id: 'm-lin', active: true });
    getStore()['gameResults'] = [
      { id: 'g1', groupId: 'bpm', sessionId: 's1', teamA: ['Lin', 'Viktor'], teamB: ['Akane', 'Kento'], loggedAt: '2026-01-01T00:00:00Z' },
      { id: 'g2', groupId: 'bpm', sessionId: 's2', teamA: ['Akane', 'Kento'], teamB: [' lin ', 'Sindhu'], loggedAt: '2026-02-01T00:00:00Z' },
      { id: 'g3', groupId: 'bpm', sessionId: 's3', teamA: ['Viktor', 'Sindhu'], teamB: ['Akane', 'Kento'], loggedAt: '2026-03-01T00:00:00Z' },
    ];
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('asks for only the games naming the player, case- and space-insensitively', async () => {
    const res = await GET(getAs('LIN', 'm-lin'));
    expect(res.status).toBe(200);
    const q = queries.find((x) => x.container === 'gameResults');
    expect(q?.where).toMatch(/EXISTS\(SELECT VALUE n FROM n IN c\.teamA WHERE LOWER\(TRIM\(n\)\) = @needle\)/);
    expect(q?.where).toMatch(/c\.teamB/);
    expect(q?.params).toEqual([{ name: '@needle', value: 'lin' }]);
    const body = await res.json();
    expect(body.games.map((g: { id: string }) => g.id)).toEqual(['g2', 'g1']);
  });

  it('a refused query falls back to reading every game, with the same answer', async () => {
    refuseNarrowed = true;
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await GET(getAs('Lin', 'm-lin'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.games.map((g: { id: string }) => g.id)).toEqual(['g2', 'g1']);
    const reads = queries.filter((x) => x.container === 'gameResults');
    expect(reads).toHaveLength(2);
    expect(reads[1].where).toBeUndefined();
    expect(error).toHaveBeenCalledWith(expect.stringContaining('[games-all]'), expect.anything());
  });
});
