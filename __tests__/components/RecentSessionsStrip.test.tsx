// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import RecentSessionsStrip from '@/components/admin/CommandCenter/RecentSessionsStrip';

const originalFetch = global.fetch;

function mockFetch(impl: typeof fetch) {
  global.fetch = impl as typeof fetch;
}

describe('<RecentSessionsStrip />', () => {
  afterEach(() => {
    cleanup();
    global.fetch = originalFetch;
  });

  it('renders an empty-state card when no archived sessions', async () => {
    mockFetch(async () => new Response(JSON.stringify([]), { status: 200 }));
    render(<RecentSessionsStrip />);
    await waitFor(() => {
      expect(screen.getByText(/No archived sessions/i)).toBeTruthy();
    });
  });

  it('renders a card per session with attendance + paid %', async () => {
    mockFetch(async () => new Response(JSON.stringify([
      { sessionId: 'session-2026-05-13', date: '2026-05-13T20:00:00-04:00', attendanceCount: 12, totalCost: 96, paidPercent: 75, anomalyCodes: [] },
      { sessionId: 'session-2026-05-06', date: '2026-05-06T20:00:00-04:00', attendanceCount: 10, totalCost: 80, paidPercent: 100, anomalyCodes: ['cost_changed'] },
    ]), { status: 200 }));

    render(<RecentSessionsStrip />);

    await waitFor(() => {
      expect(screen.getByText('12')).toBeTruthy();
      expect(screen.getByText('10')).toBeTruthy();
      expect(screen.getByText(/75% paid/)).toBeTruthy();
      expect(screen.getByText(/100% paid/)).toBeTruthy();
    });
  });

  it('shows an anomaly indicator when a session has flagged codes', async () => {
    mockFetch(async () => new Response(JSON.stringify([
      { sessionId: 'session-2026-05-13', date: '2026-05-13T20:00:00-04:00', attendanceCount: 12, totalCost: 96, paidPercent: 75, anomalyCodes: ['cost_changed', 'long_break'] },
    ]), { status: 200 }));

    render(<RecentSessionsStrip />);

    await waitFor(() => {
      // Indicator shows the count of anomalies
      expect(screen.getByText(/^\s*2\s*$/)).toBeTruthy();
    });
  });
});
