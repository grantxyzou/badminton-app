import { describe, it, expect } from 'vitest';
import { shouldNudgeUpgrade, NUDGE_COOLDOWN_MS } from '../lib/authNudge';

function input(over: Partial<Parameters<typeof shouldNudgeUpgrade>[0]> = {}) {
  return {
    hasPin: true,
    hasPassword: false,
    linkedCount: 0,
    dismissedAt: null,
    ...over,
  };
}

describe('shouldNudgeUpgrade', () => {
  it('nudges a PIN-only member who has never been asked', () => {
    expect(shouldNudgeUpgrade(input())).toBe(true);
  });

  it('never nudges someone with no PIN', () => {
    // Nothing to upgrade FROM: they are anonymous, or arrived via a modern
    // method already.
    expect(shouldNudgeUpgrade(input({ hasPin: false }))).toBe(false);
  });

  it('stops permanently once a password or provider exists', () => {
    // Permanently, not on a cooldown -- the nudge has done its job and
    // re-asking would be nagging.
    expect(shouldNudgeUpgrade(input({ hasPassword: true }))).toBe(false);
    expect(shouldNudgeUpgrade(input({ linkedCount: 1 }))).toBe(false);
    expect(
      shouldNudgeUpgrade(input({ hasPassword: true, dismissedAt: null })),
    ).toBe(false);
  });

  it('respects a 30-day cooldown after a dismissal', () => {
    const now = Date.parse('2026-08-26T00:00:00Z');
    const justDismissed = new Date(now - 1000).toISOString();
    const longAgo = new Date(now - NUDGE_COOLDOWN_MS - 1000).toISOString();

    expect(shouldNudgeUpgrade(input({ dismissedAt: justDismissed, now }))).toBe(false);
    expect(shouldNudgeUpgrade(input({ dismissedAt: longAgo, now }))).toBe(true);
  });

  it('treats a corrupt dismissal timestamp as never dismissed', () => {
    // The failure mode of a bad value should be one extra prompt, not a
    // silently disabled feature nobody can explain.
    expect(shouldNudgeUpgrade(input({ dismissedAt: 'not a date' }))).toBe(true);
  });
});
