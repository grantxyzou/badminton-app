// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import PaymentsCard from '@/components/admin/CommandCenter/PaymentsCard';

/**
 * A brand-new club (multi-group) has no session yet, so `GET /api/session`
 * answers 404 `no_active_session`. The card read any non-ok as a failed load
 * and showed its red "Couldn't load payments" — to an organiser who had
 * created the club seconds earlier. Nothing failed; nothing is owed yet.
 */
const originalFetch = global.fetch;

describe('<PaymentsCard /> — a club with no session yet', () => {
  afterEach(() => {
    cleanup();
    global.fetch = originalFetch;
  });

  it('says there is nothing to collect yet, and does not show a load error', async () => {
    global.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.includes('/api/session') && !url.includes('/sessions')) {
        return new Response(JSON.stringify({ error: 'no_active_session' }), { status: 404 });
      }
      if (url.includes('/api/sessions')) return new Response(JSON.stringify([]), { status: 200 });
      if (url.includes('/api/players')) {
        return new Response(JSON.stringify({ error: 'no_active_session' }), { status: 404 });
      }
      return new Response('not found', { status: 404 });
    }) as typeof fetch;

    render(<PaymentsCard />);
    expect(await screen.findByText(/Nothing to collect yet/i)).toBeTruthy();
    expect(screen.queryByText(/couldn.t load/i)).toBeNull();
    expect(screen.queryByText(/No active players/i)).toBeNull();
  });

  it('a 404 without the no_active_session body is still a load failure', async () => {
    global.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.includes('/api/sessions')) return new Response(JSON.stringify([]), { status: 200 });
      return new Response('gone', { status: 404 });
    }) as typeof fetch;

    render(<PaymentsCard />);
    expect(await screen.findByText(/couldn.t load/i)).toBeTruthy();
    expect(screen.queryByText(/Nothing to collect yet/i)).toBeNull();
  });
});
