import { describe, it, expect } from 'vitest';
import { birdReorder, birdWeeksLeft } from '../lib/birdRunway';

/** One reorder rule for the Birds tile, the Birds page and Profile's count. */
describe('birdReorder', () => {
  it('is now under two weeks of runway, soon under four, ok after', () => {
    expect(birdReorder(3, 2)).toBe('now'); // 1.5 weeks
    expect(birdReorder(6, 2)).toBe('soon'); // 3 weeks
    expect(birdReorder(8, 2)).toBe('ok'); // 4 weeks
  });
  it('an empty cupboard at a club that uses birds is reorder now', () => {
    // The old Profile count read zero stock as "unknown" and skipped it.
    expect(birdReorder(0, 2)).toBe('now');
  });
  it('no burn history is unknown, even at zero — a club that never tracked birds is not "out"', () => {
    expect(birdReorder(0, 0)).toBeNull();
    expect(birdReorder(12, 0)).toBeNull();
    expect(birdWeeksLeft(12, 0)).toBeNull();
  });
});
