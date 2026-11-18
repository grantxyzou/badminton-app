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
 * Its string costs the shelf line's `costPerSetCents`, through the line the
 * stock count itself matched it to (`jobLines`), never a second matcher.
 */
import type { StringingJob } from './types';
import { STRUNG_STATUSES, strungAtOf, type StringStockSummary } from './stringStockMath';
import { awaitingInvoice, isBillable } from './stringingBilling';
import { lastMonths, monthOf } from './memberPayments';

export const EARNINGS_MONTHS = 4;

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
  jobs: number;
  /** Sets off the shelf (own-string jobs use none). */
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

export function summarizeEarnings(input: {
  jobs: readonly EarningsJob[];
  stock: Pick<StringStockSummary, 'lines' | 'jobLines'>;
  now: Date;
  months?: number;
}): EarningsSummary {
  const window = lastMonths(input.months ?? EARNINGS_MONTHS, input.now);
  const byMonth = new Map<string, EarningsMonth>(window.map((month) => [month, {
    month, jobs: 0, workCents: 0, collectedCents: 0, owedCents: 0, notInvoicedCents: 0,
    stringCostCents: 0, sets: 0, strings: [], waiting: [],
  }]));
  const stringRows = new Map<string, Map<string, EarningsStringMonth>>(window.map((m) => [m, new Map()]));

  const lineByLabel = new Map(input.stock.lines.map((l) => [l.label, l]));
  const jobLines = input.stock.jobLines ?? {};
  const strings = new Map<string, EarningsString>();
  for (const l of input.stock.lines) {
    strings.set(`s:${l.label}`, {
      key: `s:${l.label}`, label: l.label, catalogId: l.catalogId, own: false,
      costPerSetCents: l.costPerSetCents, remainingSets: l.purchases > 0 || l.lastCount ? l.remainingSets : null,
      purchasedCostCents: l.purchasedCostCents, allTimeWorkCents: 0,
    });
  }

  for (const j of input.jobs) {
    if (!STRUNG_STATUSES.has(j.status)) continue;
    // A withdrawn job is not work done, unless it was paid for all the same.
    if (j.cancelledAt && !isPaid(j)) continue;
    const strungAt = strungAtOf(j);
    const month = monthOf(strungAt ?? j.createdAt);
    const own = j.ownString === true;
    const lineLabel = own ? undefined : jobLines[j.id];
    const line = lineLabel ? lineByLabel.get(lineLabel) : undefined;
    let key: string;
    if (own) key = OWN;
    else if (line) key = `s:${line.label}`;
    else key = `x:${(j.stringLabel ?? '').trim().toLowerCase() || '?'}`;
    if (!strings.has(key)) {
      strings.set(key, {
        key, label: own ? '' : (j.stringLabel ?? '').trim(), catalogId: null, own,
        costPerSetCents: null, remainingSets: null, purchasedCostCents: 0, allTimeWorkCents: 0,
      });
    }
    const work = priced(j);
    strings.get(key)!.allTimeWorkCents += work;

    const m = month ? byMonth.get(month) : undefined;
    if (!m) continue;
    const sets = own ? 0 : 1;
    const cost = line && line.costPerSetCents !== null ? line.costPerSetCents : 0;
    m.jobs += 1;
    m.workCents += work;
    m.sets += sets;
    m.stringCostCents += cost;
    if (isPaid(j)) m.collectedCents += work;
    else if (isBillable(j)) m.owedCents += work;
    else m.notInvoicedCents += work;
    const w = waitingOf(j, strungAt);
    if (w) m.waiting.push(w);
    const rows = stringRows.get(m.month)!;
    const row = rows.get(key) ?? { key, jobs: 0, sets: 0, workCents: 0, costCents: 0 };
    row.jobs += 1;
    row.sets += sets;
    row.workCents += work;
    row.costCents += cost;
    rows.set(key, row);
  }

  const months = window.map((month) => {
    const m = byMonth.get(month)!;
    m.strings = [...stringRows.get(month)!.values()];
    m.waiting.sort((a, b) => (a.since ?? '').localeCompare(b.since ?? ''));
    return m;
  });
  return { months, strings: [...strings.values()] };
}
