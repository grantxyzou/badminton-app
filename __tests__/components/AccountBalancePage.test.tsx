// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import enMessages from '@/messages/en.json';
import AccountBalancePage from '@/components/profile/AccountBalancePage';
import PaymentsChart, { initialMonth, type PaymentMonth } from '@/components/profile/PaymentsChart';
import { creditWouldPay, type BalanceData, type UseBalance } from '@/components/profile/useBalance';
import type { UseCredit } from '@/components/profile/useCredit';
import { BALANCE_EVENT } from '@/lib/balanceRefresh';
import { TOP_TOAST_EVENT, type TopToastRequest } from '@/lib/topToast';

/**
 * Profile → Account balance (spec §4): the detailed view of Home's card, and
 * WHAT YOU'VE PAID under it.
 */

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const MONTHS: PaymentMonth[] = [
  { month: '2026-06', sessions: 0, stringing: 0, other: 0, nights: 0, guests: [] },
  { month: '2026-07', sessions: 0, stringing: 0, other: 0, nights: 0, guests: [] },
  { month: '2026-08', sessions: 2000, stringing: 0, other: 0, nights: 2, guests: [] },
  { month: '2026-09', sessions: 3000, stringing: 2800, other: 1000, nights: 3, guests: [{ name: 'Jenny', date: '2026-09-18T19:00:00-07:00' }] },
  { month: '2026-10', sessions: 4000, stringing: 0, other: 0, nights: 4, guests: [] },
  { month: '2026-11', sessions: 0, stringing: 0, other: 0, nights: 0, guests: [] },
];

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn(async (url: string) => {
    if (String(url).includes('/api/members/me/payments')) return new Response(JSON.stringify({ months: MONTHS }), { status: 200 });
    if (String(url).includes('/api/credit/spend')) return new Response('{}', { status: 200 });
    return new Response('{}', { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
});

const BALANCE: BalanceData = {
  totalOwed: 52,
  sessions: [
    { sessionId: 's-nov', playerId: 'p1', date: '2026-11-02T19:00:00-08:00', owedAmount: 10, settled: false },
    { sessionId: 's-sep', playerId: 'p2', date: '2026-09-21T19:00:00-07:00', owedAmount: 10, settled: true, settledAt: '2026-09-22T19:00:00Z' },
  ],
  stringing: [{ jobId: 'j1', jobNo: 'J-0902', racketLabel: 'Yonex Astrox 88D Pro', amount: 32, at: '2026-11-07T20:00:00Z' }],
  payTo: { name: 'BPM Core', email: 'pay@example.com' },
};

const balanceState = (over: Partial<UseBalance> = {}): UseBalance => ({ data: BALANCE, loadError: false, forbidden: false, reload: vi.fn(), ...over });
const creditState = (cents: number | null): UseCredit => ({ balanceCents: cents, entries: [], loadError: false, reload: vi.fn() });

async function renderPage(balance = balanceState(), credit: UseCredit | null = creditState(4500)) {
  const onBack = vi.fn();
  await act(async () => {
    render(
      <NextIntlClientProvider locale="en" messages={enMessages} timeZone="UTC">
        <AccountBalancePage balance={balance} credit={credit} onBack={onBack} />
      </NextIntlClientProvider>,
    );
  });
  return { onBack };
}

describe('creditWouldPay', () => {
  it('walks the frozen lines oldest first, each in full or not at all, as the server does', () => {
    // Settled $10 (Sep) + racket $32 = $42 of $45; the unsettled Nov line never.
    expect(creditWouldPay(BALANCE, 4500)).toBe(4200);
    // $35: the Sep line ($10) first, then the $32 racket no longer fits.
    expect(creditWouldPay(BALANCE, 3500)).toBe(1000);
    expect(creditWouldPay(BALANCE, 500)).toBe(0);
  });
});

describe('initialMonth', () => {
  it('opens on the latest month with a payment', () => {
    expect(initialMonth(MONTHS)).toBe('2026-10');
    expect(initialMonth(MONTHS.map((m) => ({ ...m, sessions: 0, stringing: 0, other: 0 })))).toBe('2026-11');
  });
});

describe('AccountBalancePage', () => {
  it('shows what is owed, line by line, with the credit beside it', async () => {
    const { onBack } = await renderPage();
    expect(screen.getByRole('heading', { name: 'Account balance' })).toBeTruthy();
    expect(screen.getByText('You owe · 3 items')).toBeTruthy();
    expect(screen.getByText('$52')).toBeTruthy();
    expect(screen.getByText('$45')).toBeTruthy();
    expect(screen.getByText('Yonex Astrox 88D Pro restring')).toBeTruthy();
    expect(screen.getByText('Ready Nov 7')).toBeTruthy();
    expect(screen.getByText('Mon, Nov 2 session')).toBeTruthy();
    expect(screen.getByText('Estimate until the bill is settled')).toBeTruthy();
    expect(screen.getByText(/^Settled Sep 22 · \d+ days ago$/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Profile' }));
    expect(onBack).toHaveBeenCalledOnce();
  });

  it('pays what the credit covers, then asks every balance to re-read', async () => {
    const toasts: TopToastRequest[] = [];
    const onToast = (e: Event) => toasts.push((e as CustomEvent<TopToastRequest>).detail);
    const onBalance = vi.fn();
    window.addEventListener(TOP_TOAST_EVENT, onToast);
    window.addEventListener(BALANCE_EVENT, onBalance);
    try {
      await renderPage();
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Pay $42 with credit' }));
      });
      expect(fetchMock.mock.calls.some(([u, init]) => String(u).endsWith('/api/credit/spend') && init?.method === 'POST')).toBe(true);
      expect(toasts.map((x) => x.title)).toEqual(['Paid $42 with credit']);
      expect(onBalance).toHaveBeenCalled();
    } finally {
      window.removeEventListener(TOP_TOAST_EVENT, onToast);
      window.removeEventListener(BALANCE_EVENT, onBalance);
    }
  });

  it('offers no credit button when the credit covers no frozen line, and no credit box at $0', async () => {
    await renderPage(balanceState(), creditState(0));
    expect(screen.queryByRole('button', { name: /with credit/ })).toBeNull();
    expect(screen.queryByText('Credit')).toBeNull();
  });

  it('opens the e-transfer details, and leaves the button out when the club has no pay-to', async () => {
    await renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Pay $52 by e-transfer' }));
    expect(screen.getByText('pay@example.com')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Copy email' })).toBeTruthy();
    cleanup();
    await renderPage(balanceState({ data: { ...BALANCE, payTo: null } }));
    expect(screen.queryByRole('button', { name: /by e-transfer/ })).toBeNull();
  });

  it('says so when paid up', async () => {
    await renderPage(balanceState({ data: { totalOwed: 0, sessions: [], stringing: [], payTo: null } }), creditState(0));
    expect(screen.getByText('You’re all paid up')).toBeTruthy();
    expect(screen.getByText('$0')).toBeTruthy();
  });

  it('a failed read says so with a retry, never a $0', async () => {
    const reload = vi.fn();
    await renderPage(balanceState({ data: null, loadError: true, reload }));
    expect(screen.getByText('Couldn’t load your balance.')).toBeTruthy();
    expect(screen.queryByText('$0')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(reload).toHaveBeenCalledOnce();
  });
});

describe('PaymentsChart', () => {
  async function renderChart() {
    await act(async () => {
      render(
        <NextIntlClientProvider locale="en" messages={enMessages} timeZone="UTC">
          <PaymentsChart />
        </NextIntlClientProvider>,
      );
    });
  }

  it('opens on the latest month with a payment and breaks it down', async () => {
    await renderChart();
    expect(screen.getByText('$128')).toBeTruthy(); // six-month total
    const october = screen.getByRole('button', { name: /^October: \$40/ });
    expect(october.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText('Sessions · 4 nights')).toBeTruthy();
  });

  it('a tapped month shows its own series, guests by name', async () => {
    await renderChart();
    fireEvent.click(screen.getByRole('button', { name: /^September/ }));
    const box = document.querySelector('.pay-chart__breakdown') as HTMLElement;
    expect(within(box).getByText('September')).toBeTruthy();
    expect(within(box).getByText('$68')).toBeTruthy();
    expect(within(box).getByText('Sessions · 3 nights')).toBeTruthy();
    expect(within(box).getByText('Stringing')).toBeTruthy();
    expect(within(box).getByText('Guest · Jenny, Sep 18')).toBeTruthy();
  });

  it('names every month for a screen reader, and has a legend of what is there', async () => {
    await renderChart();
    const img = screen.getByRole('img');
    expect(img.getAttribute('aria-label')).toMatch(/October: \$40 \(Sessions \$40\)/);
    expect(img.getAttribute('aria-label')).toMatch(/June: nothing paid/);
    const legend = screen.getByRole('list', { name: 'Series' });
    expect(within(legend).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Sessions', 'Stringing', 'Other']);
  });

  it('says when nothing was paid, and when the read failed', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ months: MONTHS.map((m) => ({ ...m, sessions: 0, stringing: 0, other: 0 })) }), { status: 200 }));
    await renderChart();
    expect(screen.getByText('Nothing paid in the last 6 months.')).toBeTruthy();
    cleanup();
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 503 }));
    await renderChart();
    expect(screen.getByText('Couldn’t load what you’ve paid.')).toBeTruthy();
  });
});
