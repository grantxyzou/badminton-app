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
      drills: [],
      clubEntries: [{ category: 'racket', label: 'Astrox 88D Pro', count: 2 }],
    });
    expect(reasons.join(' ')).not.toContain('Astrox 88D Pro');
    expect(reasons.join(' ')).not.toContain('2');
  });

  it('does cite a club entry at or above the cohort floor', () => {
    const reasons = buildPickReasons({
      item: ITEM,
      engineReasons: [],
      drills: [],
      clubEntries: [{ category: 'racket', label: 'Astrox 88D Pro', count: 3 }],
    });
    expect(reasons.join(' ')).toContain('3');
  });
});

describe('buildPickReasons — drills grounding', () => {
  it('names what the member is practising without quoting a rating', () => {
    const reasons = buildPickReasons({
      item: ITEM,
      engineReasons: [],
      drills: [{
        id: 'split-step',
        skillKey: 'movement',
        skillLabel: 'Movement',
        title: 'Split steps',
        description: 'x',
        minutes: 10,
        setting: 'solo',
        band: [1, 3],
        reason: 'For your movement (rated 2/5)',
      }],
      clubEntries: [],
    });
    expect(reasons.join(' ')).toContain('movement');
    expect(reasons.join(' ')).not.toContain('2/5');
  });

  it('caps at the limit', () => {
    const reasons = buildPickReasons({
      item: ITEM,
      engineReasons: ['a', 'b', 'c', 'd'],
      drills: [],
      clubEntries: [],
      limit: 3,
    });
    expect(reasons).toHaveLength(3);
  });
});
