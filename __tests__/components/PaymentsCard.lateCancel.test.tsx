// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import PaymentsCard from '@/components/admin/CommandCenter/PaymentsCard';

/**
 * The "Late" tag on a cancelled row (docs/plans/late-cancel-fee.md): the
 * admin's record of who gave a spot back inside the club's window, and how
 * close to the start. Only a row the server stamped carries it.
 */

const originalFetch = global.fetch;
const ACTIVE_SESSION = { id: 'session-2026-10-18', datetime: '2026-10-18T20:00:00-07:00', maxPlayers: 12 };

function fetchPlayers(players: Array<Record<string, unknown>>) {
  global.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : (input as Request).url;
    if (url.includes('/api/session') && !url.includes('/sessions')) return new Response(JSON.stringify(ACTIVE_SESSION), { status: 200 });
    if (url.includes('/api/sessions')) return new Response(JSON.stringify([ACTIVE_SESSION]), { status: 200 });
    if (url.includes('/api/players')) return new Response(JSON.stringify(players), { status: 200 });
    return new Response('not found', { status: 404 });
  }) as typeof fetch;
}

describe('<PaymentsCard /> — late cancellations', () => {
  afterEach(() => {
    cleanup();
    global.fetch = originalFetch;
  });

  it('tags a late self-cancel with the hours before the start, and leaves an ordinary cancel untagged', async () => {
    fetchPlayers([
      { id: 'p1', name: 'Daisy', paid: false },
      { id: 'p2', name: 'Mei', paid: false, removed: true, removedAt: '2026-10-17T23:00:00Z', cancelledBySelf: true, lateCancel: true, lateCancelHoursBefore: 20 },
      { id: 'p3', name: 'Akane', paid: false, removed: true, removedAt: '2026-10-12T12:00:00Z', cancelledBySelf: true },
    ]);
    render(<PaymentsCard />);

    fireEvent.click(await screen.findByRole('button', { name: /2 removed/ }));
    expect(await screen.findByText('Late · 20h')).toBeDefined();
    expect(screen.getByLabelText('Cancelled late, 20 hours before the session')).toBeDefined();
    expect(screen.getAllByText(/Late ·/)).toHaveLength(1);
  });
});
