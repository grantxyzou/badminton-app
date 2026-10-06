// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import AnnouncementsCard from '@/components/admin/CommandCenter/AnnouncementsCard';

/**
 * Audit silent-failure cluster: load() only set items on res.ok and swallowed
 * errors, so a failed announcements fetch rendered "No announcements posted" —
 * a lying empty state (CLAUDE.md). It must show an explicit error instead.
 */
const originalFetch = global.fetch;

describe('<AnnouncementsCard /> — load failure', () => {
  afterEach(() => {
    cleanup();
    global.fetch = originalFetch;
  });

  it('shows an error (not "No announcements posted") when the load fails', async () => {
    global.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.includes('/api/announcements')) {
        return new Response(JSON.stringify({ error: 'Failed' }), { status: 503 });
      }
      return new Response('not found', { status: 404 });
    }) as typeof fetch;

    render(<AnnouncementsCard />);
    await waitFor(() => {
      expect(screen.getByText(/couldn.t load/i)).toBeTruthy();
    });
    expect(screen.queryByText(/No announcements posted/i)).toBeNull();
  });
});

describe('AnnouncementsCard while the list loads (loading cascade, phase 5)', () => {
  it('does not say "No announcements posted" over a list nobody has read', () => {
    global.fetch = (() => new Promise<Response>(() => {})) as typeof fetch;
    render(<AnnouncementsCard />);
    expect(screen.queryByText('No announcements posted')).toBeNull();
    global.fetch = originalFetch;
  });
});
