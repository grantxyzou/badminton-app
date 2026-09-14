// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import ReleasesView from '../../components/admin/ReleasesView';
import enMessages from '../../messages/en.json';

/**
 * Lying empty state: `if (res.ok)` with no else rendered "No releases yet." on
 * a failed load. A failure must read as a failure with a retry that re-runs it.
 */
const originalFetch = global.fetch;

// The two keys this fix introduces are merged in here, so the assertions read
// English whether or not messages/en.json has picked them up yet.
const messages = {
  ...enMessages,
  admin: {
    ...enMessages.admin,
    releases: {
      ...enMessages.admin.releases,
      loadError: "Couldn't load releases.",
      retry: 'Try again',
    },
  },
};

describe('ReleasesView — a failed load is not "No releases yet."', () => {
  afterEach(() => {
    cleanup();
    global.fetch = originalFetch;
  });

  it('shows the error with Try again, and retrying re-runs the load', async () => {
    let fail = true;
    global.fetch = (async () =>
      fail
        ? new Response('{}', { status: 500 })
        : new Response(JSON.stringify([]), { status: 200 })) as typeof fetch;

    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <ReleasesView onBack={vi.fn()} />
      </NextIntlClientProvider>,
    );

    expect((await screen.findByRole('alert')).textContent).toContain("Couldn't load releases.");
    expect(screen.queryByText('No releases yet.')).toBeNull();

    fail = false;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByText('No releases yet.')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
