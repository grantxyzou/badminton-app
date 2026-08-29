// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor, act, fireEvent } from '@testing-library/react';
import AnomalyFeed from '@/components/admin/CommandCenter/AnomalyFeed';

const originalFetch = global.fetch;

function mockFetch(impl: typeof fetch) {
  global.fetch = impl as typeof fetch;
}

describe('<AnomalyFeed />', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    cleanup();
    global.fetch = originalFetch;
    vi.useRealTimers();
  });

  it('renders nothing when there are no anomalies', async () => {
    mockFetch(async () => new Response(JSON.stringify([]), { status: 200 }));
    const { container } = render(<AnomalyFeed />);
    await waitFor(() => {
      expect(container.querySelector('section')).toBeNull();
    });
  });

  it('renders one row per anomaly with the correct message', async () => {
    mockFetch(async () => new Response(JSON.stringify([
      { code: 'cost_changed', severity: 'warning', message: 'Cost is $40 this week, was $32. Confirm?', dismissable: true },
      { code: 'skip_date', severity: 'blocking', message: 'May 20 is on your skip list.', dismissable: false },
    ]), { status: 200 }));

    render(<AnomalyFeed />);

    await waitFor(() => {
      expect(screen.getByText(/Cost is \$40 this week/)).toBeTruthy();
      expect(screen.getByText(/May 20 is on your skip list/)).toBeTruthy();
    });
  });

  it('shows a dismiss button only for dismissable anomalies', async () => {
    mockFetch(async () => new Response(JSON.stringify([
      { code: 'cost_changed', severity: 'warning', message: 'cost', dismissable: true },
      { code: 'skip_date', severity: 'blocking', message: 'skip', dismissable: false },
    ]), { status: 200 }));

    render(<AnomalyFeed />);

    await waitFor(() => {
      const dismissButtons = screen.getAllByRole('button', { name: /Dismiss/i });
      expect(dismissButtons.length).toBe(1);
      expect(dismissButtons[0].getAttribute('aria-label')).toContain('cost_changed');
    });
  });

  describe('auto-hide', () => {
    const warn = { code: 'cost_changed', severity: 'warning', message: 'cost drifted', dismissable: true };
    const block = { code: 'skip_date', severity: 'blocking', message: 'on your skip list', dismissable: false };

    it('hides a dismissable notice once its time is up', async () => {
      mockFetch(async () => new Response(JSON.stringify([warn]), { status: 200 }));
      render(<AnomalyFeed />);
      await waitFor(() => expect(screen.getByText('cost drifted')).toBeTruthy());

      await act(async () => { vi.advanceTimersByTime(6500); });
      expect(screen.queryByText('cost drifted')).toBeNull();
    });

    /**
     * THE POINT OF THE WHOLE DESIGN. The server flag means "an admin saw this
     * and accepted it". Six seconds of being rendered cannot claim that — the
     * phone may have been in a pocket — so the timer hides the toast and
     * nothing else. An un-actioned notice returns on the next load.
     */
    it('does NOT tell the server it was dismissed', async () => {
      const calls: string[] = [];
      mockFetch(async (url: RequestInfo | URL) => {
        calls.push(String(url));
        return new Response(JSON.stringify([warn]), { status: 200 });
      });
      render(<AnomalyFeed />);
      await waitFor(() => expect(screen.getByText('cost drifted')).toBeTruthy());

      await act(async () => { vi.advanceTimersByTime(6500); });
      expect(calls.some((u) => u.includes('dismiss-anomaly'))).toBe(false);
    });

    /**
     * `skip_date` is `dismissable: false` because it exists to stop you
     * advancing onto a date you said to skip. There is nothing to dismiss, so
     * there is nothing for a timer to do — it must still be there afterwards.
     */
    it('never hides a non-dismissable notice', async () => {
      mockFetch(async () => new Response(JSON.stringify([block]), { status: 200 }));
      render(<AnomalyFeed />);
      await waitFor(() => expect(screen.getByText('on your skip list')).toBeTruthy());

      await act(async () => { vi.advanceTimersByTime(30_000); });
      expect(screen.getByText('on your skip list')).toBeTruthy();
    });

    it('hides the dismissable one and keeps the blocking one, together', async () => {
      mockFetch(async () => new Response(JSON.stringify([warn, block]), { status: 200 }));
      render(<AnomalyFeed />);
      await waitFor(() => expect(screen.getByText('cost drifted')).toBeTruthy());

      await act(async () => { vi.advanceTimersByTime(6500); });
      expect(screen.queryByText('cost drifted')).toBeNull();
      expect(screen.getByText('on your skip list')).toBeTruthy();
    });

    /** So a toast cannot vanish mid-sentence while it is being read. */
    it('pauses while the pointer is over it', async () => {
      mockFetch(async () => new Response(JSON.stringify([warn]), { status: 200 }));
      const { container } = render(<AnomalyFeed />);
      await waitFor(() => expect(screen.getByText('cost drifted')).toBeTruthy());

      const stack = container.querySelector('.toast-stack')!;
      fireEvent.mouseEnter(stack);
      await act(async () => { vi.advanceTimersByTime(30_000); });
      expect(screen.getByText('cost drifted')).toBeTruthy();

      // ...and resumes when the pointer leaves.
      fireEvent.mouseLeave(stack);
      await act(async () => { vi.advanceTimersByTime(6500); });
      expect(screen.queryByText('cost drifted')).toBeNull();
    });
  });

  it('renders nothing on a 401 (non-admin context)', async () => {
    mockFetch(async () => new Response('unauthorized', { status: 401 }));
    const { container } = render(<AnomalyFeed />);
    await waitFor(() => {
      expect(container.querySelector('section')).toBeNull();
    });
  });

  it('renders nothing on a network error', async () => {
    mockFetch(async () => { throw new Error('boom'); });
    const { container } = render(<AnomalyFeed />);
    await waitFor(() => {
      expect(container.querySelector('section')).toBeNull();
    });
  });
});
