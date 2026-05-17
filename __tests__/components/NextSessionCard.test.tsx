// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
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

  describe('advance mis-click guard', () => {
    const session = {
      id: 's', title: 'Wednesday',
      datetime: new Date(Date.now() + 3 * 86_400_000).toISOString(),
      deadline: new Date(Date.now() + 3_600_000).toISOString(),
      courts: 2, maxPlayers: 12, signupOpen: true,
    };

    it('a single tap on "Advance →" does NOT advance — it asks to confirm', async () => {
      let advanced = 0;
      mockFetch(makeFetcher(session, []));
      render(<NextSessionCard onAdvance={() => { advanced += 1; }} />);
      await waitFor(() => expect(screen.getByText('Advance →')).toBeTruthy());

      fireEvent.click(screen.getByText('Advance →'));

      expect(advanced).toBe(0);
      expect(screen.getByText(/Advance to next week\?/)).toBeTruthy();
      expect(screen.getByText('Confirm advance →')).toBeTruthy();
    });

    it('Cancel reverts without advancing; Confirm calls onAdvance once', async () => {
      let advanced = 0;
      mockFetch(makeFetcher(session, []));
      render(<NextSessionCard onAdvance={() => { advanced += 1; }} />);
      await waitFor(() => expect(screen.getByText('Advance →')).toBeTruthy());

      fireEvent.click(screen.getByText('Advance →'));
      fireEvent.click(screen.getByText('Cancel'));
      expect(advanced).toBe(0);
      expect(screen.getByText('Advance →')).toBeTruthy();

      fireEvent.click(screen.getByText('Advance →'));
      fireEvent.click(screen.getByText('Confirm advance →'));
      expect(advanced).toBe(1);
    });
  });

  describe('settle UI (NEXT_PUBLIC_FLAG_SETTLE)', () => {
    const session = {
      id: 's', title: 'Sunday', datetime: new Date(Date.now() + 86_400_000).toISOString(),
      deadline: new Date(Date.now() + 3_600_000).toISOString(),
      courts: 2, maxPlayers: 12, signupOpen: false,
    };
    const settledSession = {
      ...session,
      settled: {
        at: '2026-05-08T20:00:00.000Z',
        costPerPerson: 15,
        totalCost: 90,
        courtTotal: 60,
        birdTotal: 30,
        playerCount: 6,
        playerNames: ['Alice', 'Bob', 'Carol', 'Dan', 'Eve', 'Frank'],
      },
    };

    it('hides Send the bill and Sent badge when flag is off (stable users keep "Share cost")', async () => {
      const prev = process.env.NEXT_PUBLIC_FLAG_SETTLE;
      process.env.NEXT_PUBLIC_FLAG_SETTLE = 'false';
      try {
        mockFetch(makeFetcher(settledSession, []));
        render(<NextSessionCard onShareCost={() => {}} />);
        await waitFor(() => expect(screen.getByText(/Sunday/)).toBeTruthy());
        expect(screen.queryByText(/Send the bill/)).toBeNull();
        expect(screen.queryByText(/Sent ·/)).toBeNull();
        // Legacy button stays for unflagged users.
        expect(screen.getByText(/Share cost/)).toBeTruthy();
      } finally {
        process.env.NEXT_PUBLIC_FLAG_SETTLE = prev;
      }
    });

    it('shows "Send the bill" when flag on and session not yet settled', async () => {
      const prev = process.env.NEXT_PUBLIC_FLAG_SETTLE;
      process.env.NEXT_PUBLIC_FLAG_SETTLE = 'true';
      try {
        mockFetch(makeFetcher(session, []));
        render(<NextSessionCard onShareCost={() => {}} />);
        await waitFor(() => expect(screen.getByText(/Send the bill/)).toBeTruthy());
        expect(screen.queryByText(/Sent ·/)).toBeNull();
        expect(screen.queryByText(/Share cost/)).toBeNull();
      } finally {
        process.env.NEXT_PUBLIC_FLAG_SETTLE = prev;
      }
    });

    it('shows "Sent · $X" badge and "Share again" + "Edit bill" when flag on and session settled', async () => {
      const prev = process.env.NEXT_PUBLIC_FLAG_SETTLE;
      process.env.NEXT_PUBLIC_FLAG_SETTLE = 'true';
      try {
        mockFetch(makeFetcher(settledSession, []));
        render(<NextSessionCard onShareCost={() => {}} />);
        await waitFor(() => expect(screen.getByText(/Sent · \$15/)).toBeTruthy());
        expect(screen.getByText(/Share again — \$15 each/)).toBeTruthy();
        expect(screen.getByText(/Edit bill/)).toBeTruthy();
        expect(screen.queryByText(/Send the bill/)).toBeNull();
      } finally {
        process.env.NEXT_PUBLIC_FLAG_SETTLE = prev;
      }
    });
  });
});
