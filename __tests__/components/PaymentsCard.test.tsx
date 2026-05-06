// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import PaymentsCard from '@/components/admin/CommandCenter/PaymentsCard';

const originalFetch = global.fetch;

function mockFetch(impl: typeof fetch) {
  global.fetch = impl as typeof fetch;
}

describe('<PaymentsCard />', () => {
  afterEach(() => {
    cleanup();
    global.fetch = originalFetch;
  });

  it('renders an empty card with "No active players" when no players', async () => {
    mockFetch(async () => new Response(JSON.stringify([]), { status: 200 }));
    render(<PaymentsCard />);
    await waitFor(() => {
      expect(screen.getByText(/No active players/i)).toBeTruthy();
    });
  });

  it('filters out removed and waitlisted players', async () => {
    mockFetch(async () => new Response(JSON.stringify([
      { id: 'p1', name: 'Daisy', paid: true },
      { id: 'p2', name: 'Mei', paid: false },
      { id: 'p3', name: 'Removed', paid: false, removed: true },
      { id: 'p4', name: 'Waitlist', paid: false, waitlisted: true },
    ]), { status: 200 }));

    render(<PaymentsCard />);

    await waitFor(() => {
      expect(screen.getByText('Daisy')).toBeTruthy();
      expect(screen.getByText('Mei')).toBeTruthy();
      expect(screen.queryByText('Removed')).toBeNull();
      expect(screen.queryByText('Waitlist')).toBeNull();
    });
  });

  it('shows paid count in header', async () => {
    mockFetch(async () => new Response(JSON.stringify([
      { id: 'p1', name: 'Daisy', paid: true },
      { id: 'p2', name: 'Mei', paid: true },
      { id: 'p3', name: 'Sam', paid: false },
    ]), { status: 200 }));

    render(<PaymentsCard />);

    await waitFor(() => {
      expect(screen.getByText(/2 of 3 paid/i)).toBeTruthy();
    });
  });

  it('toggles paid optimistically and PATCHes the API', async () => {
    let patchedBody: { id: string; paid: boolean } | null = null;
    let getCount = 0;
    mockFetch(async (input, init) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
      if (method === 'GET' && url.includes('/api/players')) {
        getCount++;
        return new Response(JSON.stringify([
          { id: 'p1', name: 'Daisy', paid: false },
        ]), { status: 200 });
      }
      if (method === 'PATCH' && url.includes('/api/players')) {
        patchedBody = JSON.parse(init?.body as string);
        return new Response('{}', { status: 200 });
      }
      return new Response('not found', { status: 404 });
    });

    render(<PaymentsCard />);

    await waitFor(() => {
      expect(screen.getByText('Daisy')).toBeTruthy();
    });
    expect(getCount).toBeGreaterThan(0);

    const pill = screen.getByRole('button', { name: 'Pending' });
    fireEvent.click(pill);

    await waitFor(() => {
      expect(patchedBody).toEqual({ id: 'p1', paid: true });
    });
  });
});
