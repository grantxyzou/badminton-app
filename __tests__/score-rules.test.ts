import { describe, it, expect } from 'vitest';
import {
  scoreState,
  addPoint,
  wouldWin,
  reachedInterval,
  serving,
  gameParam,
  parseGameParam,
  CAP,
} from '@/lib/scoreRules';

/**
 * The score widget's rules (docs/plans/native-widgets.md). THIS is the spec
 * the Swift and Java ports are held to: every case here is a case there.
 * The words are the umpire's — game point, 20 all, 29 all — never deuce or
 * advantage (Grant, 2026-10-23).
 */
describe('a game of badminton', () => {
  it('is to 21, won by two', () => {
    expect(scoreState({ a: 21, b: 18 })).toMatchObject({ over: true, winner: 'a' });
    expect(scoreState({ a: 18, b: 21 })).toMatchObject({ over: true, winner: 'b' });
    expect(scoreState({ a: 21, b: 20 })).toMatchObject({ over: false, winner: null });
    expect(scoreState({ a: 22, b: 20 })).toMatchObject({ over: true, winner: 'a' });
  });

  it('calls game point for the side one rally from winning', () => {
    expect(scoreState({ a: 20, b: 18 }).gamePoint).toBe('a');
    expect(scoreState({ a: 18, b: 20 }).gamePoint).toBe('b');
    expect(scoreState({ a: 19, b: 18 }).gamePoint).toBeNull();
    // 21–20: whoever is ahead by one past 20 is at game point.
    expect(scoreState({ a: 21, b: 20 }).gamePoint).toBe('a');
    expect(wouldWin({ a: 20, b: 18 }, 'a')).toBe(true);
    expect(wouldWin({ a: 20, b: 18 }, 'b')).toBe(false);
  });

  it('is "20 all" when level at 20 or above — not deuce', () => {
    expect(scoreState({ a: 20, b: 20 })).toMatchObject({ allAt: 20, gamePoint: null, nextPointWins: false });
    expect(scoreState({ a: 24, b: 24 }).allAt).toBe(24);
    expect(scoreState({ a: 19, b: 19 }).allAt).toBeNull();
  });

  it('caps at 30: 29 all means the next point wins', () => {
    expect(scoreState({ a: 29, b: 29 })).toMatchObject({ allAt: 29, nextPointWins: true });
    expect(scoreState({ a: 30, b: 29 })).toMatchObject({ over: true, winner: 'a' });
    expect(wouldWin({ a: 29, b: 29 }, 'b')).toBe(true);
    expect(CAP).toBe(30);
  });

  it('scores nothing once the game is over', () => {
    const done = { a: 21, b: 15 };
    expect(addPoint(done, 'b')).toEqual(done);
    expect(wouldWin(done, 'a')).toBe(false);
    expect(scoreState(done).gamePoint).toBeNull();
  });

  it('has an interval when the leading side first reaches 11', () => {
    expect(reachedInterval({ a: 10, b: 7 }, { a: 11, b: 7 })).toBe(true);
    // Play resumed: 11–10 is not the interval again.
    expect(reachedInterval({ a: 11, b: 9 }, { a: 11, b: 10 })).toBe(false);
    expect(reachedInterval({ a: 11, b: 10 }, { a: 11, b: 11 })).toBe(false);
  });

  it('serves from whoever won the last rally', () => {
    expect(serving([])).toBeNull();
    expect(serving(['a', 'a', 'b'])).toBe('b');
  });
});

describe('the score in a link', () => {
  it('round-trips', () => {
    expect(gameParam({ a: 21, b: 18 })).toBe('21-18');
    expect(parseGameParam('21-18')).toEqual({ a: 21, b: 18 });
    expect(parseGameParam(' 0-0 ')).toEqual({ a: 0, b: 0 });
  });

  it('drops anything that is not a score', () => {
    for (const bad of [null, undefined, '', '21', '21-', '-18', '31-18', '21-99', '21-18-3', 'a-b', '21–18']) {
      expect(parseGameParam(bad)).toBeNull();
    }
  });
});
