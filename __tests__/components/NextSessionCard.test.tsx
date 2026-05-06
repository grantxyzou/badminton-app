// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import NextSessionCard from '@/components/admin/CommandCenter/NextSessionCard';

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

describe('<NextSessionCard />', () => {
  afterEach(() => {
    cleanup();
    global.fetch = originalFetch;
  });

  it('shows "no active session" when API returns nothing', async () => {
    mockFetch(makeFetcher(null, []));
    render(<NextSessionCard />);
    await waitFor(() => {
      expect(screen.getByText(/No active session/i)).toBeTruthy();
    });
  });

  it('shows capacity, signup state, and deadline', async () => {
    const future = new Date(Date.now() + 3 * 86_400_000).toISOString();
    const deadline = new Date(Date.now() + 3_600_000 * 5).toISOString();
    mockFetch(makeFetcher(
      { id: 's', title: 'Wednesday', datetime: future, deadline, courts: 2, maxPlayers: 12, signupOpen: true },
      [
        { id: 'p1' }, { id: 'p2' }, { id: 'p3' },
        { id: 'p4', waitlisted: true },
      ],
    ));

    render(<NextSessionCard />);

    await waitFor(() => {
      expect(screen.getByText(/3 \/ 12 signed up/)).toBeTruthy();
      expect(screen.getByText(/\+1 waitlist/)).toBeTruthy();
      expect(screen.getByText(/Signup open/)).toBeTruthy();
      expect(screen.getByText(/left/)).toBeTruthy();
    });
  });

  it('shows "Signup closed" when session.signupOpen is false', async () => {
    const future = new Date(Date.now() + 3 * 86_400_000).toISOString();
    mockFetch(makeFetcher(
      { id: 's', title: 'Wednesday', datetime: future, deadline: future, courts: 2, maxPlayers: 12, signupOpen: false },
      [],
    ));

    render(<NextSessionCard />);

    await waitFor(() => {
      expect(screen.getByText(/Signup closed/)).toBeTruthy();
    });
  });

  it('marks deadline as Passed when in the past', async () => {
    const future = new Date(Date.now() + 3 * 86_400_000).toISOString();
    const past = new Date(Date.now() - 3_600_000).toISOString();
    mockFetch(makeFetcher(
      { id: 's', title: 'X', datetime: future, deadline: past, courts: 2, maxPlayers: 12, signupOpen: true },
      [],
    ));

    render(<NextSessionCard />);

    await waitFor(() => {
      expect(screen.getByText(/Passed/)).toBeTruthy();
    });
  });
});
