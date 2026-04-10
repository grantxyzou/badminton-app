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
