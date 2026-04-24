import type { BirdUsage, Session } from './types';

/**
 * Reads the bird usages off a session document, tolerating both the
 * legacy single-object shape (`birdUsage`) and the current array shape
 * (`birdUsages`). Always returns an array. Never mutates the input.
 *
 * Writes should always go through the `birdUsages` array — the legacy
 * field is read-only and will be dropped the next time a session is saved.
 */
export function normalizeBirdUsages(
  session: Pick<Session, 'birdUsage' | 'birdUsages'> | null | undefined,
): BirdUsage[] {
  if (!session) return [];
  if (Array.isArray(session.birdUsages)) return session.birdUsages;
  const legacy = session.birdUsage;
  if (legacy && typeof legacy === 'object' && typeof legacy.tubes === 'number') {
    return [legacy];
  }
  return [];
}

export function totalTubes(usages: BirdUsage[]): number {
  return usages.reduce((sum, u) => sum + (u.tubes ?? 0), 0);
}

export function totalBirdCost(usages: BirdUsage[]): number {
  const raw = usages.reduce((sum, u) => sum + (u.totalBirdCost ?? 0), 0);
  return Math.round(raw * 100) / 100;
}

/**
 * Sums tubes used across the given sessions. Accepts either full sessions
 * (reads via `normalizeBirdUsages`) or already-normalized usage arrays.
 */
export function tubesUsedAcross(sessions: Array<Pick<Session, 'birdUsage' | 'birdUsages'>>): number {
  let sum = 0;
  for (const s of sessions) {
    for (const u of normalizeBirdUsages(s)) sum += u.tubes ?? 0;
  }
  return Math.round(sum * 10) / 10;
}

/**
 * Average tubes used per session over the most recent `window` sessions
 * that actually had bird usage recorded. Sessions with zero tubes are
 * excluded from the denominator (they'd drag the average toward zero and
 * make the runway overly optimistic).
 */
export function avgTubesPerSession(
  sessions: Array<Pick<Session, 'birdUsage' | 'birdUsages'>>,
  window = 8,
): number {
  const perSession = sessions
    .map((s) => {
      const tubes = normalizeBirdUsages(s).reduce((sum, u) => sum + (u.tubes ?? 0), 0);
      return tubes;
    })
    .filter((t) => t > 0)
    .slice(-window);
  if (perSession.length === 0) return 0;
  const sum = perSession.reduce((a, b) => a + b, 0);
  return Math.round((sum / perSession.length) * 10) / 10;
}

/**
 * Runway in weeks at the current usage pace. Assumes one session per week
 * (matches the app's cadence — one session per weekly friend game). Returns
 * Infinity when avg is zero and there's still stock (nothing to deplete);
 * 0 when stock is zero.
 */
export function runwayWeeks(remainingTubes: number, avgPerSession: number): number {
  if (remainingTubes <= 0) return 0;
  if (avgPerSession <= 0) return Infinity;
  return Math.round((remainingTubes / avgPerSession) * 10) / 10;
}
