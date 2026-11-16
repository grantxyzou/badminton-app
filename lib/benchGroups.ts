import type { StringingStatus } from './stringing';

/**
 * The live bench's groups, in the order a stringer works them
 * (docs/plans/stringing-jobs-list.md; Grant's canvas, Option A): what is in
 * hand first (Received, Strung), then what is done (Ready for pickup), then
 * what has not arrived (Requested). Picked up is apart, folded at the foot.
 * An empty group is left out. Order inside a group is the caller's.
 */
export const BENCH_GROUP_ORDER: readonly Exclude<StringingStatus, 'picked_up'>[] = ['received', 'strung', 'ready', 'requested'];

export interface BenchGroup<J> {
  status: Exclude<StringingStatus, 'picked_up'>;
  jobs: J[];
}

export function benchGroups<J extends { status: StringingStatus }>(jobs: readonly J[]): { open: BenchGroup<J>[]; pickedUp: J[] } {
  const open = BENCH_GROUP_ORDER.map((status) => ({ status, jobs: jobs.filter((j) => j.status === status) })).filter(
    (g) => g.jobs.length > 0,
  );
  return { open, pickedUp: jobs.filter((j) => j.status === 'picked_up') };
}
