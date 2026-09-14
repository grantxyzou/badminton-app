// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import enMessages from '../../messages/en.json';
import HomeTab from '@/components/HomeTab';

/**
 * Empty/error state audit, 2026-09-14: a week that could not be read used to
 * render "—" tiles and a sign-up card counting spots in a session that never
 * arrived. It says so now, with a way to ask again.
 */
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderHome() {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <HomeTab />
    </NextIntlClientProvider>,
  );
}

describe('Home when the week will not load', () => {
  it('shows an alert and Try again instead of a sign-up card for nothing', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetchMock = vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) }) as Response);
    vi.stubGlobal('fetch', fetchMock);
    renderHome();
    expect((await screen.findByRole('alert')).textContent).toBe("Couldn't load this week's session.");
    expect(screen.queryByText(/spots left/)).toBeNull();
    const before = fetchMock.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(before));
  });
});
