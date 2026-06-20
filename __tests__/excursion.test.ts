// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { markExternalExcursion, consumeRecentExcursion } from '@/lib/excursion';

const KEY = 'badminton_excursion_at';

describe('external excursion marker', () => {
  beforeEach(() => localStorage.clear());

  it('returns false when nothing was marked', () => {
    expect(consumeRecentExcursion()).toBe(false);
  });

  it('returns true for a fresh marker, then consumes it (one-shot)', () => {
    markExternalExcursion();
    expect(consumeRecentExcursion()).toBe(true);
    // The marker is cleared on read so it can't leak into a later cold start.
    expect(consumeRecentExcursion()).toBe(false);
  });

  it('returns false for a stale marker (older than the window)', () => {
    localStorage.setItem(KEY, String(Date.now() - 5 * 60_000));
    expect(consumeRecentExcursion(3 * 60_000)).toBe(false);
    // and it still clears the stale marker
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('ignores a non-numeric marker', () => {
    localStorage.setItem(KEY, 'not-a-number');
    expect(consumeRecentExcursion()).toBe(false);
  });
});
