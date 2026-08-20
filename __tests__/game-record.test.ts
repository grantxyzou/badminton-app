import { describe, it, expect } from 'vitest';
import { summarizeRecord } from '../lib/gameRecord';
import type { GameResult } from '../lib/types';

function game(over: Partial<GameResult> = {}): GameResult {
  return {
    id: 'g1',
    sessionId: 'session-2026-08-20',
    teamA: ['Lin', 'Viktor'],
    teamB: ['Akane', 'Kento'],
    scoreA: 21,
    scoreB: 15,
    loggedBy: 'Lin',
    loggedAt: '2026-08-20T00:00:00.000Z',
    ...over,
  } as GameResult;
}

describe('summarizeRecord', () => {
  it('counts a win from the viewer\'s side of the net', () => {
    const r = summarizeRecord([game()], 'Lin');
    expect(r.played).toBe(1);
    expect(r.won).toBe(1);
    expect(r.rows[0].mine).toBe(21);
    expect(r.rows[0].theirs).toBe(15);
  });

  it('flips the scores for a player on the other team', () => {
    const r = summarizeRecord([game()], 'Akane');
    expect(r.rows[0].mine).toBe(15);
    expect(r.rows[0].theirs).toBe(21);
    expect(r.rows[0].won).toBe(false);
    expect(r.won).toBe(0);
  });

  it('matches names case-insensitively — games store names, not ids', () => {
    const r = summarizeRecord([game({ teamA: ['lin', 'Viktor'] })], 'LIN');
    expect(r.played).toBe(1);
  });

  it('reports the partner, not the opponents', () => {
    const r = summarizeRecord([game()], 'Lin');
    expect(r.rows[0].partners).toEqual(['Viktor']);
  });

  it('joins multiple team-mates', () => {
    const r = summarizeRecord([game({ teamA: ['Lin', 'Viktor', 'Sindhu'] })], 'Lin');
    expect(r.rows[0].partners).toEqual(['Viktor', 'Sindhu']);
  });

  it('skips games the player was not in', () => {
    const r = summarizeRecord([game()], 'Nobody');
    expect(r.played).toBe(0);
    expect(r.rows).toEqual([]);
  });

  it('skips a game where the player is somehow on BOTH teams', () => {
    // No coherent "my score" exists — guessing one would invent a result.
    const r = summarizeRecord([game({ teamB: ['Lin', 'Kento'] })], 'Lin');
    expect(r.played).toBe(0);
  });

  it('skips a game with non-numeric scores rather than coercing', () => {
    const r = summarizeRecord([game({ scoreA: undefined as unknown as number })], 'Lin');
    expect(r.played).toBe(0);
  });

  it('does not claim a win on an equal score', () => {
    // Impossible in badminton, but nothing validates it on the way in.
    const r = summarizeRecord([game({ scoreA: 21, scoreB: 21 })], 'Lin');
    expect(r.rows[0].won).toBe(false);
    expect(r.won).toBe(0);
    expect(r.played).toBe(1);
  });

  it('sorts newest first', () => {
    const r = summarizeRecord(
      [
        game({ id: 'old', loggedAt: '2026-01-01T00:00:00.000Z' }),
        game({ id: 'new', loggedAt: '2026-08-01T00:00:00.000Z' }),
      ],
      'Lin',
    );
    expect(r.rows.map((x) => x.id)).toEqual(['new', 'old']);
  });

  it('counts wins across many games', () => {
    const r = summarizeRecord(
      [
        game({ id: 'a', scoreA: 21, scoreB: 15 }),
        game({ id: 'b', scoreA: 18, scoreB: 21 }),
        game({ id: 'c', scoreA: 21, scoreB: 19 }),
      ],
      'Lin',
    );
    expect(r.played).toBe(3);
    expect(r.won).toBe(2);
  });

  it('tolerates an empty list', () => {
    expect(summarizeRecord([], 'Lin')).toEqual({ played: 0, won: 0, rows: [] });
  });
});
