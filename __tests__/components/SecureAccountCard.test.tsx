// @vitest-environment jsdom
// @vitest-environment-options { "url": "http://localhost:3000/bpm" }
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import SecureAccountCard from '../../components/auth/SecureAccountCard';
import enMessages from '../../messages/en.json';

/**
 * The nudge must be invisible unless the SERVER says to show it.
 *
 * The policy lives in lib/authNudge.ts and dismissal is stored on the member,
 * not localStorage — so a client-side re-derivation would disagree with the
 * server the moment the same person opened the app on a second device. These
 * tests pin that the component obeys `nudge` rather than deciding for itself.
 */
function renderCard() {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <SecureAccountCard />
    </NextIntlClientProvider>,
  );
}

function mockMethods(body: unknown, ok = true) {
  const fetchMock = vi
    .fn()
    .mockResolvedValue({ ok, json: async () => body } as unknown as Response);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.stubGlobal('navigator', { ...global.navigator, onLine: true });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('SecureAccountCard', () => {
  it('shows for a PIN-only member the server flagged', async () => {
    mockMethods({ available: ['google'], linked: [], hasPin: true, hasPassword: false, nudge: true });
    renderCard();
    await screen.findByText('Make getting back in easier');
  });

  it('stays hidden when the server says not to nudge', async () => {
    mockMethods({ available: ['google'], linked: ['google'], hasPin: true, nudge: false });
    const { container } = renderCard();
    await waitFor(() => expect(container.firstChild).toBeNull());
  });

  it('stays hidden when the probe fails, rather than guessing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const { container } = renderCard();
    await waitFor(() => expect(container.firstChild).toBeNull());
  });

  it('disappears immediately on dismiss and tells the server', async () => {
    const fetchMock = mockMethods({
      available: ['google'],
      linked: [],
      hasPin: true,
      nudge: true,
    });
    const { container } = renderCard();

    const dismiss = await screen.findByText('Not now');
    fireEvent.click(dismiss);

    // Optimistic: making someone watch a spinner to dismiss a suggestion is
    // worse than a lost write.
    await waitFor(() => expect(container.firstChild).toBeNull());
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          (c) => String(c[0]).includes('/api/auth/nudge') && (c[1] as RequestInit)?.method === 'POST',
        ),
      ).toBe(true),
    );
  });

  it('still dismisses when the server write fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        if (String(url).includes('/api/auth/nudge')) return Promise.reject(new Error('down'));
        return Promise.resolve({
          ok: true,
          json: async () => ({ available: ['google'], linked: [], hasPin: true, nudge: true }),
        } as unknown as Response);
      }),
    );
    const { container } = renderCard();
    fireEvent.click(await screen.findByText('Not now'));
    // They see it again in 30 days. Acceptable; a stuck card is not.
    await waitFor(() => expect(container.firstChild).toBeNull());
  });
});
