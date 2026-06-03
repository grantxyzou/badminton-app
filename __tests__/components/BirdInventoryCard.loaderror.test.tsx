// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import BirdInventoryCard from '@/components/admin/CommandCenter/BirdInventoryCard';

/**
 * Audit silent-failure cluster: a failed /api/birds load left summary=null and
 * rendered "No data." — identical to a legitimately empty inventory. It must
 * show an explicit error instead (CLAUDE.md: lying-empty-state forbidden).
 */
const originalFetch = global.fetch;

describe('<BirdInventoryCard /> — load failure', () => {
  afterEach(() => {
    cleanup();
    global.fetch = originalFetch;
  });

  it('shows an error (not "No data.") when the birds fetch fails', async () => {
    global.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.includes('/api/birds')) {
        return new Response(JSON.stringify({ error: 'Failed' }), { status: 503 });
      }
      if (url.includes('/api/sessions')) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      return new Response('not found', { status: 404 });
    }) as typeof fetch;

    render(<BirdInventoryCard />);
    await waitFor(() => {
      expect(screen.getByText(/couldn.t load/i)).toBeTruthy();
    });
    expect(screen.queryByText(/No data\./i)).toBeNull();
  });
});
