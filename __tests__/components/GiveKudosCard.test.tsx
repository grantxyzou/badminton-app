// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import GiveKudosCard from '../../components/stats/GiveKudosCard';
import { OnlineProvider } from '../../lib/useOnline';
import enMessages from '../../messages/en.json';

/**
 * Two defects, one card:
 *   C2 — `/api/games` mapped a non-ok response to `{games: []}` BEFORE any
 *        `.catch` could see it, so a failed read emptied `coPlayers` and the
 *        card unmounted exactly like "no games in the window".
 *   C3 — a failed kudos POST deleted the 'sending' key and nothing else, so
 *        the button re-enabled looking untouched and the member believed they
 *        had sent recognition that was never written.
 */
function signIn(name: string) {
  localStorage.setItem('badminton_identity', JSON.stringify({ name, token: 't', sessionId: 's' }));
}

/** Session start, relative to now, in hours. */
function isoHoursAgo(h: number) {
  return new Date(Date.now() - h * 60 * 60 * 1000).toISOString();
}

type Handler = readonly [string, () => Promise<Response>];

function json(body: unknown, status = 200) {
  return Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => body } as Response);
}

function mockFetchByUrl(handlers: ReadonlyArray<Handler>) {
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

const IN_WINDOW = ['/api/session', () => json({ id: 's1', datetime: isoHoursAgo(2) })] as const;
const OUTSIDE_WINDOW = ['/api/session', () => json({ id: 's1', datetime: isoHoursAgo(100) })] as const;
// The card's content source. GET /api/players returns a BARE ARRAY.
const ROSTER = [
  '/api/players',
  () => json([{ name: 'Lin' }, { name: 'Viktor' }, { name: 'Akane' }]),
] as const;

function renderCard() {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <OnlineProvider>
        <GiveKudosCard />
      </OnlineProvider>
    </NextIntlClientProvider>,
  );
}

const LOAD_ERROR = enMessages.stats.kudos.error;
const SEND_ERROR = enMessages.stats.kudos.sendError;
const GIVE_TITLE = enMessages.stats.kudos.giveTitle;

describe('GiveKudosCard — a failed read is not an empty roster', () => {
  beforeEach(() => {
    localStorage.clear();
    signIn('Lin');
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('lists co-players when both reads succeed inside the window', async () => {
    mockFetchByUrl([IN_WINDOW, ROSTER]);
    renderCard();
    await waitFor(() => expect(screen.getByText('Viktor')).toBeTruthy());
    expect(screen.getByText('Akane')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('renders NOTHING outside the 48h window — the card is designed to be absent', async () => {
    mockFetchByUrl([OUTSIDE_WINDOW, ROSTER]);
    const { container } = renderCard();
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(container.textContent).toBe('');
  });

  it('renders NOTHING when the window is open but the roster is only you', async () => {
    mockFetchByUrl([IN_WINDOW, ['/api/players', () => json([{ name: 'Lin' }])]]);
    const { container } = renderCard();
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(container.textContent).toBe('');
  });

  // ── C2 ──────────────────────────────────────────────────────────────────
  it('renders the error card when the ROSTER read fails inside the window', async () => {
    mockFetchByUrl([IN_WINDOW, ['/api/players', () => json({ error: 'load_failed' }, 500)]]);
    renderCard();
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByRole('alert').textContent).toBe(LOAD_ERROR);
    expect(screen.getByText(GIVE_TITLE)).toBeTruthy();
  });

  it('renders the error card when the SESSION read fails — the window is unknown', async () => {
    mockFetchByUrl([['/api/session', () => json({ error: 'load_failed' }, 500)], ROSTER]);
    renderCard();
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByRole('alert').textContent).toBe(LOAD_ERROR);
  });

  it('does NOT raise an error card for a roster failure OUTSIDE the window', async () => {
    mockFetchByUrl([OUTSIDE_WINDOW, ['/api/players', () => json({ error: 'load_failed' }, 500)]]);
    const { container } = renderCard();
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(container.textContent).toBe('');
  });

  // ── C3 ──────────────────────────────────────────────────────────────────
  it('marks a kudos SENT on success, with no error line', async () => {
    mockFetchByUrl([IN_WINDOW, ROSTER, ['/api/kudos', () => json({ ok: true }, 201)]]);
    renderCard();
    await waitFor(() => expect(screen.getByText('Viktor')).toBeTruthy());
    fireEvent.click(screen.getAllByText(enMessages.stats.kudos.tag.clutch)[0]);
    await waitFor(() =>
      expect(
        screen.getAllByRole('button').some((b) => b.getAttribute('aria-pressed') === 'true'),
      ).toBe(true),
    );
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('says so when the send FAILS, instead of quietly re-enabling the button', async () => {
    mockFetchByUrl([IN_WINDOW, ROSTER, ['/api/kudos', () => json({ error: 'nope' }, 500)]]);
    renderCard();
    await waitFor(() => expect(screen.getByText('Viktor')).toBeTruthy());
    fireEvent.click(screen.getAllByText(enMessages.stats.kudos.tag.clutch)[0]);
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByRole('alert').textContent).toBe(SEND_ERROR);
    // And it stays retryable — nothing is marked sent.
    expect(screen.getAllByRole('button').every((b) => b.getAttribute('aria-pressed') !== 'true')).toBe(true);
  });
});

/**
 * The client/server co-play mismatch.
 *
 * `playedTogether` in app/api/kudos/route.ts is ROSTER-FIRST: if both names are
 * on the session's `players` roster (removed !== true) it returns true, and only
 * falls through to a games check if that lookup throws. So the server accepts a
 * kudos between any two people who turned up.
 *
 * The card derived its co-player list from `/api/games` alone — strictly
 * narrower than what the server allows. The Slice-0 readout on 2026-08-25
 * measured `games.loggers: 0` over six weeks with a cohort of 12, which means
 * this card rendered `null` for every member for the whole window: a live,
 * flag-on feature that nobody could reach, dark because of a DIFFERENT feature's
 * non-use rather than any failure of its own.
 */
describe('GiveKudosCard — co-players come from the roster, like the server', () => {
  beforeEach(() => {
    localStorage.clear();
    signIn('Lin');
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  const ROSTER_OK = [
    '/api/players',
    // NOTE: GET /api/players returns a BARE ARRAY, not { players: [...] }.
    // SteppedGameLoggerSheet read `d?.players` and so saw an empty roster
    // forever — the root cause of the Slice-0 `loggers: 0`.
    () => json([
      { name: 'Lin' },
      { name: 'Viktor' },
      { name: 'Akane' },
      { name: 'Gone', removed: true },
    ]),
  ] as const;

  it('offers co-players from the roster even when NO games were logged', async () => {
    mockFetchByUrl([IN_WINDOW, ROSTER_OK, ['/api/games', () => json({ games: [] })]]);
    renderCard();
    // The exact production state: zero logged games, a full roster.
    await waitFor(() => expect(screen.getByText(GIVE_TITLE)).toBeTruthy());
    expect(screen.getByText('Viktor')).toBeTruthy();
    expect(screen.getByText('Akane')).toBeTruthy();
  });

  it('never offers you yourself', async () => {
    mockFetchByUrl([IN_WINDOW, ROSTER_OK, ['/api/games', () => json({ games: [] })]]);
    renderCard();
    await waitFor(() => expect(screen.getByText(GIVE_TITLE)).toBeTruthy());
    expect(screen.queryByText('Lin')).toBeNull();
  });

  it('excludes removed players — the server filters them too', async () => {
    mockFetchByUrl([IN_WINDOW, ROSTER_OK, ['/api/games', () => json({ games: [] })]]);
    renderCard();
    await waitFor(() => expect(screen.getByText(GIVE_TITLE)).toBeTruthy());
    expect(screen.queryByText('Gone')).toBeNull();
  });

  it('still renders nothing outside the 48h window, roster or not', async () => {
    mockFetchByUrl([OUTSIDE_WINDOW, ROSTER_OK, ['/api/games', () => json({ games: [] })]]);
    const { container } = renderCard();
    await waitFor(() => expect(container.textContent).toBe(''));
  });

  it('shows the error card when the ROSTER read fails inside the window', async () => {
    // Unknown roster is not an empty roster — same rule as the session read.
    mockFetchByUrl([IN_WINDOW, ['/api/players', () => json({}, 500)], ['/api/games', () => json({ games: [] })]]);
    renderCard();
    await waitFor(() => expect(screen.getByText(LOAD_ERROR)).toBeTruthy());
  });

  it('renders nothing when the roster is genuinely just you', async () => {
    // Loaded-empty, not load-failed: no error card, no give-kudos card.
    mockFetchByUrl([
      IN_WINDOW,
      ['/api/players', () => json([{ name: 'Lin' }])],
      ['/api/games', () => json({ games: [] })],
    ]);
    const { container } = renderCard();
    await waitFor(() => expect(container.textContent).toBe(''));
  });
});
