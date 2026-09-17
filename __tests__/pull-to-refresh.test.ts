import { describe, it, expect } from 'vitest';
import { DEAD_ZONE, MAX_PULL, TRIGGER, pullDistance, pullProgress } from '../lib/pullToRefresh';

/** Finger travel needed to arm a refresh, found by walking the curve. */
function travelToTrigger(): number {
  for (let raw = 0; raw < 1000; raw++) if (pullDistance(raw) >= TRIGGER) return raw;
  return Infinity;
}

describe('the pull curve', () => {
  it('ignores the dead zone: the jitter at the top of a scroll moves nothing', () => {
    expect(pullDistance(0)).toBe(0);
    expect(pullDistance(DEAD_ZONE)).toBe(0);
    expect(pullDistance(DEAD_ZONE + 1)).toBeGreaterThan(0);
  });

  it('needs a deliberate pull: more than a flick, well short of the old 283px', () => {
    // ~100px (the first retune) fired on an ordinary flick down at the top of a
    // page, and 283px (the original) was a stretch. Aim for ~180.
    const travel = travelToTrigger();
    expect(travel).toBeGreaterThanOrEqual(160);
    expect(travel).toBeLessThanOrEqual(200);
  });

  it('a flick-sized drag arms nothing', () => {
    expect(pullDistance(120)).toBeLessThan(TRIGGER);
  });

  it('stiffens as it goes and can never run away down the screen', () => {
    const early = pullDistance(DEAD_ZONE + 40) - pullDistance(DEAD_ZONE);
    const late = pullDistance(DEAD_ZONE + 440) - pullDistance(DEAD_ZONE + 400);
    expect(late).toBeLessThan(early / 4);
    expect(pullDistance(5000)).toBeLessThanOrEqual(MAX_PULL);
  });

  it('progress reaches 1 exactly at the trigger and never passes it', () => {
    expect(pullProgress(0)).toBe(0);
    expect(pullProgress(TRIGGER)).toBe(1);
    expect(pullProgress(TRIGGER * 3)).toBe(1);
  });
});
