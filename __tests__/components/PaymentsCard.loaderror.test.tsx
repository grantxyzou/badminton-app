// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import PaymentsCard from '@/components/admin/CommandCenter/PaymentsCard';

/**
 * Audit silent-failure cluster: loadPlayers() swallowed a failed /api/players
 * fetch (setAllPlayers([]) with no error flag), so a players-API failure while
 * the session loaded fine rendered the identical "No active players" empty
 * state — on a payments/settle surface. It must trip loadError instead.
 */
const originalFetch = global.fetch;
const ACTIVE_SESSION = { id: 'session-2026-05-13', datetime: '2026-05-13T20:00:00-04:00', maxPlayers: 12 };

describe('<PaymentsCard /> — players load failure', () => {
  afterEach(() => {
    cleanup();
    global.fetch = originalFetch;
  });

  it('shows the load-error pill (not "No active players") when the players fetch fails', async () => {
    global.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.includes('/api/session') && !url.includes('/sessions')) {
        return new Response(JSON.stringify(ACTIVE_SESSION), { status: 200 });
      }
      if (url.includes('/api/sessions')) {
        return new Response(JSON.stringify([ACTIVE_SESSION]), { status: 200 });
      }
      if (url.includes('/api/players')) {
        return new Response(JSON.stringify({ error: 'Failed to load players' }), { status: 503 });
      }
      return new Response('not found', { status: 404 });
    }) as typeof fetch;

    render(<PaymentsCard />);
    await waitFor(() => {
      expect(screen.getByText(/couldn.t load/i)).toBeTruthy();
    });
    expect(screen.queryByText(/No active players/i)).toBeNull();
  });
});
