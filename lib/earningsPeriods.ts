/**
 * The Earnings page's periods (docs/plans/stringing-earnings.md, canvas
 * option A, Grant 2026-11-18: "go with A"): the server's months folded into
 * months, quarters or years, oldest first. Pure, so the page and its tests
 * read one fold.
 *
 * A period's figures are the SUM of its months: work, the three piles, string
 * cost and sets add; strings merge by key; the waiting list is every month's,
 * oldest first. The newest period holds the current month and reads "so far".
 */
import type { EarningsMonth, EarningsStringMonth } from './stringingEarnings';

export type Grain = 'month' | 'quarter' | 'year';

export interface EarningsPeriod {
  /** `2026-11`, `2026-Q4` or `2026`. */
  key: string;
  grain: Grain;
  year: number;
  /** 1–12 for a month, 1–4 for a quarter, 0 for a year. */
  part: number;
  /** Holds the current month, so it is still filling. */
  current: boolean;
  /** The months it adds up, folded into one. */
  total: EarningsMonth;
  /** Those months, oldest first. */
  months: EarningsMonth[];
}

function keyOf(month: string, grain: Grain): { key: string; year: number; part: number } {
  const [y, m] = month.split('-').map(Number);
  if (grain === 'month') return { key: month, year: y, part: m };
  if (grain === 'quarter') {
    const q = Math.floor((m - 1) / 3) + 1;
    return { key: `${y}-Q${q}`, year: y, part: q };
  }
  return { key: String(y), year: y, part: 0 };
}

/** Several months as one: sums, strings merged by key, waiting oldest first. */
export function foldMonths(key: string, months: readonly EarningsMonth[]): EarningsMonth {
  const strings = new Map<string, EarningsStringMonth>();
  const out: EarningsMonth = {
    month: key, jobs: 0, workCents: 0, collectedCents: 0, owedCents: 0, notInvoicedCents: 0,
    stringCostCents: 0, sets: 0, unpricedJobs: 0, unknownCostJobs: 0, strings: [], waiting: [],
  };
  for (const m of months) {
    out.jobs += m.jobs;
    out.workCents += m.workCents;
    out.collectedCents += m.collectedCents;
    out.owedCents += m.owedCents;
    out.notInvoicedCents += m.notInvoicedCents;
    out.stringCostCents += m.stringCostCents;
    out.sets += m.sets;
    out.unpricedJobs += m.unpricedJobs ?? 0;
    out.unknownCostJobs += m.unknownCostJobs ?? 0;
    for (const s of m.strings) {
      const row = strings.get(s.key) ?? { key: s.key, jobs: 0, sets: 0, workCents: 0, costCents: 0 };
      row.jobs += s.jobs;
      row.sets += s.sets;
      row.workCents += s.workCents;
      row.costCents += s.costCents;
      strings.set(s.key, row);
    }
    out.waiting.push(...m.waiting);
  }
  out.strings = [...strings.values()];
  out.waiting.sort((a, b) => (a.since ?? '').localeCompare(b.since ?? ''));
  return out;
}

/** The months as periods of one grain, oldest first. `months` is oldest first and ends at now. */
export function periodsOf(months: readonly EarningsMonth[], grain: Grain): EarningsPeriod[] {
  const groups = new Map<string, { year: number; part: number; months: EarningsMonth[] }>();
  for (const m of months) {
    const { key, year, part } = keyOf(m.month, grain);
    const g = groups.get(key) ?? { year, part, months: [] };
    g.months.push(m);
    groups.set(key, g);
  }
  const last = months.length > 0 ? keyOf(months[months.length - 1].month, grain).key : null;
  return [...groups.entries()].map(([key, g]) => ({
    key, grain, year: g.year, part: g.part, current: key === last, total: foldMonths(key, g.months), months: g.months,
  }));
}

/** A month's place inside its period: 0–2 in a quarter, 0–11 in a year. */
const placeIn = (month: string, grain: Grain): number => {
  const m = Number(month.slice(5, 7)) - 1;
  return grain === 'quarter' ? m % 3 : grain === 'year' ? m : 0;
};

/**
 * What to compare a period with: the period before, whole — or, while this
 * one is still filling, only the SAME months of the one before (Q4 so far,
 * October and November, against July and August; this year so far against
 * the same months last year). A quarter two months in, against a whole one,
 * reads as a drop that is only the month still to come. A month so far is
 * compared with the whole month before: the server counts by month.
 */
export function comparable(cur: EarningsPeriod, prev: EarningsPeriod): { total: EarningsMonth; months: EarningsMonth[]; partial: boolean } {
  if (!cur.current || cur.grain === 'month') return { total: prev.total, months: prev.months, partial: false };
  const places = new Set(cur.months.map((m) => placeIn(m.month, cur.grain)));
  const months = prev.months.filter((m) => places.has(placeIn(m.month, cur.grain)));
  return { total: foldMonths(prev.key, months), months, partial: months.length < prev.months.length };
}

/** At most `n` periods ending at index `i`, kept full at the start: the chart's columns. */
export function windowAround(count: number, i: number, n: number): { from: number; to: number } {
  const from = Math.max(0, Math.min(i - (n - 1), count - n));
  return { from, to: Math.min(count, from + n) };
}
