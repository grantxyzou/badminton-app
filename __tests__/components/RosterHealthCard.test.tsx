// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import RosterHealthCard from '@/components/admin/CommandCenter/RosterHealthCard';

const originalFetch = global.fetch;

function mockFetch(impl: typeof fetch) {
  global.fetch = impl as typeof fetch;
}

function makeFetcher(session: unknown, players: unknown) {
  return (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : (input as Request).url;
    if (url.includes('/api/session')) return new Response(JSON.stringify(session), { status: 200 });
    if (url.includes('/api/players')) return new Response(JSON.stringify(players), { status: 200 });
    return new Response('not found', { status: 404 });
  }) as typeof fetch;
}

describe('<RosterHealthCard />', () => {
  afterEach(() => {
    cleanup();
    global.fetch = originalFetch;
  });

  it('shows invite list size from session.approvedNames', async () => {
    mockFetch(makeFetcher(
      { approvedNames: ['Daisy', 'Mei', 'Sam'] },
      [],
    ));
    render(<RosterHealthCard />);
    await waitFor(() => {
      expect(screen.getByText('Invite list')).toBeTruthy();
      const inviteStat = screen.getByText('Invite list').closest('div');
      expect(inviteStat?.querySelector('.bpm-h2')?.textContent).toBe('3');
    });
  });

  it('counts waitlist correctly', async () => {
    mockFetch(makeFetcher(
      { approvedNames: [] },
      [
        { id: 'p1' },
        { id: 'p2', waitlisted: true },
        { id: 'p3', waitlisted: true },
      ],
    ));
    render(<RosterHealthCard />);
    await waitFor(() => {
      const waitStat = screen.getByText('Waitlist').closest('div');
      expect(waitStat?.querySelector('.bpm-h2')?.textContent).toBe('2');
    });
  });

  it('counts removed-in-last-7-days', async () => {
    const now = Date.now();
    mockFetch(makeFetcher(
      { approvedNames: [] },
      [
        { id: 'p1', removed: true, removedAt: new Date(now - 2 * 86_400_000).toISOString() },
        { id: 'p2', removed: true, removedAt: new Date(now - 10 * 86_400_000).toISOString() }, // older than 7d
      ],
    ));
    render(<RosterHealthCard />);
    await waitFor(() => {
      const removedStat = screen.getByText(/Removed/).closest('div');
      expect(removedStat?.querySelector('.bpm-h2')?.textContent).toBe('1');
    });
  });
});
