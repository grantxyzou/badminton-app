// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import ETransferRecipientEditor from '../../components/admin/CommandCenter/ETransferRecipientEditor';

/**
 * Lying empty state: a failed settings load used to render "Not set" with an
 * "Add recipient" button whose blank form would PATCH over the real recipient.
 * A failure must read as a failure, offer a retry that re-runs the load, and
 * render nothing that can save.
 */
const originalFetch = global.fetch;

describe('ETransferRecipientEditor — a failed load is not "no recipient"', () => {
  afterEach(() => {
    cleanup();
    global.fetch = originalFetch;
  });

  it('shows the error with Try again, not the empty copy or an edit control', async () => {
    let fail = true;
    global.fetch = (async () =>
      fail
        ? new Response('{}', { status: 500 })
        : new Response(
            JSON.stringify({ eTransferRecipient: { name: 'Lin', email: 'lin@example.com' } }),
            { status: 200 },
          )) as typeof fetch;

    render(<ETransferRecipientEditor />);

    expect((await screen.findByRole('alert')).textContent).toContain("Couldn't load your e-transfer recipient.");
    expect(screen.queryByText(/Not set/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add recipient' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();

    fail = false;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByText('lin@example.com')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
