// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import enMessages from '@/messages/en.json';
import UnpaidSessionsCard from '@/components/UnpaidSessionsCard';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function wrap(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe('<UnpaidSessionsCard />', () => {
  it('renders an itemized invoice (a line per session) and a total', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          totalOwed: 22.5,
          sessionCount: 2,
          mostRecent: { sessionId: 's2', date: '2026-06-08T19:00:00-04:00', owedAmount: 12.5 },
          sessions: [
            { sessionId: 's2', date: '2026-06-08T19:00:00-04:00', owedAmount: 12.5 },
            { sessionId: 's1', date: '2026-06-01T19:00:00-04:00', owedAmount: 10 },
          ],
        }),
        { status: 200 },
      ),
    );

    wrap(<UnpaidSessionsCard name="Lin" />);

    await waitFor(() => {
      expect(screen.getByText('Outstanding payments')).toBeTruthy();
    });
    // One line item per session + a Total row.
    expect(screen.getByText('$12.50')).toBeTruthy();
    expect(screen.getByText('$10')).toBeTruthy();
    expect(screen.getByText('Total')).toBeTruthy();
    expect(screen.getByText('$22.50')).toBeTruthy();
  });

  it('a part-paid line shows what is left and "paid $30 of $45" (docs/plans/paid-amount.md)', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async () =>
      new Response(
        JSON.stringify({
          totalOwed: 15,
          sessionCount: 1,
          mostRecent: { sessionId: 's2', date: '2026-06-08T19:00:00-04:00', owedAmount: 15 },
          sessions: [{ sessionId: 's2', playerId: 'r1', date: '2026-06-08T19:00:00-04:00', owedAmount: 15, paidAmount: 30, billedAmount: 45, settled: true }],
          stringing: [],
        }),
        { status: 200 },
      ),
    );
    wrap(<UnpaidSessionsCard name="Lin" />);
    // fmtMoney drops the cents on a whole figure: "$30", "$45".
    await waitFor(() => expect(screen.getByText(/paid \$30 of \$45/)).toBeTruthy());
    expect(screen.getAllByText('$15').length).toBeGreaterThan(0);
  });

  it('renders nothing when nothing is owed', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ totalOwed: 0, sessionCount: 0, mostRecent: null, sessions: [] }),
        { status: 200 },
      ),
    );

    const { container } = wrap(<UnpaidSessionsCard name="Lin" />);
    await waitFor(() => {
      expect(container.querySelector('.glass-card')).toBeNull();
    });
  });

  it('shows a legible load-error pill on fetch failure (not a silent empty)', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response('boom', { status: 500 }));

    wrap(<UnpaidSessionsCard name="Lin" />);
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeTruthy();
    });
  });

  it('e-transfer is one button that opens to the address, the amount and the memo, each a row that copies (docs/plans/payment-order.md)', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          totalOwed: 22.5,
          sessionCount: 1,
          mostRecent: { sessionId: 's1', date: '2026-06-08T19:00:00-04:00', owedAmount: 22.5 },
          sessions: [{ sessionId: 's1', date: '2026-06-08T19:00:00-04:00', owedAmount: 22.5 }],
          payTo: { name: 'Club Treasurer', email: 'pay@example.com' },
          memo: 'BPM Core Jun 8 - Lin',
        }),
        { status: 200 },
      ),
    );

    wrap(<UnpaidSessionsCard name="Lin" />);

    const toggle = await screen.findByRole('button', { name: 'Pay by Interac e-Transfer' });
    // Closed at first: the rows do not fill the card above the other ways to pay.
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('button', { name: 'Copy the email address pay@example.com' })).toBeNull();

    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('button', { name: 'Copy the email address pay@example.com' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Copy the amount $22.50' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Copy the message BPM Core Jun 8 - Lin' })).toBeTruthy();
  });

  it('the ways to pay read credit, then e-transfer, then card', async () => {
    vi.stubEnv('NEXT_PUBLIC_FLAG_STORE_CREDIT', 'true');
    vi.spyOn(global, 'fetch').mockImplementation(async (input: RequestInfo | URL) =>
      String(input).includes('/api/credit')
        ? new Response(JSON.stringify({ balanceCents: 1000 }), { status: 200 })
        : new Response(JSON.stringify({
          totalOwed: 40,
          sessionCount: 1,
          mostRecent: { sessionId: 's1', date: '2026-06-08T19:00:00-04:00', owedAmount: 40, settled: true },
          sessions: [{ sessionId: 's1', date: '2026-06-08T19:00:00-04:00', owedAmount: 40, settled: true }],
          payTo: { name: 'Club Treasurer', email: 'pay@example.com' },
          cardPay: true,
        }), { status: 200 }),
    );
    wrap(<UnpaidSessionsCard name="Lin" variant="home" />);
    await screen.findByRole('button', { name: 'Use $10 credit' });
    const names = screen.getAllByRole('button').map((b) => b.getAttribute('aria-label') ?? b.textContent ?? '');
    const at = (re: RegExp) => names.findIndex((n) => re.test(n));
    expect(at(/Use \$10 credit/)).toBeGreaterThan(-1);
    expect(at(/Use \$10 credit/)).toBeLessThan(at(/Interac e-Transfer/));
    expect(at(/Interac e-Transfer/)).toBeLessThan(at(/Pay by card/));
    vi.unstubAllEnvs();
  });

  it('home variant shows the balance title and owed amount', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          totalOwed: 40,
          sessionCount: 1,
          mostRecent: { sessionId: 's1', date: '2026-06-08T19:00:00-04:00', owedAmount: 40 },
          sessions: [{ sessionId: 's1', date: '2026-06-08T19:00:00-04:00', owedAmount: 40 }],
        }),
        { status: 200 },
      ),
    );

    wrap(<UnpaidSessionsCard name="Lin" variant="home" />);

    await waitFor(() => {
      expect(screen.getByText('Balance')).toBeTruthy();
    });
    // TWICE when expanded: the line item and the total. The collapsed row's
    // own figure hides once open, because the Total row two lines below says
    // the same number and a card that states its total twice reads like it is
    // not sure. Collapsed, that figure is the only reason to open the card, so
    // it is there instead.
    expect(screen.getAllByText('$40').length).toBe(2);
  });

  /* The rule here is unchanged: paid-up must not render as NOTHING — the card
     has to say so. What changed is that it says so collapsed, because a card
     whose whole content is "you're all paid up" does not need a card's worth of
     Home every week. So: the card and its title are present, and the copy is
     one tap away rather than absent. */
  it('home variant shows a paid-up state when nothing is owed (instead of nothing)', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ totalOwed: 0, sessionCount: 0, mostRecent: null, sessions: [] }),
        { status: 200 },
      ),
    );

    wrap(<UnpaidSessionsCard name="Lin" variant="home" />);
    // Renders, rather than vanishing.
    const toggle = await screen.findByRole('button', { name: /balance/i });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    // Collapsed by default when there is nothing owed...
    expect(screen.queryByLabelText(/all paid up/i)).toBeNull();
    // ...and on expand it says so: "You owe $0" with a tick named "You're all
    // paid up" (the canvas, Balance option A).
    fireEvent.click(toggle);
    await waitFor(() => expect(screen.getByLabelText(/all paid up/i)).toBeTruthy());
    expect(screen.getByTestId('balance-amount').textContent).toContain('You owe$0');
  });

  /* Option A (Grant, 2026-11-17: "outstanding balance priority"): what is owed
     leads, and credit is a chip beside it, never the paid-up card's content. */
  it('home variant leads with what is owed, credit as a chip beside it', async () => {
    vi.stubEnv('NEXT_PUBLIC_FLAG_STORE_CREDIT', 'true');
    vi.spyOn(global, 'fetch').mockImplementation(async (input: RequestInfo | URL) =>
      String(input).includes('/api/credit')
        ? new Response(JSON.stringify({ balanceCents: 1000 }), { status: 200 })
        : new Response(JSON.stringify({
          totalOwed: 40,
          sessionCount: 1,
          mostRecent: { sessionId: 's1', date: '2026-06-08T19:00:00-04:00', owedAmount: 40 },
          sessions: [{ sessionId: 's1', date: '2026-06-08T19:00:00-04:00', owedAmount: 40 }],
        }), { status: 200 }),
    );
    wrap(<UnpaidSessionsCard name="Lin" variant="home" />);
    const amount = await screen.findByTestId('balance-amount');
    expect(amount.textContent).toContain('You owe$40');
    expect((await screen.findByTestId('credit-chip')).textContent).toContain('$10 credit');
    // The amount above the lines is the total on Home: no second Total row.
    expect(screen.queryByText('Total')).toBeNull();
    expect(screen.queryByText(/in credit\./)).toBeNull();
    vi.unstubAllEnvs();
  });

  /* docs/plans/partial-credit.md: credit short of the bill is used anyway, and
     the button says how much; covering everything it says "Pay with credit";
     with nothing frozen to pay it is not offered at all. */
  it.each([
    [1000, true, 'Use $10 credit'],
    [5000, true, 'Pay with credit'],
    [1000, false, null],
  ])('credit %i with a settled bill %s: the button reads %s', async (creditCents, settled, label) => {
    vi.stubEnv('NEXT_PUBLIC_FLAG_STORE_CREDIT', 'true');
    vi.spyOn(global, 'fetch').mockImplementation(async (input: RequestInfo | URL) =>
      String(input).includes('/api/credit')
        ? new Response(JSON.stringify({ balanceCents: creditCents }), { status: 200 })
        : new Response(JSON.stringify({
          totalOwed: 40,
          sessionCount: 1,
          mostRecent: { sessionId: 's1', date: '2026-06-08T19:00:00-04:00', owedAmount: 40, settled },
          sessions: [{ sessionId: 's1', date: '2026-06-08T19:00:00-04:00', owedAmount: 40, settled }],
        }), { status: 200 }),
    );
    wrap(<UnpaidSessionsCard name="Lin" variant="home" />);
    await screen.findByTestId('credit-chip');
    if (label) expect(screen.getByRole('button', { name: label })).toBeTruthy();
    else expect(screen.queryByRole('button', { name: /credit/i })).toBeNull();
    vi.unstubAllEnvs();
  });
});

describe('it re-reads when something else changes what is owed', () => {
  it('refetches on BALANCE_EVENT', async () => {
    // Accepting a stringing price change moves the bill, and this card is a
    // separate component with its own fetch. Without this the player agreed to
    // $34 and the total above it kept saying $30 — the app contradicting itself
    // about the same racket on the same screen, which is the failure
    // `toPlayerJob`'s amountDue comment exists to prevent.
    const { BALANCE_EVENT } = await import('@/lib/balanceRefresh');
    const body = (total: number) =>
      new Response(
        JSON.stringify({
          totalOwed: total,
          sessionCount: 0,
          sessions: [],
          stringing: [
            { jobId: 'j1', jobNo: 'J-0001', racketLabel: 'Astrox 99 Pro', amount: total, at: '2026-09-01T00:00:00.000Z' },
          ],
        }),
        { status: 200 },
      );

    const fetchSpy = vi
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(body(30))
      .mockResolvedValueOnce(body(34));

    wrap(<UnpaidSessionsCard name="Lin" variant="home" />);
    // Twice over: the stringing line and the total. Both must move.
    await waitFor(() => expect(screen.getAllByText('$30')).toHaveLength(2));

    fireEvent(window, new CustomEvent(BALANCE_EVENT));
    await waitFor(() => expect(screen.getAllByText('$34')).toHaveLength(2));
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});

/**
 * Empty and error states (2026-09-14, Grant): signed out is not a failure, so
 * it is not red, and every state that asks the reader to do something gives
 * them the control to do it with.
 */
describe('<UnpaidSessionsCard /> states', () => {
  it('signed out on Home: muted copy and a Sign in button, not a red alert', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response('{}', { status: 403 }));
    const onSignIn = vi.fn();
    wrap(<UnpaidSessionsCard name="Kento" variant="home" onSignIn={onSignIn} />);
    expect(await screen.findByText('Sign in to see what you owe.')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(onSignIn).toHaveBeenCalledOnce();
  });

  it('a real load failure stays an alert, with a Try again that asks again', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(new Response('{}', { status: 500 }));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    wrap(<UnpaidSessionsCard name="Lin" variant="home" />);
    expect((await screen.findByRole('alert')).textContent).toBe("Couldn't load what you owe.");
    const before = fetchSpy.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(fetchSpy.mock.calls.length).toBeGreaterThan(before));
  });
});

describe('<UnpaidSessionsCard variant="home" onDetails />', () => {
  it('links to the detailed view (Profile → Account balance)', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          totalOwed: 10,
          sessionCount: 1,
          mostRecent: null,
          sessions: [{ sessionId: 's1', date: '2026-06-01T19:00:00-04:00', owedAmount: 10 }],
        }),
        { status: 200 },
      ),
    );
    const onDetails = vi.fn();
    wrap(<UnpaidSessionsCard name="Kento" variant="home" onDetails={onDetails} />);
    const link = await screen.findByRole('button', { name: 'See details' });
    fireEvent.click(link);
    expect(onDetails).toHaveBeenCalledOnce();
  });
});

/**
 * Spec Q2 (Grant, 2026-11-12: "do Q2 now"): redeeming a gift card sits on
 * Home's balance card, beside the credit it adds to, while store credit is on.
 */
describe('<UnpaidSessionsCard variant="home" onRedeem />', () => {
  const owing = () =>
    vi.spyOn(global, 'fetch').mockImplementation(async (input: RequestInfo | URL) =>
      String(input).includes('/api/credit')
        ? new Response(JSON.stringify({ balanceCents: 0 }), { status: 200 })
        : new Response(
            JSON.stringify({
              totalOwed: 10,
              sessionCount: 1,
              mostRecent: null,
              sessions: [{ sessionId: 's1', date: '2026-06-01T19:00:00-04:00', owedAmount: 10 }],
            }),
            { status: 200 },
          ),
    );

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('offers "Add a code" with store credit on, and hands the tap to Home', async () => {
    vi.stubEnv('NEXT_PUBLIC_FLAG_STORE_CREDIT', 'true');
    owing();
    const onRedeem = vi.fn();
    wrap(<UnpaidSessionsCard name="Kento" variant="home" onDetails={vi.fn()} onRedeem={onRedeem} />);
    const link = await screen.findByRole('button', { name: 'Add a code' });
    expect(screen.getByRole('button', { name: 'See details' })).toBeTruthy();
    fireEvent.click(link);
    expect(onRedeem).toHaveBeenCalledOnce();
  });

  it('offers it on a paid-up card too, once the card is opened: a gift card is not only for paying a debt', async () => {
    vi.stubEnv('NEXT_PUBLIC_FLAG_STORE_CREDIT', 'true');
    vi.spyOn(global, 'fetch').mockImplementation(async (input: RequestInfo | URL) =>
      String(input).includes('/api/credit')
        ? new Response(JSON.stringify({ balanceCents: 0 }), { status: 200 })
        : new Response(JSON.stringify({ totalOwed: 0, sessionCount: 0, mostRecent: null, sessions: [] }), { status: 200 }),
    );
    wrap(<UnpaidSessionsCard name="Kento" variant="home" onRedeem={vi.fn()} />);
    // Paid up, Home's card starts as one closed row ($0); its body opens on a tap.
    const row = await screen.findByRole('button', { expanded: false });
    expect(screen.queryByRole('button', { name: 'Add a code' })).toBeNull();
    fireEvent.click(row);
    expect(await screen.findByRole('button', { name: 'Add a code' })).toBeTruthy();
  });

  it('is absent while store credit is off', async () => {
    vi.stubEnv('NEXT_PUBLIC_FLAG_STORE_CREDIT', 'false');
    owing();
    wrap(<UnpaidSessionsCard name="Kento" variant="home" onDetails={vi.fn()} onRedeem={vi.fn()} />);
    await screen.findByRole('button', { name: 'See details' });
    expect(screen.queryByRole('button', { name: 'Add a code' })).toBeNull();
  });
});
