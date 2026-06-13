import { describe, it, expect } from 'vitest';
import { calibrateRatings, blindSpot, ELO, type CalGame, type CalSeed } from '../lib/calibration';

const NOW = '2026-06-13T00:00:00.000Z';
function ago(days: number): string {
  return new Date(Date.parse(NOW) - days * 86_400_000).toISOString();
}
function game(teamA: string[], teamB: string[], scoreA: number, scoreB: number, days = 5): CalGame {
  return { teamA, teamB, scoreA, scoreB, loggedAt: ago(days) };
}
function seeds(map: Record<string, number | null>): CalSeed[] {
  return Object.entries(map).map(([nameLower, selfLevel]) => ({ nameLower, selfLevel }));
}

describe('calibrateRatings', () => {
  it('moves the winner up and loser down symmetrically from equal seeds', () => {
    const m = calibrateRatings([game(['a'], ['b'], 21, 10)], seeds({ a: 3.0, b: 3.0 }), NOW);
    const a = m.get('a')!;
    const b = m.get('b')!;
    expect(a.observedLevel).toBeGreaterThan(3.0);
    expect(b.observedLevel).toBeLessThan(3.0);
    // Symmetric up to 2-decimal rounding of the stored observed levels.
    expect(Math.abs((a.observedLevel - 3.0) - (3.0 - b.observedLevel))).toBeLessThanOrEqual(0.02);
    expect(a.wins).toBe(1);
    expect(b.wins).toBe(0);
  });

  it('rewards an upset far more than an expected result', () => {
    const upset = calibrateRatings([game(['weak'], ['strong'], 21, 19)], seeds({ weak: 2.0, strong: 4.0 }), NOW);
    const expected = calibrateRatings([game(['strong'], ['weak'], 21, 19)], seeds({ weak: 2.0, strong: 4.0 }), NOW);
    const upsetGain = upset.get('weak')!.observedLevel - 2.0;
    const expectedGain = expected.get('strong')!.observedLevel - 4.0;
    expect(upsetGain).toBeGreaterThan(expectedGain * 3);
  });

  it('moves more on a blowout than a squeaker (same matchup)', () => {
    const blowout = calibrateRatings([game(['a'], ['b'], 21, 2)], seeds({ a: 3.0, b: 3.0 }), NOW);
    const squeaker = calibrateRatings([game(['a'], ['b'], 21, 19)], seeds({ a: 3.0, b: 3.0 }), NOW);
    expect(blowout.get('a')!.observedLevel).toBeGreaterThan(squeaker.get('a')!.observedLevel);
  });

  it('flips provisional off once a player reaches the provisional-game threshold', () => {
    const seven = Array.from({ length: 7 }, () => game(['a'], ['b'], 21, 15));
    const eight = Array.from({ length: 8 }, () => game(['a'], ['b'], 21, 15));
    expect(calibrateRatings(seven, seeds({ a: 3, b: 3 }), NOW).get('a')!.provisional).toBe(true);
    const e = calibrateRatings(eight, seeds({ a: 3, b: 3 }), NOW).get('a')!;
    expect(e.provisional).toBe(false);
    expect(e.games).toBe(ELO.PROVISIONAL_GAMES);
  });

  it('excludes games older than the window', () => {
    const m = calibrateRatings([game(['a'], ['b'], 21, 10, ELO.WINDOW_DAYS + 35)], seeds({ a: 3, b: 3 }), NOW);
    expect(m.has('a')).toBe(false);
    expect(m.has('b')).toBe(false);
  });

  it('clamps observed levels to [1, 5] under lopsided histories', () => {
    const wins = Array.from({ length: 30 }, () => game(['a'], ['b'], 21, 2));
    const m = calibrateRatings(wins, seeds({ a: 5.0, b: 1.0 }), NOW);
    expect(m.get('a')!.observedLevel).toBeLessThanOrEqual(5);
    expect(m.get('b')!.observedLevel).toBeGreaterThanOrEqual(1);
  });

  it('seeds unknown players at DEFAULT_SEED and is deterministic', () => {
    const games = [game(['a', 'newbie'], ['b', 'c'], 21, 18), game(['a'], ['b'], 19, 21)];
    const s = seeds({ a: 3.2, b: 3.0 });
    const first = calibrateRatings(games, s, NOW);
    const second = calibrateRatings(games, s, NOW);
    expect(first.has('newbie')).toBe(true); // appeared in a game, no seed
    expect(JSON.stringify([...first])).toBe(JSON.stringify([...second]));
  });
});

describe('blindSpot — opt-in asymmetric gating', () => {
  it('returns null until there are enough games', () => {
    expect(blindSpot(3.0, { observedLevel: 4.0, games: 7 })).toBeNull();
  });

  it('surfaces "above" readily (≥0.4 over ≥8 games)', () => {
    expect(blindSpot(3.0, { observedLevel: 3.4, games: 8 })).toEqual({ delta: 0.4, direction: 'above' });
  });

  it('holds "below" to a higher bar (≥0.6 AND ≥12 games)', () => {
    expect(blindSpot(3.0, { observedLevel: 2.5, games: 10 })).toBeNull(); // only -0.5
    expect(blindSpot(3.0, { observedLevel: 2.3, games: 8 })).toBeNull();  // -0.7 but <12 games
    expect(blindSpot(3.0, { observedLevel: 2.3, games: 12 })).toEqual({ delta: -0.7, direction: 'below' });
  });

  it('returns null with no self level', () => {
    expect(blindSpot(null, { observedLevel: 4.0, games: 20 })).toBeNull();
  });
});
