/**
 * The ONE read behind what the bench earned (docs/plans/stringing-earnings.md):
 * the Earnings page's route and the club report both come through here, so the
 * page and the report cannot disagree.
 *
 * The shelf comes through `loadStringStock`, the one stock loader, so a job's
 * string cost is what the stock count took off the shelf for it (`jobParts`).
 * The jobs' money fields come from a projection of their own, and a deleted
 * job that was paid comes back from its `stringUse` row (`deletedPaidJobs`).
 */
import { groupScope } from './groupScope';
import { loadStringStock, type LoadedStock } from './stringStocktake';
import { EARNINGS_JOB_SELECT, deletedPaidJobs, summarizeEarnings, type EarningsJob, type EarningsSummary } from './stringingEarnings';

export async function loadStringEarnings(
  groupId: string,
  opts: { now: Date; at?: <T>(name: string, p: Promise<T>) => Promise<T> },
): Promise<{ earnings: EarningsSummary; stock: LoadedStock }> {
  const at = opts.at ?? (<T,>(_n: string, p: Promise<T>) => p);
  const [stock, jobs] = await Promise.all([
    loadStringStock(groupId, { now: opts.now, ...(opts.at ? { at: opts.at } : {}) }),
    at('earnings-jobs', groupScope(groupId).query<EarningsJob>('stringingJobs', { select: EARNINGS_JOB_SELECT })),
  ]);
  const live = new Set(jobs.map((j) => j.id));
  const earnings = summarizeEarnings({
    jobs: [...jobs, ...deletedPaidJobs(stock.uses, live)],
    stock: stock.summary,
    now: opts.now,
  });
  return { earnings, stock };
}
