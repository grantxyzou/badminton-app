import { describe, it, expect } from 'vitest';
import { KUDOS_TAGS, isKudosTag, aggregateKudos, kudosLevelNudge, kudosByMonth, distinctGivers, type KudosDoc } from '../lib/kudos';

describe('lib/kudos', () => {
  it('kudosByMonth: newest month first, notes signed and dated, bare tags only counted', () => {
    const doc = (tag: string, createdAt: string, extra: Record<string, unknown> = {}) =>
      ({ id: createdAt + tag, recipientMemberId: 'r', recipientName: 'Lin', raterMemberId: 'x', raterName: 'Viktor', sessionId: 's', tag, createdAt, ...extra }) as KudosDoc;
    const months = kudosByMonth([
      doc('clutch', '2026-09-11T03:00:00Z'),
      doc('good_sport', '2026-10-09T03:00:00Z', { note: 'Kept your head' }),
      doc('clutch', '2026-10-16T03:00:00Z'),
      doc('clutch', '2026-10-02T03:00:00Z'),
      // 02:00 UTC on 1 Oct is still 30 Sept in Vancouver: the club's month.
      doc('nice_shot', '2026-10-01T02:00:00Z'),
    ]);
    expect(months.map((m) => m.month)).toEqual(['2026-10', '2026-09']);
    expect(months[0].notes.map((n) => n.note)).toEqual(['Kept your head']);
    expect(months[0].tags).toEqual([{ tag: 'clutch', count: 2 }]);
    expect(months[1].tags).toEqual([{ tag: 'clutch', count: 1 }, { tag: 'nice_shot', count: 1 }]);
  });

  it('distinctGivers counts people, case-blind, and never lists them', () => {
    expect(distinctGivers([{ raterName: 'Viktor' }, { raterName: 'viktor ' }, { raterName: 'Akane' }, {}])).toBe(2);
  });

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
