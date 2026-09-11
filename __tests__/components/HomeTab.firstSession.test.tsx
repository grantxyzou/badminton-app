// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import enMessages from '../../messages/en.json';
import HomeTab from '@/components/HomeTab';

/**
 * A CLUB ON THE DAY IT IS CREATED.
 *
 * `GET /api/session` answers 404 for a group with no pointer, which is every
 * club until its organiser sets the first night. Rendering the ordinary week
 * against a null session gave a date tile reading "—", two blank location tiles
 * and a sign-up card for nothing — an empty room, as the first thing a new
 * organiser sees after making their club.
 *
 * Who it asks matters as much as what it says: the organiser gets the action,
 * and a player gets told one is coming rather than a control they cannot use.
 */
const FLAG = 'NEXT_PUBLIC_FLAG_MULTI_GROUP';

function mockFetch(sessionStatus: number) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/api/session')) {
      return { ok: sessionStatus === 200, status: sessionStatus, json: async () => ({}) } as Response;
    }
    return { ok: true, status: 200, json: async () => [] } as Response;
  });
}

function renderHome(props: { isAdmin?: boolean } = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <HomeTab {...props} />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  process.env[FLAG] = 'true';
  vi.stubGlobal('fetch', mockFetch(404));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  delete process.env[FLAG];
});

describe('HomeTab with no session yet', () => {
  it('tells the organiser what to do, and offers the way', async () => {
    renderHome({ isAdmin: true });
    expect(await screen.findByText('No session yet')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Set your first session' })).toBeDefined();
  });

  it('tells a player one is coming, WITHOUT a control they cannot use', async () => {
    renderHome({ isAdmin: false });
    expect(await screen.findByText('No session yet')).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Set your first session' })).toBeNull();
  });

  it('sends the organiser to Admin', async () => {
    const onTabChange = vi.fn();
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <HomeTab isAdmin onTabChange={onTabChange} />
      </NextIntlClientProvider>,
    );
    (await screen.findByRole('button', { name: 'Set your first session' })).click();
    await waitFor(() => expect(onTabChange).toHaveBeenCalledWith('admin'));
  });

  it('does NOT replace the week with the flag off', async () => {
    // One club, so a missing session means the POINTER is missing — and the
    // ordinary layout is the honest report of that, not a first-run welcome.
    delete process.env[FLAG];
    renderHome({ isAdmin: true });
    await waitFor(() => expect(screen.queryByText('No session yet')).toBeNull());
  });

  it('does not show it when a session exists', async () => {
    vi.stubGlobal('fetch', mockFetch(200));
    renderHome({ isAdmin: true });
    await waitFor(() => expect(screen.queryByText('No session yet')).toBeNull());
  });
});
