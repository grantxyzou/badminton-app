// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
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
