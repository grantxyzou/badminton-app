import { describe, it, expect } from 'vitest';
import { recommendRacket } from '@/lib/recommend';
import type { CatalogItem } from '@/lib/types';

function racket(id: string, range: [number, number], msrp = 100): CatalogItem {
  return { id, category: 'racket', brand: 'B', model: id, msrp, skillRange: range };
}

describe('recommendRacket', () => {
  const catalog: CatalogItem[] = [
    racket('wide', [1, 6], 120),   // widest span = all-rounder
    racket('beginner', [1, 2], 80),
    racket('advanced', [5, 6], 200),
    racket('mid', [3, 4], 140),
  ];

  it('returns the widest-range racket when stage is undefined', () => {
    const rec = recommendRacket({ catalog });
    expect(rec?.id).toBe('wide');
  });

  it('returns a stage-appropriate racket when stage is set', () => {
    const rec = recommendRacket({ stage: 2, catalog });
    // eligible: wide [1,6], beginner [1,2]; closest-centered to stage 2 is beginner (center 1.5) vs wide (center 3.5)
    expect(rec?.id).toBe('beginner');
  });

  it('falls back to all rackets (never null) when stage matches nothing exactly', () => {
    const narrow: CatalogItem[] = [racket('a', [1, 1]), racket('b', [6, 6], 90)];
    const rec = recommendRacket({ stage: 3, catalog: narrow });
    expect(rec).not.toBeNull();
    expect(['a', 'b']).toContain(rec?.id);
  });

  it('returns null only when there are no rackets at all', () => {
    expect(recommendRacket({ catalog: [] })).toBeNull();
    expect(recommendRacket({ catalog: [{ id: 's', category: 'string', brand: 'B', model: 's', skillRange: [1, 6] }] })).toBeNull();
  });

  it('is deterministic — same input yields same output', () => {
    const a = recommendRacket({ stage: 4, catalog });
    const b = recommendRacket({ stage: 4, catalog });
    expect(a?.id).toBe(b?.id);
  });
});
