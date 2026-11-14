/**
 * The hourly tick (docs/plans/stringing-request-nudge.md).
 *
 * App Service runs nothing on a schedule, so timed work had to ride on
 * something else: the members-first release waits for the next app open, and
 * the payment reminders wait for one club's Gmail script. The tick is one
 * key-protected route (`POST /api/cron/tick`) that GitHub calls every hour
 * (`.github/workflows/tick.yml`); each timed job registers here and is run once
 * per open club.
 *
 * A job must be idempotent within the hour and safe to miss one: GitHub's
 * schedule can be late or skip a run. Stamp what you did on the row BEFORE the
 * side effect (the payment reminders' rule), so a crashed or repeated tick can
 * miss a push but never double one.
 *
 * The key: `CRON_KEY` in App Settings, sent as `x-cron-key`. Unset is a 503,
 * never an open door. Hashed both sides, then `timingSafeEqual` (security rule 11).
 */
import { createHash, timingSafeEqual } from 'crypto';
import { getContainer, ensureContainer } from './cosmos';
import { isFlagOn } from './flags';
import type { Group } from './types';
import { runStringingNudges } from './stringingNudge';
import { sweepStrayAccounts } from './strayAccounts';

export const CRON_KEY_HEADER = 'x-cron-key';

export function cronKeyConfigured(): boolean {
  return !!process.env.CRON_KEY;
}

export function cronKeyMatches(provided: string | null): boolean {
  const expected = process.env.CRON_KEY;
  if (!expected || expected.length < 16 || !provided) return false;
  const a = createHash('sha256').update(provided).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

/** What one job did in one club. Counts only: the tick's answer names nobody. */
export type TickJobResult = Record<string, number>;

export interface TickJob {
  name: string;
  run(groupId: string, now: number): Promise<TickJobResult>;
}

/** Every timed job. Add one here; the route and the schedule need no change. */
export const TICK_JOBS: TickJob[] = [
  { name: 'stringingNudge', run: runStringingNudges },
];

/**
 * A job about the whole deployment rather than one club, run once per tick:
 * the 14-day cleanup of accounts in no club (docs/plans/one-way-in.md, step 6)
 * belongs to no club, so running it per club would run it once per club.
 */
export interface DeploymentTickJob {
  name: string;
  run(now: number): Promise<TickJobResult>;
}

export const DEPLOYMENT_TICK_JOBS: DeploymentTickJob[] = [
  { name: 'strayAccounts', run: async (now) => ({ ...(await sweepStrayAccounts(now)) }) },
];

/**
 * The clubs to run for: every Group doc that is not closed. With groups off
 * there is one club, BPM, whatever the container holds.
 *
 * A Group doc is told from its siblings in the GLOBAL `groups` container
 * (invite, claim-link, leak and operator records) by carrying `ownerMemberId`
 * and no `kind`. Re-checked in JS: the mock store applies no WHERE.
 */
export async function openClubIds(): Promise<string[]> {
  if (!isFlagOn('NEXT_PUBLIC_FLAG_MULTI_GROUP')) return ['bpm'];
  await ensureContainer('groups', '/id');
  const { resources } = await getContainer('groups')
    .items.query<Group & { kind?: string }>({
      query: 'SELECT * FROM c WHERE NOT IS_DEFINED(c.kind) AND IS_DEFINED(c.ownerMemberId)',
    })
    .fetchAll();
  return (resources ?? [])
    .filter((g) => g && !g.kind && typeof g.ownerMemberId === 'string' && !g.closedAt)
    .map((g) => g.id)
    .sort();
}

export interface TickRun {
  clubs: number;
  jobs: Record<string, { ok: number; failed: number; totals: TickJobResult }>;
}

/** Run every job for every open club, then each deployment job once. One failure never stops the rest. */
export async function runTick(
  now: number,
  jobs: TickJob[] = TICK_JOBS,
  deploymentJobs: DeploymentTickJob[] = DEPLOYMENT_TICK_JOBS,
): Promise<TickRun> {
  const clubs = await openClubIds();
  const out: TickRun = { clubs: clubs.length, jobs: {} };
  for (const job of jobs) {
    const summary = { ok: 0, failed: 0, totals: {} as TickJobResult };
    for (const groupId of clubs) {
      try {
        const result = await job.run(groupId, now);
        summary.ok += 1;
        for (const [k, v] of Object.entries(result)) summary.totals[k] = (summary.totals[k] ?? 0) + v;
      } catch (err) {
        summary.failed += 1;
        console.error(`[tick] ${job.name} failed for a club:`, err);
      }
    }
    out.jobs[job.name] = summary;
  }
  for (const job of deploymentJobs) {
    try {
      out.jobs[job.name] = { ok: 1, failed: 0, totals: await job.run(now) };
    } catch (err) {
      out.jobs[job.name] = { ok: 0, failed: 1, totals: {} };
      console.error(`[tick] ${job.name} failed:`, err);
    }
  }
  return out;
}
