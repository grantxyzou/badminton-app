// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
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
  it('renders the outstanding total, most-recent line, and verify message', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          totalOwed: 22.5,
          sessionCount: 2,
          mostRecent: { sessionId: 's2', date: '2026-06-08T19:00:00-04:00', owedAmount: 12.5 },
          sessions: [],
        }),
        { status: 200 },
      ),
    );

    wrap(<UnpaidSessionsCard name="Lin" />);

    await waitFor(() => {
      expect(screen.getByText('Outstanding payments')).toBeTruthy();
    });
    // Rich-text amount tag must render the formatted money (not raw <amount>).
    expect(screen.getByText('$22.50')).toBeTruthy();
    expect(screen.getByText(/please verify with your e-transfer statement/i)).toBeTruthy();
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
          sessions: [],
        }),
        { status: 200 },
      ),
    );

    wrap(<UnpaidSessionsCard name="Lin" variant="home" />);

    await waitFor(() => {
      expect(screen.getByText('Your balance')).toBeTruthy();
    });
    // $40 appears in both the headline and the most-recent line.
    expect(screen.getAllByText('$40').length).toBeGreaterThan(0);
  });

  it('home variant shows a paid-up state when nothing is owed (instead of nothing)', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ totalOwed: 0, sessionCount: 0, mostRecent: null, sessions: [] }),
        { status: 200 },
      ),
    );

    wrap(<UnpaidSessionsCard name="Lin" variant="home" />);
    await waitFor(() => {
      expect(screen.getByText(/all paid up/i)).toBeTruthy();
    });
  });
});
