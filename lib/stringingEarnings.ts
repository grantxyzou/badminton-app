/**
 * What the bench earned (docs/plans/stringing-earnings.md). Pure: jobs and the
 * shelf's summary in, months out.
 *
 * A job counts in the month its string went in (`strungAtOf`), the same day
 * the usage rate counts it, so a month's work and the string it used fall in
 * the same month. Its money sits in exactly one of three piles, each read
 * through the one rule that already decides it everywhere else:
 *   collected      — `paidAt` is set;
 *   owed           — `isBillable` (finished, priced, unpaid, invoiced when it
 *                    bills on an invoice);
 *   not invoiced   — priced and unpaid and not billable yet.
 * Its string costs what the stock count says it took off the shelf, at the
 * price ON THE DAY IT WAS STRUNG (`jobParts`): never a second matcher and
 * never today's price, so a month that is over does not move when the next
 * reel is bought. A HYBRID is two parts (half a set of each string off a
 * reel, a whole packet otherwise), and its price is shared equally between
 * the two strings' rows, so each row shows what its string made.
 *
 * Nothing is zero in silence. A job with no price adds no work, and a job
 * with a string whose cost nobody can know (not on the shelf, or never
 * bought) adds no cost for it — and each is COUNTED (`unpricedJobs`,
 * `unknownCostJobs`), so the page can say the figure is short.
 *
 * A DELETED job that was PAID still counts (`deletedPaidJobs`): the money
 * came in, and the ledger keeps it, so the month it was strung in keeps it
 * too. A deleted job that was never paid owes nothing and is not here.
 */
import type { StringingJob } from './types';
import { STRUNG_STATUSES, strungAtOf, type StringStockSummary } from './stringStockMath';
import type { StringUse } from './stringStock';
import { awaitingInvoice, isBillable } from './stringingBilling';
import { lastMonths, monthOf } from './memberPayments';

/**
 * The window runs from the month of the club's first counted job to now, so
 * the page can step back to any of them (Month / Quarter / Year, canvas
 * option A, 2026-11-18). Never more than this many months: three years of
 * monthly rows is a few kilobytes, and the read stays bounded however long a
 * club has strung.
 */
export const EARNINGS_MAX_MONTHS = 36;

/** The fields the fold reads: the route projects exactly these. */
export type EarningsJob = Pick<StringingJob, 'id' | 'jobNo' | 'memberName' | 'status' | 'priceCents' | 'paidAt' | 'stringLabel' | 'createdAt'> &
  Partial<Pick<StringingJob, 'billOn' | 'cancelledAt' | 'ownString'>> & {
    invoice?: { sentAt?: string; lastSentAt?: string } | null;
    history?: unknown;
  };

export const EARNINGS_JOB_SELECT =
  'c.id, c.jobNo, c.memberName, c.status, c.priceCents, c.paidAt, c.stringLabel, c.createdAt, c.billOn, c.cancelledAt, c.ownString, c.invoice, c.history';

/**
 * Why it is still waiting: `invoiced` (sent, unpaid), `owed` (billed at Ready,
 * unpaid), `not_invoiced` (finished, its invoice not sent), `not_ready`
 * (strung, not finished, so nobody has been asked yet).
 */
export type WaitingState = 'invoiced' | 'owed' | 'not_invoiced' | 'not_ready';

export interface EarningsWaiting {
  jobId: string;
  jobNo: string;
  who: string;
  state: WaitingState;
  /** The moment the age counts from: the latest send for an invoice, Ready for
   *  a bill at Ready, otherwise when it was strung. */
  since: string | null;
  amountCents: number;
}

export interface EarningsStringMonth {
  key: string;
  /** Rackets; a hybrid counts as half a racket on each of its two strings. */
  jobs: number;
  /** Sets off the shelf (own-string jobs use none; a hybrid's side may be half a set). */
  sets: number;
  workCents: number;
  costCents: number;
}

export interface EarningsMonth {
  /** `YYYY-MM`, Vancouver. */
  month: string;
  jobs: number;
  workCents: number;
  collectedCents: number;
  owedCents: number;
  notInvoicedCents: number;
  stringCostCents: number;
  sets: number;
  /** Counted jobs with no price: they are work done that adds $0 here. */
  unpricedJobs: number;
  /** Club-string jobs whose set has no known cost, so it came off as $0. */
  unknownCostJobs: number;
  strings: EarningsStringMonth[];
  /** Oldest first. */
  waiting: EarningsWaiting[];
}

export interface EarningsString {
  /** `s:<shelf label>`, `own`, or `x:<label>` for a string the shelf does not list. */
  key: string;
  label: string;
  catalogId: string | null;
  own: boolean;
  /** Off the shelf: null for own string, for a string not on the shelf, or before any purchase. */
  costPerSetCents: number | null;
  remainingSets: number | null;
  /** All string ever bought for it, and all work ever done with it: the payback. */
  purchasedCostCents: number;
  allTimeWorkCents: number;
}

export interface EarningsSummary {
  months: EarningsMonth[];
  strings: EarningsString[];
}

const OWN = 'own';

function firstAt(history: unknown, status: string): string | undefined {
  if (!Array.isArray(history)) return undefined;
  for (const h of history) {
    if (h && typeof h === 'object' && (h as { status?: unknown }).status === status && typeof (h as { at?: unknown }).at === 'string') {
      return (h as { at: string }).at;
    }
  }
  return undefined;
}

const priced = (j: EarningsJob): number => (typeof j.priceCents === 'number' && j.priceCents > 0 ? j.priceCents : 0);
const isPaid = (j: EarningsJob): boolean => typeof j.paidAt === 'string' && j.paidAt.length > 0;

function waitingOf(j: EarningsJob, strungAt: string | undefined): EarningsWaiting | null {
  const amountCents = priced(j);
  if (amountCents === 0 || isPaid(j)) return null;
  let state: WaitingState;
  let since: string | undefined;
  if (isBillable(j)) {
    if (j.billOn === 'invoice') {
      state = 'invoiced';
      since = j.invoice?.lastSentAt ?? j.invoice?.sentAt;
    } else {
      state = 'owed';
      since = firstAt(j.history, 'ready') ?? strungAt;
    }
  } else if (awaitingInvoice(j)) {
    state = 'not_invoiced';
    since = strungAt;
  } else {
    state = 'not_ready';
    since = strungAt;
  }
  return { jobId: j.id, jobNo: j.jobNo, who: j.memberName, state, since: since ?? null, amountCents };
}

/** Months since year 0, so two `YYYY-MM` can be subtracted. */
const ordinal = (month: string): number => {
  const [y, m] = month.split('-').map(Number);
  return y * 12 + (m - 1);
};

/** Where a counted job falls: the month its string went in, else when it was made. */
const counted = (j: EarningsJob): boolean => STRUNG_STATUSES.has(j.status) && !(j.cancelledAt && !isPaid(j));
const monthOfJob = (j: EarningsJob): string | null => monthOf(strungAtOf(j) ?? j.createdAt);

/**
 * The deleted jobs that still count: those PAID when they left (Grant,
 * 2026-11-27: "Keep delete"). A deleted job's `stringUse` row carries its
 * price and when it was paid since then; a row with neither (an unpaid job,
 * or one deleted before the row carried money) is the shelf's alone. A job
 * still stored is never taken from its row.
 */
export function deletedPaidJobs(uses: readonly StringUse[], live: ReadonlySet<string>): EarningsJob[] {
  return uses.flatMap((u) => {
    if (live.has(u.jobId) || typeof u.paidAt !== 'string' || !u.paidAt) return [];
    if (typeof u.priceCents !== 'number' || u.priceCents <= 0) return [];
    return [{
      id: u.jobId, jobNo: '', memberName: '', status: 'picked_up' as const,
      priceCents: u.priceCents, paidAt: u.paidAt, stringLabel: u.stringLabel,
      createdAt: u.createdAt ?? u.strungAt ?? u.deletedAt,
      ...(u.ownString ? { ownString: true as const } : {}),
      history: u.strungAt ? [{ status: 'strung', at: u.strungAt }] : [],
    }];
  });
}

/** `total` shared over `n` rows in whole cents: the first rows take the odd ones. */
function shareOut(total: number, n: number): number[] {
  const base = Math.floor(total / n);
  return Array.from({ length: n }, (_, i) => base + (i < total - base * n ? 1 : 0));
}

export function summarizeEarnings(input: {
  jobs: readonly EarningsJob[];
  stock: Pick<StringStockSummary, 'lines' | 'jobParts'>;
  now: Date;
  /** A fixed window instead of "since the first job". */
  months?: number;
}): EarningsSummary {
  const current = monthOf(input.now.toISOString())!;
  let span = input.months;
  if (span === undefined) {
    let first = ordinal(current);
    for (const j of input.jobs) {
      if (!counted(j)) continue;
      const m = monthOfJob(j);
      if (m) first = Math.min(first, ordinal(m));
    }
    span = ordinal(current) - first + 1;
  }
  const window = lastMonths(Math.max(1, Math.min(EARNINGS_MAX_MONTHS, span)), input.now);
  const byMonth = new Map<string, EarningsMonth>(window.map((month) => [month, {
    month, jobs: 0, workCents: 0, collectedCents: 0, owedCents: 0, notInvoicedCents: 0,
    stringCostCents: 0, sets: 0, unpricedJobs: 0, unknownCostJobs: 0, strings: [], waiting: [],
  }]));
  const stringRows = new Map<string, Map<string, EarningsStringMonth>>(window.map((m) => [m, new Map()]));

  const jobParts = input.stock.jobParts ?? {};
  const strings = new Map<string, EarningsString>();
  for (const l of input.stock.lines) {
    strings.set(`s:${l.label}`, {
      key: `s:${l.label}`, label: l.label, catalogId: l.catalogId, own: false,
      costPerSetCents: l.costPerSetCents, remainingSets: l.purchases > 0 || l.lastCount ? l.remainingSets : null,
      purchasedCostCents: l.purchasedCostCents, allTimeWorkCents: 0,
    });
  }

  for (const j of input.jobs) {
    // A racket still on the bench is not work done, and a withdrawn job is
    // not either unless it was paid for all the same.
    if (!counted(j)) continue;
    const strungAt = strungAtOf(j);
    const month = monthOfJob(j);
    const own = j.ownString === true;
    // What it took off the shelf, as the stock count read it: one part, or a
    // hybrid's two. Own string takes nothing; a job the count never saw (no
    // string named) is one part nobody can cost.
    const label = (j.stringLabel ?? '').trim();
    const parts: Array<{ key: string; label: string; sets: number; costCents: number | null }> = own
      ? [{ key: OWN, label: '', sets: 0, costCents: 0 }]
      : (jobParts[j.id] ?? [{ line: null, label, sets: 1, costCents: null }]).map((p) => ({
        key: p.line ? `s:${p.line}` : `x:${p.label.toLowerCase() || '?'}`, label: p.label, sets: p.sets, costCents: p.costCents,
      }));
    for (const p of parts) {
      if (strings.has(p.key)) continue;
      strings.set(p.key, {
        key: p.key, label: p.label, catalogId: null, own,
        costPerSetCents: null, remainingSets: null, purchasedCostCents: 0, allTimeWorkCents: 0,
      });
    }
    const work = priced(j);
    // A hybrid's price is shared equally between its two strings.
    const shares = shareOut(work, parts.length);
    parts.forEach((p, k) => { strings.get(p.key)!.allTimeWorkCents += shares[k]; });

    const m = month ? byMonth.get(month) : undefined;
    if (!m) continue;
    m.jobs += 1;
    if (work === 0) m.unpricedJobs += 1;
    if (parts.some((p) => p.costCents === null)) m.unknownCostJobs += 1;
    m.workCents += work;
    if (isPaid(j)) m.collectedCents += work;
    else if (isBillable(j)) m.owedCents += work;
    else m.notInvoicedCents += work;
    const w = waitingOf(j, strungAt);
    if (w) m.waiting.push(w);
    const rows = stringRows.get(m.month)!;
    parts.forEach((p, k) => {
      const cost = p.costCents ?? 0;
      m.sets += p.sets;
      m.stringCostCents += cost;
      const row = rows.get(p.key) ?? { key: p.key, jobs: 0, sets: 0, workCents: 0, costCents: 0 };
      row.jobs += 1 / parts.length;
      row.sets += p.sets;
      row.workCents += shares[k];
      row.costCents += cost;
      rows.set(p.key, row);
    });
  }

  const months = window.map((month) => {
    const m = byMonth.get(month)!;
    m.strings = [...stringRows.get(month)!.values()];
    m.waiting.sort((a, b) => (a.since ?? '').localeCompare(b.since ?? ''));
    return m;
  });
  return { months, strings: [...strings.values()] };
}
