// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import enMessages from '../../messages/en.json';
import ClubLinkCard from '@/components/admin/CommandCenter/ClubLinkCard';

/**
 * The Club link card (docs/plans/one-way-in.md, step 5): the one way anybody
 * joins, in place of the one-time invite card and the door poster card.
 */
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function respond(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));
}

const TOKEN = 'a'.repeat(32);

function renderCard() {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <ClubLinkCard groupName="Six Feathers" />
    </NextIntlClientProvider>,
  );
}

describe('ClubLinkCard', () => {
  it('shows the link as a QR and as text, with share, poster and how many have not signed in', async () => {
    vi.stubGlobal('fetch', vi.fn(() => respond({ link: { token: TOKEN, createdAt: '2026-11-13T00:00:00Z' }, unclaimed: 2 })));
    renderCard();
    expect(await screen.findByRole('img', { name: 'QR code for the club link' })).toBeDefined();
    expect((screen.getByLabelText('The link') as HTMLInputElement).value).toMatch(new RegExp(`/j/${TOKEN}$`));
    expect(screen.getByRole('button', { name: 'Share the link' })).toBeDefined();
    expect(screen.getByRole('button', { name: /Save poster/ })).toBeDefined();
    expect(screen.getByText(/2 people on your list haven't signed in yet/)).toBeDefined();
    // No one-time invite left anywhere on it.
    expect(screen.queryByText(/code/i)).toBeNull();
  });

  it('offers to make one when the club has none', async () => {
    const fetchMock = vi.fn((_u: RequestInfo | URL, init?: RequestInit) =>
      init?.method === 'POST'
        ? respond({ link: { token: TOKEN, createdAt: '2026-11-13T00:00:00Z' } }, 201)
        : respond({ link: null, unclaimed: 0 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    renderCard();
    fireEvent.click(await screen.findByRole('button', { name: 'Make the club link' }));
    expect(await screen.findByRole('img', { name: 'QR code for the club link' })).toBeDefined();
  });

  it('asks before a new link retires the old one', async () => {
    const fetchMock = vi.fn((_u: RequestInfo | URL, init?: RequestInit) =>
      init?.method === 'POST'
        ? respond({ link: { token: 'b'.repeat(32), createdAt: '2026-11-14T00:00:00Z' } }, 201)
        : respond({ link: { token: TOKEN, createdAt: '2026-11-13T00:00:00Z' }, unclaimed: 0 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    renderCard();
    fireEvent.click(await screen.findByRole('button', { name: /New link/ }));
    expect(screen.getByText(/People already asking keep their place/)).toBeDefined();
    expect(fetchMock.mock.calls.some(([, i]) => (i as RequestInit | undefined)?.method === 'POST')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Make a new link' }));
    await waitFor(() => expect((screen.getByLabelText('The link') as HTMLInputElement).value).toMatch(/\/j\/b{32}$/));
  });

  it('a refused read says who can see it, not that it failed', async () => {
    vi.stubGlobal('fetch', vi.fn(() => respond({ error: 'unauthorized' }, 401)));
    renderCard();
    expect(await screen.findByText('Sign in as an admin to see the club link.')).toBeDefined();
  });
});
