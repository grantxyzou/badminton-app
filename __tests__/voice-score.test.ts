import { describe, it, expect } from 'vitest';
import { heardText, matchCall, parseCall } from '@/lib/voiceScore';
import type { Score, Side } from '@/lib/scoreRules';

/** What the board does with one transcript at `score`, `server` serving. */
function hear(text: string, score: Score, server: Side | null = null) {
  return matchCall(score, server, [parseCall(text)]);
}

describe('parseCall: the words a recogniser writes', () => {
  it.each([
    ['eleven seven', [11, 7]],
    ['11 7', [11, 7]],
    ['11-7', [11, 7]],
    ['11:7', [11, 7]],
    ['eleven to seven', [11, 7]],
    ['seven love', [7, 0]],
    ['love one', [0, 1]],
    ['twenty-one nineteen', [21, 19]],
    ['Nice shot! Eleven seven.', [11, 7]],
  ])('%s reads %j first', (text, pair) => {
    const first = parseCall(text).readings[0];
    expect(first).toEqual({ kind: 'pair', first: pair[0], second: pair[1] });
  });

  it('"X all" is a level call', () => {
    expect(parseCall('five all').readings[0]).toEqual({ kind: 'all', n: 5 });
    expect(parseCall('20 all').readings[0]).toEqual({ kind: 'all', n: 20 });
  });

  it('"twenty one" alone is 21 or 20 then 1, and the board decides', () => {
    const readings = parseCall('twenty one').readings;
    expect(readings).toContainEqual({ kind: 'pair', first: 20, second: 1 });
  });

  it('hears "service over"', () => {
    expect(parseCall('service over, six five').serviceOver).toBe(true);
    expect(parseCall('six five').serviceOver).toBe(false);
  });

  it('nothing to read', () => {
    expect(parseCall('great rally').readings).toEqual([]);
    expect(parseCall('eleven').readings).toEqual([]);
    expect(parseCall('').readings).toEqual([]);
  });
});

describe('matchCall: one rally on, and nothing else', () => {
  it('the side whose score went up won the rally', () => {
    expect(hear('eleven seven', { a: 10, b: 7 }, 'a')).toEqual({ kind: 'point', side: 'a', heard: [11, 7] });
    // B took the serve back: B's score is called first.
    expect(hear('eight ten', { a: 10, b: 7 }, 'a')).toEqual({ kind: 'point', side: 'b', heard: [8, 10] });
  });

  it('forgives the order: "ten eight" after 10–7 is still B', () => {
    expect(hear('ten eight', { a: 10, b: 7 }, 'a')).toMatchObject({ kind: 'point', side: 'b' });
  });

  it('a neighbouring court\'s call is ignored, never scored', () => {
    expect(hear('fourteen twelve', { a: 10, b: 7 }, 'a')).toEqual({ kind: 'ignored', heard: [14, 12] });
    // Two rallies on is not one rally on.
    expect(hear('twelve seven', { a: 10, b: 7 }, 'a')).toMatchObject({ kind: 'ignored' });
  });

  it('the board\'s own score again does nothing', () => {
    expect(hear('ten seven', { a: 10, b: 7 }, 'a')).toEqual({ kind: 'same' });
  });

  it('"X all": the side that was one behind won', () => {
    expect(hear('five all', { a: 5, b: 4 }, 'a')).toEqual({ kind: 'point', side: 'b', heard: [5, 5] });
    expect(hear('20 all', { a: 19, b: 20 }, 'b')).toMatchObject({ kind: 'point', side: 'a' });
  });

  it('at a level score the words cannot say who won: ask', () => {
    expect(hear('six five', { a: 5, b: 5 }, 'a')).toEqual({ kind: 'ask', heard: [6, 5] });
    // The first rally of the game: nobody has served yet.
    expect(hear('one love', { a: 0, b: 0 }, null)).toEqual({ kind: 'ask', heard: [1, 0] });
  });

  it('"service over" at a level score settles it, when the board knows who served', () => {
    expect(hear('service over, six five', { a: 5, b: 5 }, 'a')).toMatchObject({ kind: 'point', side: 'b' });
    expect(hear('service over six five', { a: 5, b: 5 }, 'b')).toMatchObject({ kind: 'point', side: 'a' });
    // With no server to go on, it still asks.
    expect(hear('service over, one love', { a: 0, b: 0 }, null)).toMatchObject({ kind: 'ask' });
  });

  it('"twenty one nineteen" at 20–19 is A\'s game', () => {
    expect(hear('twenty one nineteen', { a: 20, b: 19 }, 'a')).toMatchObject({ kind: 'point', side: 'a', heard: [21, 19] });
  });

  it('a lost space ("117") is tried every way it splits', () => {
    expect(hear('117', { a: 10, b: 7 }, 'a')).toMatchObject({ kind: 'point', side: 'a', heard: [11, 7] });
    expect(hear('1110', { a: 10, b: 10 }, 'a')).toMatchObject({ kind: 'ask', heard: [11, 10] });
  });

  it('Chrome on Android glues a short call into one number: "10" is one love, "20" two love', () => {
    // Seen on a court, 2026-11-13: "one zero" came back as "10" and the board
    // said "Didn't catch a score".
    expect(hear('10', { a: 0, b: 0 }, null)).toEqual({ kind: 'ask', heard: [1, 0] });
    expect(hear('20', { a: 1, b: 0 }, 'a')).toMatchObject({ kind: 'point', side: 'a', heard: [2, 0] });
    expect(hear('12', { a: 1, b: 1 }, 'a')).toMatchObject({ kind: 'ask', heard: [1, 2] });
  });

  it('a call that reads as written is never split: "10 8" stays ten–eight', () => {
    expect(parseCall('10 8').readings[0]).toEqual({ kind: 'pair', first: 10, second: 8 });
    expect(parseCall('10 8').readings).not.toContainEqual({ kind: 'pair', first: 1, second: 0 });
  });

  it('takes the first alternative that fits, of several the recogniser offered', () => {
    const calls = [parseCall('eleven heaven'), parseCall('eleven seven')];
    expect(matchCall({ a: 10, b: 7 }, 'a', calls)).toMatchObject({ kind: 'point', side: 'a' });
  });

  it('a finished game scores nothing', () => {
    expect(hear('twenty two twenty', { a: 21, b: 19 }, 'a')).toEqual({ kind: 'over' });
  });

  it('no score at all', () => {
    expect(hear('out!', { a: 3, b: 2 }, 'a')).toEqual({ kind: 'none' });
  });

  it('heardText shows the score as spoken', () => {
    expect(heardText([8, 10])).toBe('8–10');
  });
});
