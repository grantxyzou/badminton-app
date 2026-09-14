// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import AdvanceSessionForm from '@/components/admin/AdvanceSessionForm';

/**
 * The skip-date read is the one "suggestion" that is really a check: it stops
 * an advance onto a holiday. A failed read used to leave an empty list, which
 * waved every date through with nothing on screen. It must say so, and retry.
 */
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('<AdvanceSessionForm /> skip-date check', () => {
  it('says when it could not check skip dates, and Try again reads them again', async () => {
    let settingsCalls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/api/admin/settings')) {
          settingsCalls += 1;
          return settingsCalls === 1
            ? ({ ok: false, status: 500, json: async () => ({}) } as Response)
            : ({ ok: true, status: 200, json: async () => ({ skipDates: [] }) } as Response);
        }
        return { ok: true, status: 200, json: async () => ({}) } as Response;
      }),
    );

    render(<AdvanceSessionForm onBack={() => {}} />);
    expect(await screen.findByText(/Couldn.t check your skip dates/)).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(screen.queryByText(/Couldn.t check your skip dates/)).toBeNull());
    expect(settingsCalls).toBe(2);
  });
});
