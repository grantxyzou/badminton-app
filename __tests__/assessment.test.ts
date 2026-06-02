import { describe, it, expect } from 'vitest';
import {
  SKILLS,
  scoreAssessment,
  topStrengths,
  workOnNext,
  placePhase,
} from '../lib/assessment';

describe('SKILLS table (from docs/badminton-spec-md.md §2,§4)', () => {
  it('defines exactly 14 skills', () => {
    expect(SKILLS).toHaveLength(14);
  });

  it('splits 7 technical / 3 physical / 4 mental', () => {
    const byDim = (d: string) => SKILLS.filter((s) => s.dimension === d).length;
    expect(byDim('technical')).toBe(7);
    expect(byDim('physical')).toBe(3);
    expect(byDim('mental')).toBe(4);
  });

  it('gives every skill a unique key, a label, and 5 non-empty anchors', () => {
    const keys = new Set<string>();
    for (const s of SKILLS) {
      expect(typeof s.label).toBe('string');
      expect(s.label.length).toBeGreaterThan(0);
      expect(s.anchors).toHaveLength(5);
      expect(s.anchors.every((a) => typeof a === 'string' && a.length > 0)).toBe(true);
      keys.add(s.key);
    }
    expect(keys.size).toBe(14);
  });
});

describe('scoreAssessment (§5)', () => {
  it('averages only the rated skills, per dimension and overall', () => {
    const ratings = [
      { skillKey: 'serves_returns', value: 4 },
      { skillKey: 'net_play', value: 2 }, // technical avg = 3
      { skillKey: 'speed_stamina', value: 5 }, // physical avg = 5
    ];
    const r = scoreAssessment(ratings);
    expect(r.dimensionScores.technical).toBe(3);
    expect(r.dimensionScores.physical).toBe(5);
    expect(r.dimensionScores.mental).toBeNull(); // none rated
    expect(r.overall).toBeCloseTo(11 / 3);
  });

  it('returns nulls when nothing is rated', () => {
    const r = scoreAssessment([]);
    expect(r.overall).toBeNull();
    expect(r.dimensionScores.technical).toBeNull();
    expect(r.dimensionScores.physical).toBeNull();
    expect(r.dimensionScores.mental).toBeNull();
  });

  it('ignores ratings for unknown skill keys', () => {
    const r = scoreAssessment([
      { skillKey: 'serves_returns', value: 4 },
      { skillKey: 'not_a_skill', value: 1 },
    ]);
    expect(r.overall).toBe(4);
    expect(r.dimensionScores.technical).toBe(4);
  });
});

describe('topStrengths / workOnNext (§5)', () => {
  const ratings = [
    { skillKey: 'serves_returns', value: 5 },
    { skillKey: 'net_play', value: 4 },
    { skillKey: 'drops', value: 3 },
    { skillKey: 'smashes', value: 2 },
    { skillKey: 'consistency', value: 1 },
  ];

  it('returns the 3 highest-rated as strengths (desc)', () => {
    expect(topStrengths(ratings).map((x) => x.skillKey)).toEqual([
      'serves_returns',
      'net_play',
      'drops',
    ]);
  });

  it('returns the 3 lowest-rated as work-on-next (asc)', () => {
    expect(workOnNext(ratings).map((x) => x.skillKey)).toEqual([
      'consistency',
      'smashes',
      'drops',
    ]);
  });

  it('returns all rated when fewer than 3 are rated', () => {
    const few = [
      { skillKey: 'drops', value: 3 },
      { skillKey: 'drives', value: 5 },
    ];
    expect(topStrengths(few)).toHaveLength(2);
    expect(workOnNext(few)).toHaveLength(2);
  });
});

describe('placePhase (§6) — highest band whose minimum is met', () => {
  it('maps the overall score to a development phase', () => {
    expect(placePhase(1.0)).toBe('foundation');
    expect(placePhase(1.79)).toBe('foundation');
    expect(placePhase(1.8)).toBe('exploration');
    expect(placePhase(2.59)).toBe('exploration');
    expect(placePhase(2.6)).toBe('switch');
    expect(placePhase(3.39)).toBe('switch');
    expect(placePhase(3.4)).toBe('commitment');
    expect(placePhase(4.29)).toBe('commitment');
    expect(placePhase(4.3)).toBe('advanced');
    expect(placePhase(5.0)).toBe('advanced');
  });

  it('returns null when there is no overall score', () => {
    expect(placePhase(null)).toBeNull();
  });
});
