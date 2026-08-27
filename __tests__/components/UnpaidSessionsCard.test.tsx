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
      expect(screen.getByText('Your balance')).toBeTruthy();
    });
    // Three times now: the collapsed row's own figure, the line item, and the
    // total. The row carries the number because a collapsed card showing only
    // a label spends a whole card to say nothing — and the number is the only
    // reason to open it.
    expect(screen.getAllByText('$40').length).toBe(3);
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
    const toggle = await screen.findByRole('button', { name: /your balance/i });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    // Collapsed by default when there is nothing owed...
    expect(screen.queryByText(/all paid up/i)).toBeNull();
    // ...and the copy is there on expand.
    fireEvent.click(toggle);
    await waitFor(() => expect(screen.getByText(/all paid up/i)).toBeTruthy());
  });
});
