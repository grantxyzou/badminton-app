// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent, within } from '@testing-library/react';
import LedgerPage from '@/components/admin/LedgerPage';

/**
 * The money view renders from ONE payload, and the things that can go wrong
 * are specific: a failed load drawing tiles anyway, an estimate reading as a
 * total, a mismatch count going unseen, an expense posted with the wrong shape.
 */

const originalFetch = global.fetch;
const calls: { url: string; init?: RequestInit }[] = [];

interface Routes {
  ledger?: unknown;
  ledgerStatus?: number;
  expenses?: unknown;
  reconcile?: unknown;
  history?: unknown;
}

function mockFetch(routes: Routes) {
  calls.length = 0;
  global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : (input as Request).url;
    calls.push({ url, init });
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
    if (url.includes('/api/admin/ledger/reconcile')) return json(routes.reconcile ?? { lastAt: null });
    if (url.includes('/api/admin/ledger')) return routes.ledgerStatus ? new Response('{"error":"read_failed"}', { status: routes.ledgerStatus }) : json(routes.ledger);
    if (url.includes('/api/admin/expenses')) return init?.method === 'POST' ? json({ expense: {} }, 201) : init?.method === 'DELETE' ? json({ ok: true }) : json(routes.expenses ?? { expenses: [] });
    if (url.includes('/history')) return json(routes.history ?? { member: { id: 'm1', name: 'Cara' }, sessions: [], lifetime: { attended: 4, totalPaid: 3 } });
    return new Response('nope', { status: 404 });
  }) as typeof fetch;
}

const HAPPY = {
  range: { key: '12w', from: '2026-07-15T00:00:00.000Z', to: '2026-10-07T00:00:00.000Z' },
  generatedAt: '2026-10-07T00:00:00.000Z',
  income: { sessions: 30000, stringing: 3000, total: 33000 },
  collected: { etransferAuto: 12000, etransferAdmin: 4000, manual: 6000, credit: 2000, total: 24000 },
  covered: 1200,
  outstanding: { sessions: 1500, stringing: 2800, total: 4300, people: 2 },
  credit: { liability: 2500, members: 1 },
  giftCards: { unredeemed: 2, amount: 3500 },
  outlay: { courts: 18000, shuttles: 25000, strings: 1500, other: 0, total: 44500 },
  net: 24000 - 44500,
  unfinalized: { count: 1, estimatedTotal: 100, sessions: [{ sessionId: 'u1', date: '2026-10-03T19:00:00-04:00', estimatedTotal: 100, players: 5 }] },
  reconcile: { lastAt: new Date(Date.now() - 3_600_000).toISOString(), mismatches: 0, unlisted: 0, truncated: false },
  bySession: [{ sessionId: 's1', date: '2026-09-26T19:00:00-04:00', attendanceCount: 3, totalCost: 30, paidCount: 1, coveredCount: 1, unpaidAmount: 15, unpaidCount: 1 }],
  byPlayer: [{ memberId: 'm1', name: 'Cara', sessionCount: 1, owedAmount: 15 }],
};

describe('<LedgerPage />', () => {
  afterEach(() => {
    cleanup();
    global.fetch = originalFetch;
  });

  it('a failed load is the error state and NO tiles', async () => {
    mockFetch({ ledgerStatus: 503 });
    const { container } = render(<LedgerPage onBack={() => {}} />);
    await waitFor(() => expect(screen.getByText(/Couldn't load the ledger/i)).toBeTruthy());
    expect(screen.getByRole('button', { name: /try again/i })).toBeTruthy();
    expect(container.querySelectorAll('.cc-tile')).toHaveLength(0);
  });

  it('draws in-and-out, collected-by, still-owed, credit and outlay from one payload', async () => {
    mockFetch({ ledger: HAPPY });
    render(<LedgerPage onBack={() => {}} />);
    await waitFor(() => expect(screen.getByText('Collected')).toBeTruthy());
    const inOut = screen.getByRole('region', { name: 'In and out' });
    expect(within(inOut).getByText('$240.00')).toBeTruthy();
    expect(within(inOut).getByText('$445.00')).toBeTruthy();
    expect(within(inOut).getByText('−$205.00')).toBeTruthy(); // a minus before the dollar, never "$-"
    expect(within(inOut).getByText(/\$12\.00 covered by you · 1 session settled/)).toBeTruthy();

    const by = screen.getByRole('region', { name: 'Collected by' });
    expect(within(by).getByText('E-transfer, matched on its own')).toBeTruthy();
    expect(within(by).getByText('$120.00')).toBeTruthy();
    expect(within(by).getByText('Store credit')).toBeTruthy();

    const owed = screen.getByRole('region', { name: 'Still owed' });
    expect(within(owed).getAllByText('$15.00').length).toBeGreaterThan(0); // the tile (cents) and Cara's row (dollars) agree
    expect(within(owed).getByText('$28.00')).toBeTruthy();
    expect(within(owed).getByText('People')).toBeTruthy();
    expect(within(owed).getByText('Cara')).toBeTruthy();

    const creditCard = screen.getByRole('region', { name: 'Credit & gift cards' });
    expect(within(creditCard).getByText('$25.00')).toBeTruthy();
    expect(within(creditCard).getByText(/2 gift cards not yet redeemed/)).toBeTruthy();

    const outlay = screen.getByRole('region', { name: 'Club outlay' });
    expect(within(outlay).getByText('$250.00')).toBeTruthy(); // shuttles
  });

  it('an estimate appears only inside "Not yet finalized", never as income', async () => {
    mockFetch({ ledger: HAPPY });
    render(<LedgerPage onBack={() => {}} />);
    await waitFor(() => expect(screen.getByText('Collected')).toBeTruthy());
    const matches = screen.getAllByText(/\$100\.00/);
    for (const el of matches) {
      expect(screen.getByRole('region', { name: 'Not yet finalized' }).contains(el)).toBe(true);
    }
    expect(screen.getByText(/not income until you settle/i)).toBeTruthy();
  });

  it('reconcile null reads "not checked yet"; mismatches read amber, badge the owed card, and open the sheet', async () => {
    mockFetch({ ledger: { ...HAPPY, reconcile: null } });
    render(<LedgerPage onBack={() => {}} />);
    await waitFor(() => expect(screen.getByText(/Ledger not checked yet/)).toBeTruthy());
    expect(screen.queryByText('ledger ≠ app')).toBeNull();
    cleanup();

    mockFetch({
      ledger: { ...HAPPY, reconcile: { ...HAPPY.reconcile, mismatches: 2 } },
      reconcile: {
        lastAt: HAPPY.reconcile.lastAt,
        checked: 9,
        unlisted: 0,
        truncated: false,
        mismatches: [{ memberId: 'm1', name: 'Cara', ref: { kind: 'session', id: 'r1', pk: 's1' }, code: 'missing_payment', ledgerCents: 1500, liveCents: 0 }],
      },
    });
    render(<LedgerPage onBack={() => {}} />);
    await waitFor(() => expect(screen.getByRole('status')).toBeTruthy());
    expect(screen.getByRole('status').textContent).toMatch(/2 lines don’t match/);
    expect(screen.getByText('ledger ≠ app')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'See what' }));
    await waitFor(() => expect(screen.getByText(/Paid, but the ledger still shows it owed/)).toBeTruthy());
    expect(screen.getByText(/ledger \$15\.00 · app \$0\.00/)).toBeTruthy();
  });

  it('Add expense posts cents, note, date and category, then refetches', async () => {
    mockFetch({ ledger: HAPPY });
    render(<LedgerPage onBack={() => {}} />);
    await waitFor(() => expect(screen.getByText('Collected')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Add expense' }));
    fireEvent.change(await screen.findByLabelText('Amount'), { target: { value: '12.5' } });
    fireEvent.change(screen.getByLabelText('What for'), { target: { value: ' Court booking fee ' } });
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-10-03' } });
    fireEvent.click(screen.getByRole('tab', { name: 'Courts' }));
    const before = calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(calls.some((c) => c.init?.method === 'POST' && c.url.includes('/api/admin/expenses'))).toBe(true));
    const post = calls.find((c) => c.init?.method === 'POST')!;
    expect(JSON.parse(post.init!.body as string)).toEqual({ amountCents: 1250, note: 'Court booking fee', date: '2026-10-03', category: 'court' });
    await waitFor(() => expect(calls.slice(before).some((c) => c.url.includes('/api/admin/ledger?range=') && !c.init?.method)).toBe(true));
  });

  it('lists your expenses and removes one after a confirm', async () => {
    mockFetch({ ledger: HAPPY, expenses: { expenses: [{ id: 'expense:abc', amountCents: 1500, note: 'Grip tape', date: '2026-10-03', category: 'strings' }] } });
    render(<LedgerPage onBack={() => {}} />);
    await waitFor(() => expect(screen.getByText('Grip tape')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Remove Grip tape' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm remove Grip tape' }));
    await waitFor(() => expect(calls.some((c) => c.init?.method === 'DELETE')).toBe(true));
    expect(JSON.parse(calls.find((c) => c.init?.method === 'DELETE')!.init!.body as string)).toEqual({ id: 'expense:abc' });
  });

  it('refetches with the new range when a chip is tapped', async () => {
    mockFetch({ ledger: HAPPY });
    render(<LedgerPage onBack={() => {}} />);
    await waitFor(() => expect(screen.getByText('Collected')).toBeTruthy());
    expect(calls[0].url).toContain('range=12w');
    fireEvent.click(screen.getByRole('tab', { name: '30 days' }));
    await waitFor(() => expect(calls.some((c) => c.url.includes('range=30d'))).toBe(true));
  });

  it('tapping a settled session, an unfinalized session, or a player drills in', async () => {
    mockFetch({ ledger: HAPPY });
    const onOpenSession = vi.fn();
    render(<LedgerPage onBack={() => {}} onOpenSession={onOpenSession} />);
    await waitFor(() => expect(screen.getByText('Collected')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /^Payments for .*(?<!not finalized\))$/ }));
    expect(onOpenSession).toHaveBeenCalledWith('s1');
    fireEvent.click(screen.getByRole('button', { name: /\(not finalized\)$/ }));
    expect(onOpenSession).toHaveBeenCalledWith('u1');
    fireEvent.click(screen.getByRole('button', { name: /Cara's history/i }));
    await waitFor(() => expect(screen.getByText('Sessions attended')).toBeTruthy());
  });
});
