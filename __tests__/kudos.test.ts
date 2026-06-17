import { describe, it, expect } from 'vitest';
import { KUDOS_TAGS, isKudosTag, aggregateKudos, kudosLevelNudge } from '../lib/kudos';

describe('lib/kudos', () => {
  it('exposes a fixed 5-tag set', () => {
    expect(KUDOS_TAGS).toHaveLength(5);
    expect(KUDOS_TAGS).toContain('great_defense');
    expect(KUDOS_TAGS).toContain('nice_shot');
  });

  it('isKudosTag accepts known tags and rejects everything else', () => {
    expect(isKudosTag('clutch')).toBe(true);
    expect(isKudosTag('mvp')).toBe(false);
    expect(isKudosTag(42)).toBe(false);
    expect(isKudosTag(null)).toBe(false);
  });

  it('aggregates counts per tag in canonical order, omitting zeros', () => {
    const docs = [
      { tag: 'nice_shot' }, { tag: 'clutch' }, { tag: 'nice_shot' }, { tag: 'great_defense' },
    ];
    const agg = aggregateKudos(docs);
    expect(agg).toEqual([
      { tag: 'great_defense', count: 1 },
      { tag: 'clutch', count: 1 },
      { tag: 'nice_shot', count: 2 },
    ]);
    // canonical order: great_defense before clutch before nice_shot
    expect(agg.map((a) => a.tag)).toEqual(['great_defense', 'clutch', 'nice_shot']);
  });

  it('ignores unknown / malformed tags', () => {
    const agg = aggregateKudos([{ tag: 'mvp' }, { tag: 'clutch' }, {} as { tag: string }]);
    expect(agg).toEqual([{ tag: 'clutch', count: 1 }]);
  });

  it('returns [] for no docs', () => {
    expect(aggregateKudos([])).toEqual([]);
  });

  it('kudosLevelNudge is 0 in v1 (purely social, no level coupling)', () => {
    expect(kudosLevelNudge(0)).toBe(0);
    expect(kudosLevelNudge(50)).toBe(0);
  });
});
