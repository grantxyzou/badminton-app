import { groupScope } from './groupScope';
import { stringingServiceOnFor } from './stringingService';
import { readOfferedStringsWithLinks } from './stringingStrings';
import {
  STOCK_JOB_SELECT, countedJob, readStringCatalog, readStringPurchases, readStringUses, summarizeStringStock, withDeletedUses,
  type StringStockSummary,
} from './stringStock';
import { STRINGING_FLOW, type StringingStatus } from './stringing';
import type { StringingJob } from './types';

/**
 * The string shelf as the club report reads it (docs/plans/string-usage-rate.md):
 * the same `summarizeStringStock` the bench reads, so the report and the shelf
 * cannot disagree, folded to numbers. Labels and counts only — never a name,
 * a contact or a member's money. `clubMetrics()` attaches it as
 * `stringShelf`, which both the admin Metrics read and the key-protected
 * report return.
 */
export interface StringShelfReportLine {
  label: string;
  purchases: number;
  usedSets: number;
  remainingSets: number;
  overdrawnSets: number;
  /** One decimal; `null` when no strung date is known. */
  setsPerWeek: number | null;
  /** One decimal; `null` with no rate. */
  weeksLeft: number | null;
  reorder: 'now' | 'soon' | 'ok' | null;
  /** What a set costs the club to replace (the latest paid reel); `null` until one is logged. */
  costPerSetCents: number | null;
}

export interface StringShelfReport {
  jobs: {
    total: number;
    live: number;
    archived: number;
    /** Every stage in `STRINGING_FLOW`, 0 included, so a reader never mistakes a missing key for none. */
    byStatus: Record<StringingStatus, number>;
    /** Jobs where the player brought the string (they use no set). */
    ownString: number;
  };
  lines: StringShelfReportLine[];
  /** Strung sets whose label matched no shelf string. */
  unmatchedSets: number;
  totals: { usedSets: number; overdrawnSets: number; remainingValueCents: number; purchasedCostCents: number };
}

type ReportJob = Pick<StringingJob, 'status' | 'archivedAt' | 'ownString'>;

const oneDecimal = (n: number | null) => (n === null ? null : Math.round(n * 10) / 10);

/** Pure: the summary the shelf reads, plus every job's stage, folded for the report. */
export function buildStringShelfReport(summary: StringStockSummary, jobs: readonly ReportJob[]): StringShelfReport {
  const byStatus = Object.fromEntries(STRINGING_FLOW.map((s) => [s, 0])) as Record<StringingStatus, number>;
  let archived = 0;
  let ownString = 0;
  for (const j of jobs) {
    if (j.status in byStatus) byStatus[j.status] += 1;
    if (j.archivedAt) archived += 1;
    if (j.ownString === true) ownString += 1;
  }
  return {
    jobs: { total: jobs.length, live: jobs.length - archived, archived, byStatus, ownString },
    lines: summary.lines.map((l) => ({
      label: l.label,
      purchases: l.purchases,
      usedSets: l.usedSets,
      remainingSets: l.remainingSets,
      overdrawnSets: l.overdrawnSets,
      setsPerWeek: oneDecimal(l.setsPerWeek),
      weeksLeft: oneDecimal(l.weeksLeft),
      reorder: l.reorder,
      costPerSetCents: l.costPerSetCents,
    })),
    unmatchedSets: summary.unmatched.reduce((n, u) => n + u.usedSets, 0),
    totals: {
      usedSets: summary.totals.usedSets,
      overdrawnSets: summary.totals.overdrawnSets,
      remainingValueCents: summary.totals.remainingValueCents,
      purchasedCostCents: summary.totals.purchasedCostCents,
    },
  };
}

/**
 * The club's shelf for the report, or `null` when the club does not string
 * (the deployment flag off, or the club's add-on switched off). A failed read
 * THROWS, like every other read in `clubMetrics()`: the report answers 503
 * rather than a shelf of zeros.
 */
export async function readStringShelfReport(groupId: string, now: Date): Promise<StringShelfReport | null> {
  if (!(await stringingServiceOnFor(groupId))) return null;
  const scope = groupScope(groupId);
  const [offered, purchases, catalog, jobs, uses] = await Promise.all([
    readOfferedStringsWithLinks(groupId),
    readStringPurchases(scope),
    readStringCatalog(),
    scope.query<StringingJob>('stringingJobs', { select: STOCK_JOB_SELECT }),
    readStringUses(scope),
  ]);
  if (!offered) throw new Error('offered strings unreadable');
  const summary = summarizeStringStock({
    offered: offered.strings, links: offered.links, aliases: offered.aliases, purchases,
    jobs: withDeletedUses(jobs.map(countedJob), uses), catalog, customColours: offered.customColours, now,
  });
  // Jobs still stored: a deleted job is gone from the bench, so it is not a stage.
  return buildStringShelfReport(summary, jobs);
}
