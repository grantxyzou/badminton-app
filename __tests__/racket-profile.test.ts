import { describe, it, expect } from 'vitest';
import { buildProfile } from '../lib/racketProfile';
import type { Rating } from '../lib/assessment';

const r = (skillKey: string, value: number): Rating => ({ skillKey, value, source: 'self' });

describe('buildProfile', () => {
  it('maps all fourteen app skill keys onto engine fields', () => {
    const ratings: Rating[] = [
      r('serves_returns', 1), r('net_play', 2), r('clears_lifts', 3), r('drops', 4),
      r('drives', 5), r('smashes', 1), r('grip_deception', 2),
      r('footwork_split_step', 3), r('court_coverage', 4), r('speed_stamina', 5),
      r('game_reading', 1), r('consistency', 2), r('rules_strategy', 3), r('training_mindset', 4),
    ];
    const p = buildProfile({ ratings, gear: null })!;
    expect(p.serves).toBe(1);
    expect(p.net_play).toBe(2);
    expect(p.clears).toBe(3);
    expect(p.drops).toBe(4);
    expect(p.drives).toBe(5);
    expect(p.smashes).toBe(1);
    expect(p.grip).toBe(2);
    expect(p.footwork).toBe(3);
    expect(p.court_coverage).toBe(4);
    expect(p.stamina).toBe(5);
    expect(p.game_reading).toBe(1);
    expect(p.consistency).toBe(2);
    expect(p.rules).toBe(3);
    expect(p.mindset).toBe(4);
  });

  it('defaults skills the player did not rate to 3', () => {
    // validateRatings accepts any subset of >=1 skill, so partial is normal.
    const p = buildProfile({ ratings: [r('smashes', 5)], gear: null })!;
    expect(p.smashes).toBe(5);
    expect(p.drops).toBe(3);
    expect(p.consistency).toBe(3);
  });

  it('returns null when there are no ratings at all', () => {
    expect(buildProfile({ ratings: [], gear: null })).toBeNull();
  });

  it('reads format, budget and current racket from gear', () => {
    const gear = {
      id: 'gear-m1', memberId: 'm1',
      items: [{ id: 'a', catalogId: 'racket-yonex-astrox-100zz', category: 'racket' as const, label: 'Yonex Astrox 100ZZ' }],
      activeRacketId: 'a',
      playFormat: 'singles' as const,
      budgetMaxCad: 200,
      updatedAt: '2026-08-19T00:00:00Z',
    };
    const p = buildProfile({ ratings: [r('smashes', 3)], gear })!;
    expect(p.format).toBe('singles');
    expect(p.budgetMaxCad).toBe(200);
    expect(p.currentRacketId).toBe('racket-yonex-astrox-100zz');
  });

  it('defaults format to both and leaves budget undefined when gear says nothing', () => {
    const p = buildProfile({ ratings: [r('smashes', 3)], gear: null })!;
    expect(p.format).toBe('both');
    expect(p.budgetMaxCad).toBeUndefined();
    expect(p.currentRacketId).toBeUndefined();
  });

  it('ignores unknown skill keys rather than throwing', () => {
    const p = buildProfile({ ratings: [r('smashes', 4), r('not_a_skill', 5)], gear: null })!;
    expect(p.smashes).toBe(4);
  });
});
