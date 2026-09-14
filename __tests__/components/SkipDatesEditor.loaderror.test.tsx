// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import SkipDatesEditor from '../../components/admin/CommandCenter/SkipDatesEditor';

/**
 * Lying empty state: a failed settings load used to render "No skip dates
 * yet." with a live Add control — and the next Add PATCHed `[newDate]` over
 * the real list. A failure must read as a failure, offer a retry that re-runs
 * the load, and render nothing that can save.
 */
const originalFetch = global.fetch;

describe('SkipDatesEditor — a failed load is not an empty list', () => {
  afterEach(() => {
    cleanup();
    global.fetch = originalFetch;
  });

  it('shows the error with Try again, not the empty copy or the Add control', async () => {
    let fail = true;
    global.fetch = (async () =>
      fail
        ? new Response('{}', { status: 500 })
        : new Response(JSON.stringify({ skipDates: ['2026-12-25'] }), { status: 200 })) as typeof fetch;

    render(<SkipDatesEditor />);

    expect((await screen.findByRole('alert')).textContent).toContain("Couldn't load your skip dates.");
    expect(screen.queryByText('No skip dates yet.')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add' })).toBeNull();

    fail = false;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByText('2026-12-25')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('treats a thrown fetch as a failure too', async () => {
    global.fetch = (async () => {
      throw new Error('network down');
    }) as typeof fetch;

    render(<SkipDatesEditor />);

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.queryByText('No skip dates yet.')).toBeNull();
  });
});
