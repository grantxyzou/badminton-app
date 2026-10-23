// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { requestGameLog, takeGameIntent, hasGameIntent, GAME_INTENT_KEY } from '@/lib/gameIntent';

/** The score widget's Save game → Add a game, parked once (lib/gameIntent.ts). */
describe('the game intent', () => {
  beforeEach(() => sessionStorage.clear());

  it('is parked, read once, and gone', () => {
    requestGameLog({ a: 21, b: 18 });
    expect(hasGameIntent()).toBe(true);
    expect(takeGameIntent()).toEqual({ a: 21, b: 18 });
    expect(hasGameIntent()).toBe(false);
    expect(takeGameIntent()).toBeNull();
  });

  it('drops a marker that is not a score', () => {
    sessionStorage.setItem(GAME_INTENT_KEY, '99-1');
    expect(hasGameIntent()).toBe(false);
    expect(takeGameIntent()).toBeNull();
    expect(sessionStorage.getItem(GAME_INTENT_KEY)).toBeNull();
  });
});
