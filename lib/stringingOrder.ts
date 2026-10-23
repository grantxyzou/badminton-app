import type { StringingJob } from './types';

/**
 * Which jobs are live, and in what order — shared by the jobs route (the
 * bench and a player's Home card) and the widget snapshot (`lib/widget.ts`),
 * so the racket the widget names is the racket the card leads with.
 */

/** Off the bench, not gone. Absent or null means live. */
export function isArchived(job: Pick<StringingJob, 'archivedAt'>): boolean {
  return typeof job.archivedAt === 'string' && job.archivedAt.length > 0;
}

/** Pinned first (most recently pinned on top), then newest. */
export function benchOrder(
  a: Pick<StringingJob, 'prioritizedAt' | 'createdAt'>,
  b: Pick<StringingJob, 'prioritizedAt' | 'createdAt'>,
): number {
  const ap = a.prioritizedAt ?? '';
  const bp = b.prioritizedAt ?? '';
  if (ap !== bp) return bp.localeCompare(ap);
  return b.createdAt.localeCompare(a.createdAt);
}
