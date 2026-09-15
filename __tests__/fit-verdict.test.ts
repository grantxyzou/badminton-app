import { describe, it, expect } from 'vitest';
import { computeFitFacts } from '../lib/fitVerdict';
import { effectiveArmComfort, fitAnswers, nearestLevelOption } from '../lib/fitProfile';
import type { CatalogItem, GearItem, PlayerGear } from '../lib/types';

/**
 * The fit verdict's facts table. The STATE and every number are decided here,
 * in code — an AI may word them, never change them — so these cases are the
 * product rule written down.
 */

function row(attributes: Record<string, unknown>): CatalogItem {
  return { id: 'racket-x', category: 'racket', brand: 'Yonex', model: 'Astrox 77', attributes } as unknown as CatalogItem;
}

function gear(over: Partial<PlayerGear> = {}, tensionLbs?: number, racket: Partial<GearItem> = {}): PlayerGear {
  return {
    id: 'gear-m1', memberId: 'm1', updatedAt: '',
    items: [
      { id: 'r1', catalogId: 'racket-x', category: 'racket', label: 'Yonex Astrox 77', ...racket },
      { id: 's1', catalogId: 'bg65', category: 'string', label: 'BG65', ...(tensionLbs === undefined ? {} : { tensionLbs }) },
    ],
    activeRacketId: 'r1',
    fitLevelOverride: '3.2', fitPlayStyle: 'doubles', fitSwing: 'medium', fitGrip: 'G4', fitSoreness: 'none', fitGoal: 'happy',
    ...over,
  } as PlayerGear;
}

const EVEN_MEDIUM = row({ balance: 'Even', flex: 'Medium', weight: '4U' });

describe('fitProfile', () => {
  it('reads a sore elbow as the comfort answer the engines already know', () => {
    expect(effectiveArmComfort({ fitSoreness: 'elbow' })).toBe('sometimes_sore');
    expect(effectiveArmComfort({ fitSoreness: 'none', fitArmComfort: 'often_sore' })).toBe('fine');
    expect(effectiveArmComfort({ fitArmComfort: 'often_sore' })).toBe('often_sore');
    // A named joint does not ease an older "often sore" by a pound.
    expect(effectiveArmComfort({ fitSoreness: 'wrist', fitArmComfort: 'often_sore' })).toBe('often_sore');
    expect(effectiveArmComfort(null)).toBeUndefined();
  });

  it('rounds a check-in level to the nearest option on the page', () => {
    expect(nearestLevelOption(null)).toBeNull();
    expect(nearestLevelOption(1)).toBe('2.0');
    expect(nearestLevelOption(3.3)).toBe('3.2');
    expect(nearestLevelOption(3.4)).toBe('3.5+');
    expect(nearestLevelOption(4.2)).toBe('3.5+');
  });

  it('counts a level pre-filled from a check-in as answered', () => {
    const bare = { id: 'g', memberId: 'm', updatedAt: '', items: [] } as PlayerGear;
    expect(fitAnswers(bare, null).answered).toBe(0);
    expect(fitAnswers(bare, 3).answered).toBe(1);
    expect(fitAnswers(gear(), null).answered).toBe(5);
  });
});

describe('computeFitFacts', () => {
  it('suits: every answer in, frame agrees with the swing, tension inside the range', () => {
    const f = computeFitFacts({ gear: gear({}, 24), frameRow: EVEN_MEDIUM, checkInLevel: null });
    expect(f.state).toBe('suits');
    expect(f.tensionRange).toEqual([24, 25]);
    expect(f.sorenessMovedRange).toBe(false);
    expect(f.reasons.every((r) => r.polarity === 'plus')).toBe(true);
  });

  it('fighting slightly: one pound over the range is a half-weight nudge', () => {
    const f = computeFitFacts({ gear: gear({}, 26), frameRow: EVEN_MEDIUM, checkInLevel: null });
    expect(f.state).toBe('fighting_slightly');
    expect(f.reasons[0]).toEqual({ key: 'tensionHigh', polarity: 'minus' });
  });

  it('fighting: a stiff, heavy, head-heavy frame strung tight for a slow swing and a sore elbow', () => {
    const f = computeFitFacts({
      gear: gear({ fitSwing: 'slow', fitSoreness: 'elbow', fitGoal: 'more_control' }, 27),
      frameRow: row({ balance: 'Head-heavy', flex: 'Stiff', weight: '3U' }),
      checkInLevel: null,
    });
    expect(f.state).toBe('fighting');
    // round(21 + 3.2) − 1 (sore arm); swing never moves tension
    expect(f.tensionRange).toEqual([23, 24]);
    expect(f.sorenessMovedRange).toBe(true);
    expect(f.reasons).toHaveLength(3);
    expect(f.reasons.every((r) => r.polarity === 'minus')).toBe(true);
  });

  it('reads the goal on the fit engine’s own balance axis', () => {
    const light = row({ balance: 'Head-light', flex: 'Medium', weight: '4U' });
    const power = computeFitFacts({ gear: gear({ fitGoal: 'more_power' }, 24), frameRow: light, checkInLevel: null });
    expect(power.reasons[0]).toEqual({ key: 'goalAgainstBalance', polarity: 'minus' });
    expect(power.state).toBe('fighting_slightly');
    const faster = computeFitFacts({ gear: gear({ fitGoal: 'faster' }, 24), frameRow: light, checkInLevel: null });
    expect(faster.reasons.map((r) => r.key)).toContain('goalWithBalance');
    expect(faster.state).toBe('suits');
  });

  it('names the same tension the string pick does when frame, string and check-in are known', async () => {
    const { pairTension } = await import('../lib/stringPair');
    const { buildProfile } = await import('../lib/racketProfile');
    const frameRow = row({ balance: 'Even', flex: 'Medium', weight: '4U', tensionMinLbs: 20, tensionMaxLbs: 30 });
    const stringRow = { id: 'bg65', category: 'string', brand: 'Yonex', model: 'BG65', attributes: { tensionMinLbs: 20, tensionMaxLbs: 28 } } as unknown as CatalogItem;
    const g = gear({ fitSoreness: 'elbow' }, 24);
    const profile = buildProfile({ ratings: [{ skillKey: 'grip_deception', value: 5 }, { skillKey: 'footwork_split_step', value: 5 }, { skillKey: 'court_coverage', value: 5 }] as never, gear: g });
    // Not a coincidence with the level fallback (23–24): the pairing places this higher.
    expect(Math.floor(pairTension(frameRow, stringRow, profile!, -1)!)).not.toBe(23);
    const paired = pairTension(frameRow, stringRow, profile!, -1)!;
    const f = computeFitFacts({ gear: g, frameRow, stringRow, profile, checkInLevel: null });
    expect(f.tensionRange![0]).toBe(Math.floor(paired));
  });

  it('mixed doubles does not inherit an older singles format', () => {
    const f = computeFitFacts({ gear: gear({ fitPlayStyle: 'mixed', playFormat: 'singles' }, 24), frameRow: EVEN_MEDIUM, checkInLevel: null });
    expect(f.tensionRange).toEqual([24, 25]);
  });

  it('a prospective frame is judged from its row, with no current tension', () => {
    const f = computeFitFacts({ gear: gear({}, 29), frameRow: EVEN_MEDIUM, checkInLevel: null, prospective: true });
    expect(f.currentTensionLbs).toBeNull();
    expect(f.frame?.name).toBe('Astrox 77');
    expect(f.state).toBe('suits');
  });

  it('a dual weight class is not called heavy', () => {
    const f = computeFitFacts({
      gear: gear({ fitSoreness: 'wrist' }, 23),
      frameRow: row({ balance: 'Even', flex: 'Medium', weight: '3U/4U' }),
      checkInLevel: null,
    });
    expect(f.reasons.map((r) => r.key)).not.toContain('heavyForArm');
  });

  it('declines to judge with four answers, or with no racket', () => {
    expect(computeFitFacts({ gear: gear({ fitSoreness: undefined }, 24), frameRow: EVEN_MEDIUM, checkInLevel: null }).state)
      .toBe('insufficient');
    const noRacket = { ...gear({}, 24), items: [], activeRacketId: undefined } as PlayerGear;
    const f = computeFitFacts({ gear: noRacket, frameRow: null, checkInLevel: null });
    expect(f.state).toBe('insufficient');
    expect(f.frame).toBeNull();
  });

  it('keeps the range inside the frame’s rated window', () => {
    const f = computeFitFacts({
      gear: gear({ fitLevelOverride: '3.5+', fitPlayStyle: 'singles', fitSwing: 'fast' }, 24),
      frameRow: row({ balance: 'Even', flex: 'Stiff', weight: '4U', tensionMaxLbs: 24 }),
      checkInLevel: null,
    });
    expect(f.tensionRange).toEqual([23, 24]);
  });

  it('uses the real check-in level when the member has not set one', () => {
    const f = computeFitFacts({ gear: gear({ fitLevelOverride: undefined }, 25), frameRow: EVEN_MEDIUM, checkInLevel: 4 });
    // round(21 + 4) = 25
    expect(f.tensionRange).toEqual([25, 26]);
  });

  it('judges a typed-in racket by the feel the member gave it', () => {
    const f = computeFitFacts({
      gear: gear({}, 24, { catalogId: null, label: 'Old Carlton', feel: { balance: 'Even', flex: 'Medium', weight: '4U' } }),
      frameRow: null,
      checkInLevel: null,
    });
    expect(f.state).toBe('suits');
    expect(f.frame?.name).toBe('Old Carlton');
  });
});

describe('a G3 grip', () => {
  // Not compared through recommendFit: the top picks clamp at 100, so a
  // six-point grip penalty is invisible there and a comparison passes either way.
  it('is scored as G4 — the catalog sells nothing thicker — not as a miss on every frame', async () => {
    const { buildFitInput } = await import('../lib/racketFitInput');
    const { axesOf, buildTarget, scoreFit } = await import('../lib/racketFit');
    const row = { id: 'r', category: 'racket', brand: 'X', model: 'Y', attributes: { balance: 'Even', flex: 'Medium', tier: 'Mid-range', gripSize: 'G4/G5', weightMinG: 80, weightMaxG: 84 } } as unknown as CatalogItem;
    const base = { id: 'g', memberId: 'm', updatedAt: '', items: [], fitGoal: 'more_control', fitSwing: 'medium' } as unknown as PlayerGear;
    const input = buildFitInput({ ...base, fitGrip: 'G3' } as PlayerGear, [], [row]);
    expect(input.grip).toBe('G4');
    const target = buildTarget(input, null);
    const asG3 = scoreFit(row, axesOf(row)!, target, { ...input, grip: 'G3' }, null);
    const mapped = scoreFit(row, axesOf(row)!, target, input, null);
    expect(asG3.score).toBeLessThan(mapped.score);
  });
});
