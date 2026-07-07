// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import AssignUsageSheet from '../../components/admin/AssignUsageSheet';
import type { BirdPurchase } from '../../lib/types';

const PURCHASE: BirdPurchase = {
  id: 'pur-1',
  name: 'RSL 4',
  tubes: 10,
  totalCost: 250,
  costPerTube: 25,
  date: '2026-06-01',
  createdAt: '2026-06-01T00:00:00Z',
};

// Three sessions with no existing usage for this purchase
const SESSIONS = [
  { id: 'session-2026-06-10', title: 'Tue A', datetime: '2026-06-10T19:00:00Z', birdUsages: [] },
  { id: 'session-2026-06-17', title: 'Tue B', datetime: '2026-06-17T19:00:00Z', birdUsages: [] },
  { id: 'session-2026-06-24', title: 'Tue C', datetime: '2026-06-24T19:00:00Z', birdUsages: [] },
];

describe('AssignUsageSheet — resilience (partial-failure)', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('attempts all rows even when the 2nd PATCH fails and surfaces a partial-failure message', async () => {
    const onSaved = vi.fn();
    const onClose = vi.fn();
    let patchCount = 0;

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        const u = String(url);
        const method = init?.method ?? 'GET';

        if (method === 'GET' && u.includes('/api/sessions')) {
          return new Response(JSON.stringify(SESSIONS), { status: 200 });
        }
        if (method === 'PATCH' && u.includes('/api/session/bird-usage')) {
          patchCount++;
          if (patchCount === 2) {
            // The 2nd PATCH fails with a server error
            return new Response(JSON.stringify({ error: 'server error' }), { status: 500 });
          }
          return new Response('{}', { status: 200 });
        }
        return new Response('not found', { status: 404 });
      }),
    );

    render(
      <AssignUsageSheet
        open={true}
        onClose={onClose}
        purchase={PURCHASE}
        onSaved={onSaved}
      />,
    );

    // Wait for the 3 session rows to load
    await waitFor(() => {
      expect(screen.getAllByLabelText('Increase tubes').length).toBe(3);
    });

    // Make all 3 rows dirty by clicking + once on each
    const plusButtons = screen.getAllByLabelText('Increase tubes');
    fireEvent.click(plusButtons[0]);
    fireEvent.click(plusButtons[1]);
    fireEvent.click(plusButtons[2]);

    // Save button should now be enabled (rows are dirty)
    const saveBtn = screen.getByRole('button', { name: 'Save' });
    expect(saveBtn.hasAttribute('disabled')).toBe(false);
    fireEvent.click(saveBtn);

    // All 3 PATCHes must be attempted (no early abort)
    await waitFor(() => {
      expect(patchCount).toBe(3);
    });

    // Partial-failure message must appear
    await waitFor(() => {
      const alert = screen.getByRole('alert');
      expect(alert.textContent).toMatch(/Saved 2 of 3/);
    });

    // Sheet stays open (onClose NOT called)
    expect(onClose).not.toHaveBeenCalled();

    // onSaved IS called because 2 rows succeeded
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it('closes the sheet and calls onSaved when all PATCHes succeed', async () => {
    const onSaved = vi.fn();
    const onClose = vi.fn();

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        const u = String(url);
        const method = init?.method ?? 'GET';
        if (method === 'GET' && u.includes('/api/sessions')) {
          return new Response(JSON.stringify(SESSIONS), { status: 200 });
        }
        if (method === 'PATCH' && u.includes('/api/session/bird-usage')) {
          return new Response('{}', { status: 200 });
        }
        return new Response('not found', { status: 404 });
      }),
    );

    render(
      <AssignUsageSheet
        open={true}
        onClose={onClose}
        purchase={PURCHASE}
        onSaved={onSaved}
      />,
    );

    await waitFor(() => {
      expect(screen.getAllByLabelText('Increase tubes').length).toBe(3);
    });

    // Make one row dirty
    fireEvent.click(screen.getAllByLabelText('Increase tubes')[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1);
    });
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
