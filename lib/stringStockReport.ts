import { stringingServiceOnFor } from './stringingService';
import type { StringStockSummary } from './stringStock';
import { loadStringEarnings } from './stringingEarningsRead';
import type { EarningsMonth, EarningsSummary } from './stringingEarnings';
import { STRINGING_FLOW, type StringingStatus } from './stringing';
import type { StringingJob } from './types';

/**
 * The string shelf as the club report reads it (docs/plans/string-usage-rate.md):
 * the same `summarizeStringStock` the bench reads, so the report and the shelf
 * cannot disagree, folded to numbers. Labels and counts only — never a name,
 * a contact or a member's money. `clubMetrics()` attaches it as
 * `stringShelf` (beside `stringEarnings`, below), which both the admin
 * Metrics read and the key-protected report return.
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
 * What the bench earned, as the club report reads it (Grant, 2026-11-27: "YEs
 * to total in report"; docs/plans/stringing-earnings.md): the SAME fold the
 * Earnings page shows (`loadStringEarnings`), month by month, so a figure on
 * the page can be checked against the report. Totals only: no job, no player,
 * no walk-up, and a string the shelf does not list is counted under
 * `offShelf` rather than by the name somebody typed for it.
 */
export interface StringEarningsReportRow {
  jobs: number;
  workCents: number;
  collectedCents: number;
  owedCents: number;
  notInvoicedCents: number;
  stringCostCents: number;
  /** Work done minus the string it used. */
  afterStringCostCents: number;
  /** Sets off the shelf; a hybrid's side off a reel is half a set. */
  sets: number;
  /** Counted jobs with no price: work done that adds $0. */
  unpricedJobs: number;
  /** Jobs with a string nobody can cost, so the string cost is short. */
  unknownCostJobs: number;
  /** Payments still waiting (owed or not invoiced). */
  waitingJobs: number;
}

export interface StringEarningsReportString {
  /** A shelf string's label, `ownString`, or `offShelf`. */
  label: string;
  /** Rackets; a hybrid is half a racket on each of its two strings. */
  jobs: number;
  sets: number;
  workCents: number;
  costCents: number;
}

export interface StringEarningsReport {
  /** Oldest first, ending at the current month (Vancouver), at most 36. */
  months: Array<StringEarningsReportRow & { month: string; strings: StringEarningsReportString[] }>;
  /** Every month above, added up. */
  totals: StringEarningsReportRow;
}

const rowOf = (m: EarningsMonth): StringEarningsReportRow => ({
  jobs: m.jobs,
  workCents: m.workCents,
  collectedCents: m.collectedCents,
  owedCents: m.owedCents,
  notInvoicedCents: m.notInvoicedCents,
  stringCostCents: m.stringCostCents,
  afterStringCostCents: m.workCents - m.stringCostCents,
  sets: m.sets,
  unpricedJobs: m.unpricedJobs,
  unknownCostJobs: m.unknownCostJobs,
  waitingJobs: m.waiting.length,
});

/** Pure: the page's months, stripped to numbers and shelf labels. */
export function buildStringEarningsReport(earnings: EarningsSummary): StringEarningsReport {
  const labelOf = new Map(earnings.strings.map((s) => [s.key, s.own ? 'ownString' : s.key.startsWith('s:') ? s.label : 'offShelf']));
  const months = earnings.months.map((m) => {
    const strings = new Map<string, StringEarningsReportString>();
    for (const r of m.strings) {
      const label = labelOf.get(r.key) ?? 'offShelf';
      const row = strings.get(label) ?? { label, jobs: 0, sets: 0, workCents: 0, costCents: 0 };
      row.jobs += r.jobs;
      row.sets += r.sets;
      row.workCents += r.workCents;
      row.costCents += r.costCents;
      strings.set(label, row);
    }
    return { month: m.month, ...rowOf(m), strings: [...strings.values()] };
  });
  const totals = months.reduce<StringEarningsReportRow>((t, m) => ({
    jobs: t.jobs + m.jobs,
    workCents: t.workCents + m.workCents,
    collectedCents: t.collectedCents + m.collectedCents,
    owedCents: t.owedCents + m.owedCents,
    notInvoicedCents: t.notInvoicedCents + m.notInvoicedCents,
    stringCostCents: t.stringCostCents + m.stringCostCents,
    afterStringCostCents: t.afterStringCostCents + m.afterStringCostCents,
    sets: t.sets + m.sets,
    unpricedJobs: t.unpricedJobs + m.unpricedJobs,
    unknownCostJobs: t.unknownCostJobs + m.unknownCostJobs,
    waitingJobs: t.waitingJobs + m.waitingJobs,
  }), {
    jobs: 0, workCents: 0, collectedCents: 0, owedCents: 0, notInvoicedCents: 0, stringCostCents: 0,
    afterStringCostCents: 0, sets: 0, unpricedJobs: 0, unknownCostJobs: 0, waitingJobs: 0,
  });
  return { months, totals };
}

/**
 * The club's shelf and earnings for the report, from ONE read, or both `null`
 * when the club does not string (the deployment flag off, or the club's
 * add-on switched off). A failed read THROWS, like every other read in
 * `clubMetrics()`: the report answers 503 rather than a shelf of zeros.
 */
export async function readStringReports(
  groupId: string,
  now: Date,
): Promise<{ stringShelf: StringShelfReport | null; stringEarnings: StringEarningsReport | null }> {
  if (!(await stringingServiceOnFor(groupId))) return { stringShelf: null, stringEarnings: null };
  const { earnings, stock } = await loadStringEarnings(groupId, { now });
  return {
    // Jobs still stored: a deleted job is gone from the bench, so it is not a stage.
    stringShelf: buildStringShelfReport(stock.summary, stock.jobs),
    stringEarnings: buildStringEarningsReport(earnings),
  };
}
