// @vitest-environment jsdom
// @vitest-environment-options { "url": "http://localhost:3000/bpm" }
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import SignInMethodsCard from '../../components/auth/SignInMethodsCard';
import enMessages from '../../messages/en.json';

/**
 * The card that replaced the nudge-only one.
 *
 * The hole it closes: the old card required `nudge: true`, which requires a
 * PIN — so every account created by Google or by email had NO route to connect
 * a second provider or disconnect anything, because the nudge was correctly
 * suppressed for them and there was nowhere else to go.
 */
function renderCard() {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <SignInMethodsCard />
    </NextIntlClientProvider>,
  );
}

/** Routes /api/auth/methods to `body`; everything else resolves ok. */
function mockApi(body: unknown, overrides: Record<string, () => Promise<Response>> = {}) {
  const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
    const u = String(url);
    for (const [frag, fn] of Object.entries(overrides)) {
      if (u.includes(frag)) return fn();
    }
    if (u.includes('/api/auth/methods')) {
      return Promise.resolve({ ok: true, json: async () => body } as unknown as Response);
    }
    return Promise.resolve({
      ok: true,
      json: async () => ({ ok: true }),
      _init: init,
    } as unknown as Response);
  });
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

describe('SignInMethodsCard', () => {
  it('shows for a member with NO pin — the case the old card missed', async () => {
    mockApi({ available: ['apple'], linked: ['google'], hasPin: false, hasPassword: false, nudge: false });
    renderCard();
    await screen.findByText('How you sign in');
    // And offers the provider they have not connected yet.
    await screen.findByText('Connect Apple');
  });

  it('lists every credential the member holds', async () => {
    mockApi({
      available: [],
      linked: ['google'],
      hasPin: true,
      hasPassword: true,
      email: 'grant@example.com',
      nudge: false,
    });
    renderCard();
    await screen.findByText('PIN');
    await screen.findByText('grant@example.com');
    await screen.findByText('Google connected');
  });

  it('renders as the NUDGE when the server asks for it', async () => {
    mockApi({ available: ['google'], linked: [], hasPin: true, hasPassword: false, nudge: true });
    renderCard();
    await screen.findByText('Make getting back in easier');
    await screen.findByText('Not now');
  });

  it('renders as plain management when the server does not', async () => {
    mockApi({ available: ['google'], linked: [], hasPin: true, hasPassword: true, nudge: false });
    renderCard();
    await screen.findByText('How you sign in');
    expect(screen.queryByText('Not now')).toBeNull();
  });

  it('asks for confirmation before disconnecting', async () => {
    mockApi({ available: [], linked: ['google'], hasPin: true, nudge: false });
    renderCard();
    fireEvent.click(await screen.findByText('Disconnect'));
    await screen.findByText('Disconnect?');
    await screen.findByText('Keep it');
  });

  it('explains the refusal when this is the last way back in', async () => {
    // The server decides this, not the client — but the message has to be
    // specific, or the user just sees "something went wrong" on the one action
    // that was deliberately blocked to protect them.
    mockApi(
      { available: [], linked: ['google'], hasPin: false, hasPassword: false, nudge: false },
      {
        '/api/auth/identity': () =>
          Promise.resolve({
            ok: false,
            json: async () => ({ error: 'last_credential' }),
          } as unknown as Response),
      },
    );
    renderCard();
    fireEvent.click(await screen.findByText('Disconnect'));
    fireEvent.click(await screen.findByText('Disconnect?'));
    await screen.findByText(/only way back in/i);
  });

  it('shows a load error rather than an empty list when the probe fails', async () => {
    // "You have no sign-in methods" would be the lying-empty-state failure
    // applied to the most alarming possible subject.
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    renderCard();
    await screen.findByText(/Couldn't load your sign-in methods/i);
  });

  it('treats a throttled probe as unknown, not as no methods', async () => {
    mockApi({ available: null, linked: null });
    renderCard();
    await screen.findByText(/Couldn't load your sign-in methods/i);
  });

  it('dismisses the nudge without hiding the card', async () => {
    // Dismissing the PROMPT must not remove the management surface — that is
    // the whole point of merging them.
    const fetchMock = mockApi({
      available: ['google'],
      linked: [],
      hasPin: true,
      hasPassword: false,
      nudge: true,
    });
    renderCard();
    fireEvent.click(await screen.findByText('Not now'));

    await screen.findByText('How you sign in');
    await waitFor(() =>
      expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('/api/auth/nudge'))).toBe(true),
    );
  });
});
