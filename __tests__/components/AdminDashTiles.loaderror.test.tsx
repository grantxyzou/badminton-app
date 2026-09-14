// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import AdminDashTiles from '@/components/admin/CommandCenter/AdminDashTiles';

/**
 * A failed summary load used to sit in a red-tinted box saying "refresh to
 * retry" with nothing to press. It must show the failure with a Try again that
 * actually re-runs the fetch.
 */
const originalFetch = global.fetch;

describe('<AdminDashTiles /> — load failure', () => {
  afterEach(() => {
    cleanup();
    global.fetch = originalFetch;
  });

  it('shows the error with a working Try again', async () => {
    let birdsCalls = 0;
    global.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.includes('/api/birds')) {
        birdsCalls += 1;
        if (birdsCalls === 1) return new Response(JSON.stringify({ error: 'Failed' }), { status: 503 });
        return new Response(JSON.stringify({ currentStock: 12, burnPerSession: 3 }), { status: 200 });
      }
      if (url.includes('/api/members')) {
        return new Response(JSON.stringify([{ active: true, sessionCount: 4, lastSeen: new Date().toISOString() }]), { status: 200 });
      }
      return new Response('not found', { status: 404 });
    }) as typeof fetch;

    render(<AdminDashTiles onOpenBirds={() => {}} onOpenRoster={() => {}} />);

    const retry = await screen.findByRole('button', { name: /try again/i });
    expect(screen.getByRole('alert').textContent).toMatch(/couldn.t load/i);
    expect(screen.queryByText(/refresh/i)).toBeNull();

    fireEvent.click(retry);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Bird inventory' })).toBeTruthy();
    });
    expect(birdsCalls).toBe(2);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('keeps the tile that loaded, and colours each failed tile by why it failed', async () => {
    global.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.includes('/api/birds')) return new Response('{}', { status: 500 });
      if (url.includes('/api/members')) return new Response('{}', { status: 401 });
      return new Response('not found', { status: 404 });
    }) as typeof fetch;

    const { container } = render(<AdminDashTiles onOpenBirds={() => {}} onOpenRoster={() => {}} />);
    await screen.findByRole('button', { name: /try again/i });
    const tones = [...container.querySelectorAll('[data-tone]')].map((e) => e.getAttribute('data-tone'));
    // Birds failed (red, retryable); Roster was refused (amber, the session is gone).
    expect(tones).toEqual(['danger', 'warn']);
    expect(screen.getByRole('alert').textContent).toMatch(/couldn.t load/i);
    expect(screen.getByRole('status').textContent).toMatch(/session expired/i);
    expect(screen.getByRole('button', { name: 'Reload' })).toBeTruthy();
  });

  it('one failed read does not blank the other tile', async () => {
    global.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.includes('/api/birds')) return new Response('{}', { status: 500 });
      if (url.includes('/api/members')) {
        return new Response(JSON.stringify([{ active: true, sessionCount: 4, lastSeen: new Date().toISOString() }]), { status: 200 });
      }
      return new Response('not found', { status: 404 });
    }) as typeof fetch;

    render(<AdminDashTiles onOpenBirds={() => {}} onOpenRoster={() => {}} />);
    expect(await screen.findByRole('button', { name: 'Roster' })).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toMatch(/couldn.t load/i);
  });
});
