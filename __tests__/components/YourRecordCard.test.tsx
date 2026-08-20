// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import YourRecordCard from '../../components/stats/YourRecordCard';
import { OnlineProvider } from '../../lib/useOnline';
import enMessages from '../../messages/en.json';

function jsonResponse(body: unknown, ok = true) {
  return Promise.resolve({ ok, status: ok ? 200 : 500, json: async () => body } as Response);
}

function mockFetchByUrl(handlers: ReadonlyArray<readonly [string, () => Promise<Response>]>) {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      const entry = handlers.find(([needle]) => url.includes(needle));
      if (!entry) return Promise.reject(new Error(`Unmocked fetch: ${url}`));
      return entry[1]();
    }) as unknown as typeof fetch,
  );
}

const SESSION = ['/api/session', () => jsonResponse({ sessionId: 'session-2026-08-20' })] as const;
const PLAYERS = ['/api/players', () => jsonResponse({ players: [{ name: 'Viktor' }, { name: 'Akane' }] })] as const;

function games(n: { id: string; a: number; b: number }[]) {
  return [
    '/api/games',
    () =>
      jsonResponse({
        games: n.map((g) => ({
          id: g.id,
          sessionId: 's',
          teamA: ['Lin', 'Viktor'],
          teamB: ['Akane', 'Kento'],
          scoreA: g.a,
          scoreB: g.b,
          loggedBy: 'Lin',
          loggedAt: `2026-08-0${n.indexOf(g) + 1}T00:00:00.000Z`,
        })),
      }),
  ] as const;
}

function renderCard() {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <OnlineProvider>
        <YourRecordCard activeName="Lin" />
      </OnlineProvider>
    </NextIntlClientProvider>,
  );
}

describe('YourRecordCard', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('shows the won-of-played fraction and the rows', async () => {
    mockFetchByUrl([SESSION, PLAYERS, games([{ id: 'a', a: 21, b: 15 }, { id: 'b', a: 18, b: 21 }])]);
    renderCard();
    await waitFor(() => expect(screen.getByText('1 of 2')).toBeTruthy());
    expect(screen.getByText('21–15')).toBeTruthy();
    expect(screen.getByText('18–21')).toBeTruthy();
    expect(screen.getByText('won')).toBeTruthy();
    expect(screen.getByText('lost')).toBeTruthy();
  });

  it('names the partner, not the opponents', async () => {
    mockFetchByUrl([SESSION, PLAYERS, games([{ id: 'a', a: 21, b: 15 }])]);
    renderCard();
    await waitFor(() => expect(screen.getByText('with Viktor')).toBeTruthy());
  });

  // ── Honest states ───────────────────────────────────────────────────────
  it('shows an empty state that still offers the only action', async () => {
    mockFetchByUrl([SESSION, PLAYERS, games([])]);
    renderCard();
    await waitFor(() => expect(screen.getByText(/No games logged yet/)).toBeTruthy());
    // The empty state must not hide the CTA — it is the way out of empty.
    expect(screen.getByRole('button', { name: 'Add a game' })).toBeTruthy();
    expect(screen.getByText('0 of 0')).toBeTruthy();
  });

  it('never renders "0 of 0" when the read FAILED', async () => {
    mockFetchByUrl([
      SESSION,
      PLAYERS,
      ['/api/games', () => jsonResponse({ error: 'load_failed' }, false)],
    ]);
    renderCard();
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    // A confident zero here is indistinguishable from a real new player.
    expect(screen.queryByText('0 of 0')).toBeNull();
  });

  it('keeps the CTA available even when the read failed', async () => {
    mockFetchByUrl([
      SESSION,
      PLAYERS,
      ['/api/games', () => jsonResponse({ error: 'load_failed' }, false)],
    ]);
    renderCard();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add a game' })).toBeTruthy());
  });

  it('caps the visible rows at 8 but keeps the header count whole', async () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ id: `g${i}`, a: 21, b: 15 }));
    mockFetchByUrl([SESSION, PLAYERS, games(many)]);
    renderCard();
    await waitFor(() => expect(screen.getByText('12 of 12')).toBeTruthy());
    expect(screen.getAllByText('21–15').length).toBe(8);
  });

  it('opens the stepped logger from the CTA', async () => {
    mockFetchByUrl([SESSION, PLAYERS, games([])]);
    renderCard();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add a game' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Add a game' }));
    await waitFor(() => expect(screen.getByText('Who did you play with?')).toBeTruthy());
  });

  it('renders nothing without an active name', () => {
    mockFetchByUrl([SESSION, PLAYERS, games([])]);
    const { container } = render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <OnlineProvider>
          <YourRecordCard activeName={null} />
        </OnlineProvider>
      </NextIntlClientProvider>,
    );
    expect(container.textContent).toBe('');
  });
});
