import { describe, it, expect } from 'vitest';
import { computeInsightSignals, signalsByCard } from '../lib/insightSignals';
import type { StoredAssessment, Rating } from '../lib/assessment';

/** Build a snapshot. `lows` are skillKeys forced to the lowest value so they
 *  land in the bottom-3; everything else sits comfortably mid. */
function mkSnap(takenAt: string, overall: number, lows: string[] = []): StoredAssessment {
  const ratings: Rating[] = [
    { skillKey: 'smashes', value: 4 },
    { skillKey: 'clears_lifts', value: 4 },
    { skillKey: 'drives', value: 3 },
    { skillKey: 'serves_returns', value: 3 },
    { skillKey: 'consistency', value: 3 },
    { skillKey: 'footwork_split_step', value: 3 },
  ];
  for (const key of lows) {
    const r = ratings.find((x) => x.skillKey === key);
    if (r) r.value = 1;
    else ratings.push({ skillKey: key, value: 1 });
  }
  return { takenAt, ratings, overall, phase: null };
}

const NOW = '2026-06-17T00:00:00.000Z';

describe('computeInsightSignals — the non-obvious bar', () => {
  it('stays SILENT on a single flat mid-band check-in (nothing non-obvious to say)', () => {
    // overall 2.7 sits mid-switch; next band (commitment 3.4) is 0.7 away (> 0.6),
    // so phase-gating does not fire. One snapshot → no trend/streak signals.
    const signals = computeInsightSignals({ snapshots: [mkSnap('2026-01-01', 2.7)], now: NOW });
    expect(signals).toEqual([]);
  });

  it('returns empty for no snapshots', () => {
    expect(computeInsightSignals({ snapshots: [], now: NOW })).toEqual([]);
  });

  it('fires phase-gating when the next phase is close, naming the lever', () => {
    const signals = computeInsightSignals({ snapshots: [mkSnap('2026-05-01', 3.2, ['net_play'])], now: NOW });
    const gating = signals.find((s) => s.kind === 'phase-gating');
    expect(gating).toBeDefined();
    expect(gating!.card).toBe('level');
    expect(gating!.facts.nextPhase).toBe('commitment');
    expect(gating!.facts.gap).toBeCloseTo(0.2, 5);
    expect(gating!.facts.weakest).toBe('Net Play');
  });

  it('fires sticky-weak when a skill stays in the bottom across check-ins', () => {
    const signals = computeInsightSignals({
      snapshots: [
        mkSnap('2026-03-01', 2.6, ['net_play']),
        mkSnap('2026-04-01', 2.7, ['net_play']),
      ],
      now: NOW,
    });
    const sticky = signals.find((s) => s.kind === 'sticky-weak');
    expect(sticky).toBeDefined();
    expect(sticky!.card).toBe('trend');
    expect(sticky!.facts.skill).toBe('Net Play');
    expect(Number(sticky!.facts.count)).toBeGreaterThanOrEqual(2);
  });

  it('fires an improving-streak across 3+ rising check-ins (greeting)', () => {
    const signals = computeInsightSignals({
      snapshots: [
        mkSnap('2026-02-01', 2.0),
        mkSnap('2026-03-01', 2.3),
        mkSnap('2026-04-01', 2.6),
        mkSnap('2026-05-01', 2.9),
      ],
      now: NOW,
    });
    const streak = signals.find((s) => s.kind === 'improving-streak');
    expect(streak).toBeDefined();
    expect(streak!.card).toBe('greeting');
    expect(streak!.facts.sessions).toBe(3);
    expect(streak!.facts.totalChange).toBeCloseTo(0.9, 5);
  });

  it('fires a declining-streak across 3+ falling check-ins, framed for a re-rate', () => {
    const signals = computeInsightSignals({
      snapshots: [
        mkSnap('2026-02-01', 3.2),
        mkSnap('2026-03-01', 2.9),
        mkSnap('2026-04-01', 2.6),
        mkSnap('2026-05-01', 2.3),
      ],
      now: NOW,
    });
    expect(signals.find((s) => s.kind === 'declining-streak')).toBeDefined();
  });

  it('fires a blind-spot from game calibration and is the dominant level signal', () => {
    const canonicalLevel = {
      level: 3.3, stage: 4, phase: 'commitment' as const, confidence: 'high' as const,
      basis: { self: 3.0, game: 3.8, peer: null, legacyStage: null },
      explanation: [], computedAt: NOW,
    };
    const signals = computeInsightSignals({ snapshots: [mkSnap('2026-05-01', 3.0)], canonicalLevel, now: NOW });
    const blind = signals.find((s) => s.kind === 'blindspot');
    expect(blind).toBeDefined();
    expect(blind!.facts.direction).toBe('above');
    expect(blind!.facts.delta).toBeCloseTo(0.8, 5);
    // Higher-scoring than the phase-gating that also fires at 3.0 → wins the slot.
    expect(signalsByCard(signals).level!.kind).toBe('blindspot');
  });

  it('does not fire a blind-spot for a small self-vs-game gap', () => {
    const canonicalLevel = {
      level: 3.0, stage: 4, phase: 'commitment' as const, confidence: 'high' as const,
      basis: { self: 3.0, game: 3.2, peer: null, legacyStage: null },
      explanation: [], computedAt: NOW,
    };
    const signals = computeInsightSignals({ snapshots: [mkSnap('2026-05-01', 3.0)], canonicalLevel, now: NOW });
    expect(signals.find((s) => s.kind === 'blindspot')).toBeUndefined();
  });

  it('signalsByCard picks the highest-scoring signal per card', () => {
    const signals = computeInsightSignals({
      snapshots: [
        mkSnap('2026-03-01', 2.6, ['net_play']),
        mkSnap('2026-04-01', 2.7, ['net_play']),
      ],
      now: NOW,
    });
    const byCard = signalsByCard(signals);
    expect(byCard.trend?.kind).toBe('sticky-weak');
  });
});
