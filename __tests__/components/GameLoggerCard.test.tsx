// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import GameLoggerCard from '../../components/stats/GameLoggerCard';
import enMessages from '../../messages/en.json';

function setIdentity(name: string) {
  localStorage.setItem(
    'badminton_identity',
    JSON.stringify({ name, token: 'tok', sessionId: 'session-2026-06-18' }),
  );
}

function mockSession(body: unknown, ok = true) {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok,
    json: async () => body,
  })) as unknown as typeof fetch);
}

function renderCard() {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <GameLoggerCard />
    </NextIntlClientProvider>,
  );
}

describe('GameLoggerCard', () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it('renders the logger any day, regardless of the session datetime', async () => {
    setIdentity('Lin');
    // A long-past session — the old 48h window would have hidden the card.
    mockSession({ sessionId: 'session-2026-06-18', datetime: '2020-01-01T00:00:00Z' });
    renderCard();
    await waitFor(() => expect(screen.getByText('Log a game')).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Log it' })).toBeTruthy();
  });

  it('also renders when the session has no datetime at all', async () => {
    setIdentity('Lin');
    mockSession({ sessionId: 'session-2026-06-18' });
    renderCard();
    await waitFor(() => expect(screen.getByText('Log a game')).toBeTruthy());
  });

  it('opens the logger sheet on tap', async () => {
    setIdentity('Lin');
    mockSession({ sessionId: 'session-2026-06-18' });
    renderCard();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Log it' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Log it' }));
    // Sheet body renders its inputs once open.
    await waitFor(() => expect(screen.getByText('Your score')).toBeTruthy());
  });

  it('shows a legible error pill (never a blank) when the session fails to load', async () => {
    setIdentity('Lin');
    mockSession({}, false);
    renderCard();
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByText(/Couldn't load game logging/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Log it' })).toBeNull();
  });

  it('renders nothing when there is no identity', async () => {
    mockSession({ sessionId: 'session-2026-06-18' });
    const { container } = renderCard();
    // No identity → never fetches, renders nothing.
    await waitFor(() => expect(container).toBeTruthy());
    expect(screen.queryByText('Log a game')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
