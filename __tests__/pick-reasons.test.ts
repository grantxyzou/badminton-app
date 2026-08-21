import { describe, it, expect } from 'vitest';
import { buildPickReasons } from '@/lib/pickReasons';
import type { CatalogItem } from '@/lib/types';

const ITEM: CatalogItem = {
  id: 'yonex-astrox-88d',
  category: 'racket',
  brand: 'Yonex',
  model: 'Astrox 88D Pro',
  skillRange: [3, 6],
  attributes: { weight: '3U', balance: 'head-heavy', flex: 'stiff' },
};

describe('buildPickReasons — club data inherits the cohort guard', () => {
  it('never cites a club entry below CLUB_GEAR_MIN_COHORT', () => {
    const reasons = buildPickReasons({
      item: ITEM,
      engineReasons: [],
      clubEntries: [{ category: 'racket', label: 'Astrox 88D Pro', count: 2 }],
    });
    expect(reasons.join(' ')).not.toContain('Astrox 88D Pro');
    expect(reasons.join(' ')).not.toContain('2');
  });

  it('does cite a club entry at or above the cohort floor', () => {
    const reasons = buildPickReasons({
      item: ITEM,
      engineReasons: [],
      clubEntries: [{ category: 'racket', label: 'Astrox 88D Pro', count: 3 }],
    });
    expect(reasons.join(' ')).toContain('3');
  });
});

describe('buildPickReasons — the engine leads and fills', () => {
  it('caps at the limit', () => {
    const reasons = buildPickReasons({
      item: ITEM,
      engineReasons: ['a', 'b', 'c', 'd'],
      clubEntries: [],
      limit: 3,
    });
    expect(reasons).toHaveLength(3);
  });

  it('fills every slot from the engine when the club has nothing to say', () => {
    const reasons = buildPickReasons({
      item: ITEM,
      engineReasons: ['a', 'b', 'c', 'd'],
      clubEntries: [],
    });
    expect(reasons).toEqual(['a', 'b', 'c']);
  });

  /**
   * The inverse of the rule this replaced. Drill grounding used to cap the
   * engine at ONE slot, and since the sheet renders reasons[0] as its headline
   * and only the REST under WHY THIS, that left the drill line as the whole
   * visible list. The engine's reasons are the play-style grounding, so they
   * lead; the club line is evidence of popularity rather than of fit, so it
   * costs the engine exactly one slot and never more.
   */
  it('gives the club line one slot and leaves the rest to the engine', () => {
    const reasons = buildPickReasons({
      item: ITEM,
      engineReasons: [
        'Head-heavy suits your power game',
        'Power frame amplifies your strongest area',
        'Stiff shaft matches your technique level',
      ],
      clubEntries: [{ category: 'racket', label: 'Astrox 88D Pro', count: 5 }],
    });
    expect(reasons).toHaveLength(3);
    expect(reasons.slice(0, 2)).toEqual([
      'Head-heavy suits your power game',
      'Power frame amplifies your strongest area',
    ]);
    expect(reasons[2]).toContain('people in the club already play it');
  });

  it('never emits a drill line, whatever the engine says', () => {
    const reasons = buildPickReasons({
      item: ITEM,
      engineReasons: ['Head-light suits your fast game'],
      clubEntries: [],
    });
    expect(reasons.join(' ')).not.toMatch(/working on|this week's focus/i);
  });
});
