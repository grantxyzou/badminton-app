import { describe, it, expect } from 'vitest';
import { summarizeAssessmentTrend, type StoredAssessment } from '../lib/assessment';

/**
 * Trend summarization feeds two consumers: the passive AI insight narrator and
 * (future) any trend display. The contract that matters: "Then" is the
 * immediately-previous snapshot (matching SkillTrendCard), scores are read off
 * the frozen doc, and strength/work-on ordering comes from the latest ratings.
 */

function doc(takenAt: string, overall: number, ratings: { skillKey: string; value: number }[]): StoredAssessment {
  return {
    takenAt,
    overall,
    phase: null,
    ratings: ratings.map((r) => ({ ...r, source: 'self' as const })),
  };
}

// Real skill keys from the SKILLS table so labels resolve.
const R1 = { skillKey: 'serves_returns', value: 4 };
const R2 = { skillKey: 'net_play', value: 2 };
const R3 = { skillKey: 'smashes', value: 5 };

describe('summarizeAssessmentTrend', () => {
  it('returns null when there are no snapshots', () => {
    expect(summarizeAssessmentTrend([])).toBeNull();
  });

  it('ignores malformed docs (no takenAt)', () => {
    const junk = [{ ratings: [], overall: 3 } as unknown as StoredAssessment];
    expect(summarizeAssessmentTrend(junk)).toBeNull();
  });

  it('single snapshot has no Then: prevOverall and delta are null', () => {
    const t = summarizeAssessmentTrend([doc('2026-05-01T00:00:00.000Z', 3.5, [R1, R2, R3])]);
    expect(t).not.toBeNull();
    expect(t!.count).toBe(1);
    expect(t!.overall).toBe(3.5);
    expect(t!.prevOverall).toBeNull();
    expect(t!.delta).toBeNull();
  });

  it('two snapshots: delta is latest.overall − prev.overall (the immediately-previous one)', () => {
    const t = summarizeAssessmentTrend([
      doc('2026-04-01T00:00:00.000Z', 3.0, [R1, R2, R3]),
      doc('2026-05-01T00:00:00.000Z', 3.4, [R1, R2, R3]),
    ]);
    expect(t!.count).toBe(2);
    expect(t!.overall).toBe(3.4);
    expect(t!.prevOverall).toBe(3.0);
    expect(t!.delta).toBeCloseTo(0.4, 5);
  });

  it('with 3+ snapshots, "Then" is the second-most-recent, not the baseline', () => {
    const t = summarizeAssessmentTrend([
      doc('2026-03-01T00:00:00.000Z', 2.0, [R1, R2, R3]), // baseline — should NOT be Then
      doc('2026-04-01T00:00:00.000Z', 3.0, [R1, R2, R3]), // this is "Then"
      doc('2026-05-01T00:00:00.000Z', 3.6, [R1, R2, R3]),
    ]);
    expect(t!.prevOverall).toBe(3.0);
    expect(t!.delta).toBeCloseTo(0.6, 5);
  });

  it('sorts unsorted input by takenAt before reading latest', () => {
    const t = summarizeAssessmentTrend([
      doc('2026-05-01T00:00:00.000Z', 4.0, [R1, R2, R3]),
      doc('2026-03-01T00:00:00.000Z', 2.0, [R1, R2, R3]),
      doc('2026-04-01T00:00:00.000Z', 3.0, [R1, R2, R3]),
    ]);
    expect(t!.latestAt).toBe('2026-05-01T00:00:00.000Z');
    expect(t!.overall).toBe(4.0);
    expect(t!.prevOverall).toBe(3.0);
  });

  it('derives strengths (highest) and workOn (lowest) from the latest ratings, with labels', () => {
    const t = summarizeAssessmentTrend([doc('2026-05-01T00:00:00.000Z', 3.67, [R1, R2, R3])]);
    // Highest first: smashes (5) > serves_returns (4) > net_play (2).
    expect(t!.strengths[0].key).toBe('smashes');
    expect(t!.strengths[0].value).toBe(5);
    expect(t!.strengths[0].label).toBe('Smashes');
    // Lowest first: net_play (2) ...
    expect(t!.workOn[0].key).toBe('net_play');
    expect(t!.workOn[0].value).toBe(2);
    expect(t!.workOn[0].label).toBe('Net Play');
  });

  it('falls back to placePhase when the doc has no stored phase', () => {
    const t = summarizeAssessmentTrend([doc('2026-05-01T00:00:00.000Z', 4.5, [R3])]);
    expect(t!.phase).toBe('advanced'); // 4.5 ≥ 4.3
  });
});
