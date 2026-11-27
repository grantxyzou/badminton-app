// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { useState } from 'react';
import StringingEarningsPage, { EarningsLine, NEWEST, axisTop, type EarningsData, type EarningsPick } from '../../components/stringing/StringingEarnings';
import enMessages from '../../messages/en.json';
import type { EarningsMonth } from '../../lib/stringingEarnings';

/**
 * The bench's earnings line and page (docs/plans/stringing-earnings.md).
 * What Grant reads: the month's three piles, a failed read that never reads
 * as $0, a month picked from the columns, and a price simulated, never saved.
 */
afterEach(cleanup);

const month = (m: string, o: Partial<EarningsMonth> = {}): EarningsMonth => ({
  month: m, jobs: 0, workCents: 0, collectedCents: 0, owedCents: 0, notInvoicedCents: 0,
  stringCostCents: 0, sets: 0, unpricedJobs: 0, unknownCostJobs: 0, strings: [], waiting: [], ...o,
});

const data: EarningsData = {
  now: '2026-11-18T20:00:00Z',
  months: [
    month('2026-08'),
    month('2026-09'),
    month('2026-10', { jobs: 10, workCents: 29200, collectedCents: 27200, owedCents: 2000, stringCostCents: 8400, sets: 9 }),
    month('2026-11', {
      jobs: 4, workCents: 12000, collectedCents: 6000, owedCents: 3000, notInvoicedCents: 3000, stringCostCents: 3000, sets: 3,
      strings: [{ key: 's:BG80', jobs: 3, sets: 3, workCents: 9000, costCents: 3000 }, { key: 'own', jobs: 1, sets: 0, workCents: 3000, costCents: 0 }],
      waiting: [
        { jobId: 'a', jobNo: 'J-1', who: 'Akane', state: 'invoiced', since: '2026-11-14T20:00:00Z', amountCents: 3000 },
        { jobId: 'b', jobNo: 'J-2', who: 'Lin', state: 'not_invoiced', since: '2026-11-15T20:00:00Z', amountCents: 3000 },
      ],
    }),
  ],
  strings: [
    { key: 's:BG80', label: 'BG80', catalogId: null, own: false, costPerSetCents: 1000, remainingSets: 17, purchasedCostCents: 20000, allTimeWorkCents: 9000 },
    { key: 's:BG65', label: 'BG65', catalogId: null, own: false, costPerSetCents: 700, remainingSets: 20, purchasedCostCents: 14000, allTimeWorkCents: 0 },
    { key: 'own', label: '', own: true, catalogId: null, costPerSetCents: null, remainingSets: null, purchasedCostCents: 0, allTimeWorkCents: 3000 },
  ],
};

const wrap = (ui: React.ReactNode) => render(
  <NextIntlClientProvider locale="en" messages={enMessages} timeZone="UTC">{ui}</NextIntlClientProvider>,
);

describe('EarningsLine', () => {
  it("names this month's three piles and opens the page", () => {
    const onOpen = vi.fn();
    wrap(<EarningsLine data={data} error={false} onOpen={onOpen} onRetry={() => {}} />);
    const line = screen.getByTestId('earnings-line');
    expect(line.getAttribute('aria-label')).toBe('Earnings for November 2026 so far: $60 collected, $30 owed, $30 not invoiced. Open earnings');
    fireEvent.click(line);
    expect(onOpen).toHaveBeenCalled();
  });

  it('says a failed read failed, with a retry, never $0', () => {
    const onRetry = vi.fn();
    wrap(<EarningsLine data={null} error onOpen={() => {}} onRetry={onRetry} />);
    expect(screen.getByText("Couldn't load earnings")).toBeTruthy();
    expect(screen.queryByText('$0')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalled();
  });
});

describe('StringingEarningsPage', () => {
  it('shows work done against last month, what is left after string cost, and who is waiting', () => {
    wrap(<StringingEarningsPage data={data} error={false} onRetry={() => {}} />);
    expect(screen.getAllByText('$120').length).toBeGreaterThan(0);
    expect(screen.getByText('$172 vs Oct')).toBeTruthy();
    expect(screen.getByText('75% margin')).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Collected $60, Owed $30, Not invoiced $30, of $120' })).toBeTruthy();
    const waiting = screen.getByRole('region', { name: 'Waiting on payment' });
    expect(within(waiting).getByText('Invoiced · 4 days')).toBeTruthy();
    expect(within(waiting).getByText('Not invoiced · strung 3 days ago')).toBeTruthy();
    expect(screen.getByText('$60 of it is still to collect.')).toBeTruthy();
  });

  it('a tapped column picks its month', () => {
    wrap(<StringingEarningsPage data={data} error={false} onRetry={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /^October 2026: \$292 of work/ }));
    expect(screen.getByRole('button', { name: /^October 2026: / }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getAllByText('$208').length).toBeGreaterThan(0); // 292 − 84 after string cost
    expect(screen.queryByRole('region', { name: 'Waiting on payment' })).toBeNull();
  });

  it('ranks the strings by what they made, keeps an unstrung shelf string, and simulates a price without saving it', () => {
    wrap(<StringingEarningsPage data={data} error={false} onRetry={() => {}} />);
    const rows = screen.getAllByTestId('earn-string');
    expect(rows.map((r) => within(r).getAllByText(/BG80|BG65|Own string/)[0].textContent)).toEqual(['BG80', 'Own string', 'BG65']);
    expect(within(rows[2]).getByText('Not strung this month')).toBeTruthy();
    fireEvent.click(within(rows[0]).getByRole('button', { expanded: false }));
    expect(within(rows[0]).getByText('$10 a set')).toBeTruthy();
    expect(within(rows[0]).getByText('4 more jobs')).toBeTruthy(); // $110 to go at $30
    expect(within(rows[0]).getByText('17 sets')).toBeTruthy();
    fireEvent.click(within(rows[0]).getByRole('button', { name: 'One dollar more' }));
    expect(within(rows[0]).getByText('$63')).toBeTruthy(); // 3 jobs at $31 less $30 of string
    expect(within(rows[0]).getByText('simulated')).toBeTruthy();
  });

  it('a hybrid shows as half a set on each of its two strings, each with half the price', () => {
    const hybrid: EarningsData = {
      ...data,
      months: [month('2026-11', {
        jobs: 1, workCents: 3000, collectedCents: 3000, stringCostCents: 850, sets: 1,
        strings: [
          { key: 's:BG80', jobs: 0.5, sets: 0.5, workCents: 1500, costCents: 500 },
          { key: 's:BG65', jobs: 0.5, sets: 0.5, workCents: 1500, costCents: 350 },
        ],
      })],
    };
    wrap(<StringingEarningsPage data={hybrid} error={false} onRetry={() => {}} />);
    const rows = screen.getAllByTestId('earn-string');
    expect(rows.map((r) => within(r).getAllByText(/BG80|BG65/)[0].textContent)).toEqual(['BG65', 'BG80']);
    expect(within(rows[0]).getByText('0.5 sets used')).toBeTruthy();
    expect(within(rows[0]).getByText('$11.50')).toBeTruthy(); // $15 of the job less $3.50 of string
    expect(within(rows[1]).getByText('$10')).toBeTruthy();
    // The what-if still steps the JOB's price: $1 more on a $30 hybrid is 50c for this string.
    fireEvent.click(within(rows[1]).getByRole('button', { expanded: false }));
    fireEvent.click(within(rows[1]).getByRole('button', { name: 'One dollar more' }));
    expect(within(rows[1]).getByText('$31')).toBeTruthy();
    expect(within(rows[1]).getByText('$10.50')).toBeTruthy();
  });
});

describe('nothing is zero in silence', () => {
  it('says how many jobs have no price and how many have no known string cost', () => {
    const short: EarningsData = { ...data, months: [...data.months.slice(0, 3), { ...data.months[3], unpricedJobs: 1, unknownCostJobs: 2 }] };
    wrap(<StringingEarningsPage data={short} error={false} onRetry={() => {}} />);
    expect(screen.getByTestId('earn-unpriced').textContent).toBe('1 job not priced');
    expect(screen.getByTestId('earn-unknown-cost').textContent).toBe('2 jobs: cost unknown');
  });

  it('says nothing when every job is priced and costed', () => {
    wrap(<StringingEarningsPage data={data} error={false} onRetry={() => {}} />);
    expect(screen.queryByTestId('earn-unpriced')).toBeNull();
    expect(screen.queryByTestId('earn-unknown-cost')).toBeNull();
  });
});

describe('the period: Month, Quarter or Year, then ‹ ›', () => {
  it('opens on this month so far, steps back, and stops at the ends', () => {
    wrap(<StringingEarningsPage data={data} error={false} onRetry={() => {}} />);
    expect(screen.getByTestId('earn-period').textContent).toBe('November 2026 so far');
    expect((screen.getByRole('button', { name: 'Later' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Earlier' }));
    expect(screen.getByTestId('earn-period').textContent).toBe('October 2026');
    expect(screen.getAllByText('$292').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Earlier' }));
    fireEvent.click(screen.getByRole('button', { name: 'Earlier' }));
    expect(screen.getByTestId('earn-period').textContent).toBe('August 2026');
    expect((screen.getByRole('button', { name: 'Earlier' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('a quarter adds its months up and compares with the quarter before', () => {
    const wide: EarningsData = {
      ...data,
      months: [month('2026-06', { jobs: 2, workCents: 5000, collectedCents: 5000, stringCostCents: 1000, sets: 2 }), ...data.months.slice(0)],
    };
    wrap(<StringingEarningsPage data={wide} error={false} onRetry={() => {}} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Quarter' }));
    expect(screen.getByTestId('earn-period').textContent).toBe('Q4 2026 so far');
    // Oct $292 + Nov $120.
    expect(screen.getAllByText('$412').length).toBeGreaterThan(0);
    // Q4 so far is its first two months, so it is set against Q3's first two
    // that exist: August only (July is before the window, June is Q2).
    expect(screen.getByText('$412 vs Aug')).toBeTruthy();
    expect(screen.getByRole('region', { name: 'By quarter · tap one' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^Q2 2026: \$50 of work/ }));
    expect(screen.getByTestId('earn-period').textContent).toBe('Q2 2026');
    fireEvent.click(screen.getByRole('tab', { name: 'Year' }));
    expect(screen.getByTestId('earn-period').textContent).toBe('2026 so far');
    expect(screen.getAllByText('$462').length).toBeGreaterThan(0);
  });
});

describe('the bench line follows the chosen period', () => {
  /** The bench's wiring: one pick, held above both. */
  function Bench() {
    const [pick, setPick] = useState<EarningsPick>(NEWEST);
    return (
      <>
        <EarningsLine data={data} error={false} pick={pick} onOpen={() => {}} onRetry={() => {}} />
        <StringingEarningsPage data={data} error={false} onRetry={() => {}} pick={pick} onPick={setPick} />
      </>
    );
  }
  const lineLabel = () => screen.getByTestId('earnings-line').getAttribute('aria-label');

  it('names the month stepped to, then the quarter picked', () => {
    wrap(<Bench />);
    expect(lineLabel()).toMatch(/^Earnings for November 2026 so far: \$60 collected/);
    fireEvent.click(screen.getByRole('button', { name: 'Earlier' }));
    expect(lineLabel()).toBe('Earnings for October 2026: $272 collected, $20 owed, $0 not invoiced. Open earnings');
    fireEvent.click(screen.getByRole('tab', { name: 'Quarter' }));
    expect(lineLabel()).toMatch(/^Earnings for Q4 2026 so far: \$332 collected, \$50 owed, \$30 not invoiced/);
  });

  it('says nothing was strung in a past period with no jobs, not "yet"', () => {
    wrap(<EarningsLine data={data} error={false} pick={{ grain: 'month', key: '2026-08' }} onOpen={() => {}} onRetry={() => {}} />);
    expect(screen.getByText('Nothing strung')).toBeTruthy();
    expect(lineLabel()).toMatch(/^Earnings for August 2026:/);
  });

  it('a key a refetch no longer has falls back to now', () => {
    wrap(<EarningsLine data={data} error={false} pick={{ grain: 'month', key: '2019-01' }} onOpen={() => {}} onRetry={() => {}} />);
    expect(lineLabel()).toMatch(/^Earnings for November 2026 so far/);
  });
});

describe('axisTop', () => {
  it('rounds up to three ticks of a round step', () => {
    expect(axisTop(29200)).toBe(30000);
    expect(axisTop(30800)).toBe(36000); // not $600: the tallest column fills most of the plot
    expect(axisTop(12000)).toBe(12000);
    expect(axisTop(0)).toBe(3000);
  });
});
