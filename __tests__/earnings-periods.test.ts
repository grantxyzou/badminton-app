import { describe, it, expect } from 'vitest';
import { comparable, foldMonths, periodsOf, windowAround } from '@/lib/earningsPeriods';
import type { EarningsMonth } from '@/lib/stringingEarnings';

/**
 * The Earnings page's periods (docs/plans/stringing-earnings.md, canvas
 * option A): months folded into quarters and years, every figure the sum of
 * its months, and the chart's window kept full.
 */

const m = (month: string, workCents: number, o: Partial<EarningsMonth> = {}): EarningsMonth => ({
  month, jobs: 1, workCents, collectedCents: workCents, owedCents: 0, notInvoicedCents: 0,
  stringCostCents: 500, sets: 1, unpricedJobs: 0, unknownCostJobs: 0, strings: [{ key: 's:BG80', jobs: 1, sets: 1, workCents, costCents: 500 }], waiting: [], ...o,
});

const months = [m('2025-11', 1000), m('2025-12', 2000), m('2026-01', 3000), m('2026-02', 4000)];

describe('periodsOf', () => {
  it('keeps months as they are, the last one current', () => {
    const p = periodsOf(months, 'month');
    expect(p.map((x) => [x.key, x.part, x.current])).toEqual([
      ['2025-11', 11, false], ['2025-12', 12, false], ['2026-01', 1, false], ['2026-02', 2, true],
    ]);
  });

  it('folds quarters and years across the turn of a year', () => {
    expect(periodsOf(months, 'quarter').map((x) => [x.key, x.total.workCents, x.current])).toEqual([
      ['2025-Q4', 3000, false], ['2026-Q1', 7000, true],
    ]);
    expect(periodsOf(months, 'year').map((x) => [x.key, x.total.workCents, x.total.jobs])).toEqual([
      ['2025', 3000, 2], ['2026', 7000, 2],
    ]);
  });
});

describe('foldMonths', () => {
  it('adds every figure, merges strings by key and lists who waits oldest first', () => {
    const a = m('2026-01', 3000, {
      owedCents: 1000, collectedCents: 2000,
      waiting: [{ jobId: 'b', jobNo: 'J-2', who: 'Lin', state: 'owed', since: '2026-01-20T00:00:00Z', amountCents: 1000 }],
    });
    const b = m('2026-02', 4000, {
      strings: [{ key: 's:BG80', jobs: 1, sets: 1, workCents: 2000, costCents: 500 }, { key: 'own', jobs: 1, sets: 0, workCents: 2000, costCents: 0 }],
      waiting: [{ jobId: 'a', jobNo: 'J-1', who: 'Akane', state: 'invoiced', since: '2026-01-05T00:00:00Z', amountCents: 3000 }],
    });
    const f = foldMonths('2026-Q1', [a, b]);
    expect(f).toMatchObject({ month: '2026-Q1', jobs: 2, workCents: 7000, collectedCents: 6000, owedCents: 1000, stringCostCents: 1000, sets: 2 });
    expect(f.strings).toEqual([
      { key: 's:BG80', jobs: 2, sets: 2, workCents: 5000, costCents: 1000 },
      { key: 'own', jobs: 1, sets: 0, workCents: 2000, costCents: 0 },
    ]);
    expect(f.waiting.map((w) => w.jobId)).toEqual(['a', 'b']);
  });
});

describe('windowAround', () => {
  it('ends at the chosen period when it can, and stays full', () => {
    expect(windowAround(21, 20, 6)).toEqual({ from: 15, to: 21 });
    expect(windowAround(21, 10, 6)).toEqual({ from: 5, to: 11 });
    expect(windowAround(21, 2, 6)).toEqual({ from: 0, to: 6 });
    expect(windowAround(2, 1, 6)).toEqual({ from: 0, to: 2 });
  });
});

describe('comparable', () => {
  const year = [
    m('2025-01', 1000), m('2025-02', 1000), m('2025-03', 1000), m('2025-04', 1000),
    m('2026-01', 2000), m('2026-02', 2000),
  ];
  it('sets a period still filling against the same months of the one before', () => {
    const q = periodsOf([...year, m('2026-03', 9000), m('2026-04', 500)], 'quarter');
    // Q2 2026 so far is April alone, so it is set against Q1 2026's first month.
    const c = comparable(q[q.length - 1], q[q.length - 2]);
    expect(c.months.map((x) => x.month)).toEqual(['2026-01']);
    expect(c.total.workCents).toBe(2000);
    expect(c.partial).toBe(true);
    const y = periodsOf(year, 'year');
    const cy = comparable(y[1], y[0]);
    expect(cy.months.map((x) => x.month)).toEqual(['2025-01', '2025-02']);
    expect(cy.total.workCents).toBe(2000);
  });

  it('a finished period, or a month, is set against the whole one before', () => {
    const y = periodsOf(year, 'quarter');
    expect(comparable(y[0], y[0]).partial).toBe(false);
    const ms = periodsOf(year, 'month');
    expect(comparable(ms[ms.length - 1], ms[ms.length - 2]).total.workCents).toBe(2000);
  });
});
