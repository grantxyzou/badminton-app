// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import LedgerPage from '@/components/admin/LedgerPage';

const originalFetch = global.fetch;

const calls: string[] = [];

function mockLedger(payload: unknown, ok = true) {
  calls.length = 0;
  global.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : (input as Request).url;
    calls.push(url);
    if (!ok) return new Response('err', { status: 500 });
    return new Response(JSON.stringify(payload), { status: 200 });
  }) as typeof fetch;
}

const HAPPY = {
  range: { from: '2026-02-01T00:00:00.000Z', to: '2026-05-17T00:00:00.000Z' },
  summary: {
    spent: 30,
    paidAmount: 10,
    coveredAmount: 5,
    collected: 15,
    gap: 15,
    sessionCount: 2,
    coveredCount: 1,
  },
  bySession: [
    {
      sessionId: 's1',
      date: '2026-05-10T19:00:00-04:00',
      attendanceCount: 3,
      totalCost: 30,
      paidCount: 1,
      coveredCount: 1,
      unpaidAmount: 15,
      unpaidCount: 1,
    },
  ],
  byPlayer: [{ memberId: null, name: 'Cara', sessionCount: 1, owedAmount: 15 }],
};

const ALL_CAUGHT_UP = {
  ...HAPPY,
  summary: { ...HAPPY.summary, gap: 0, collected: 30, paidAmount: 30, coveredAmount: 0 },
  bySession: [{ ...HAPPY.bySession[0], unpaidAmount: 0, unpaidCount: 0 }],
  byPlayer: [],
};

const EMPTY = {
  range: HAPPY.range,
  summary: { spent: 0, paidAmount: 0, coveredAmount: 0, collected: 0, gap: 0, sessionCount: 0, coveredCount: 0 },
  bySession: [],
  byPlayer: [],
};

describe('<LedgerPage />', () => {
  afterEach(() => {
    cleanup();
    global.fetch = originalFetch;
  });

  it('renders an error state with retry when the fetch fails', async () => {
    mockLedger(null, false);
    render(<LedgerPage onBack={() => {}} />);
    await waitFor(() => {
      expect(screen.getByText(/Couldn't load the ledger/i)).toBeTruthy();
      expect(screen.getByRole('button', { name: /retry/i })).toBeTruthy();
    });
  });

  it('renders the empty state when nothing is settled in range', async () => {
    mockLedger(EMPTY);
    render(<LedgerPage onBack={() => {}} />);
    await waitFor(() => {
      expect(screen.getByText(/Nothing settled in this window/i)).toBeTruthy();
    });
  });

  it('renders the collected / spent / gap tiles with values', async () => {
    mockLedger(HAPPY);
    render(<LedgerPage onBack={() => {}} />);
    await waitFor(() => {
      expect(screen.getByText('Collected')).toBeTruthy();
      expect(screen.getByText('Spent')).toBeTruthy();
      expect(screen.getByText('Gap')).toBeTruthy();
      // $15 (gap) and $30 (spent) also appear in the session row; assert
      // presence rather than uniqueness.
      expect(screen.getAllByText('$15.00').length).toBeGreaterThan(0);
      expect(screen.getAllByText('$30.00').length).toBeGreaterThan(0);
    });
  });

  it('refetches with the new range when a range chip is tapped', async () => {
    mockLedger(HAPPY);
    render(<LedgerPage onBack={() => {}} />);
    await waitFor(() => expect(screen.getByText('Collected')).toBeTruthy());
    expect(calls[0]).toContain('range=12w');

    fireEvent.click(screen.getByRole('tab', { name: '30 days' }));
    await waitFor(() => {
      expect(calls.some((u) => u.includes('range=30d'))).toBe(true);
    });
  });

  it('hides the By player tab and shows the caught-up line when no one owes', async () => {
    mockLedger(ALL_CAUGHT_UP);
    render(<LedgerPage onBack={() => {}} />);
    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'By session' })).toBeTruthy();
    });
    expect(screen.queryByRole('tab', { name: 'By player' })).toBeNull();
    expect(screen.getByText(/Everyone's caught up\. Nice\./i)).toBeTruthy();
  });

  it('shows the By player tab and switches to the player list when someone owes', async () => {
    mockLedger(HAPPY);
    render(<LedgerPage onBack={() => {}} />);
    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'By player' })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole('tab', { name: 'By player' }));
    await waitFor(() => {
      expect(screen.getByText('Cara')).toBeTruthy();
      expect(screen.getByText('1 unpaid session')).toBeTruthy();
    });
  });

  // ── v1.5/D drill-ins ──

  it('D: tapping a session row calls onOpenSession with its id', async () => {
    mockLedger(HAPPY);
    const onOpenSession = vi.fn();
    render(<LedgerPage onBack={() => {}} onOpenSession={onOpenSession} />);
    await waitFor(() => expect(screen.getByText('Collected')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: /Payments for/i }));
    expect(onOpenSession).toHaveBeenCalledWith('s1');
  });

  it('D: tapping a player row opens the profile sheet (member history)', async () => {
    const HAPPY_MEMBER = {
      ...HAPPY,
      byPlayer: [{ memberId: 'm1', name: 'Cara', sessionCount: 1, owedAmount: 15 }],
    };
    const HISTORY = {
      member: { id: 'm1', name: 'Cara' },
      sessions: [],
      lifetime: { attended: 4, totalPaid: 3 },
    };
    global.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.includes('/history')) {
        return new Response(JSON.stringify(HISTORY), { status: 200 });
      }
      return new Response(JSON.stringify(HAPPY_MEMBER), { status: 200 });
    }) as typeof fetch;

    render(<LedgerPage onBack={() => {}} />);
    await waitFor(() => expect(screen.getByRole('tab', { name: 'By player' })).toBeTruthy());
    fireEvent.click(screen.getByRole('tab', { name: 'By player' }));

    fireEvent.click(await screen.findByRole('button', { name: /Cara's history/i }));

    // Sheet content only appears once the history fetch resolves.
    await waitFor(() => {
      expect(screen.getByText('Sessions attended')).toBeTruthy();
      expect(screen.getByText('Recent sessions')).toBeTruthy();
    });
  });
});
