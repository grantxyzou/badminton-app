// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import OverviewStrip from '../../components/stats/OverviewStrip';
import enMessages from '../../messages/en.json';

function jsonResponse(body: unknown, ok = true) {
  return Promise.resolve({ ok, status: ok ? 200 : 500, json: async () => body } as Response);
}

/** Dispatches by URL substring so each of the four reads can be made to
 *  succeed or fail independently — which is the whole point of this card. */
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

const OK_LEVEL = ['/api/stats/level', () => jsonResponse({ level: { level: 2.9 } })] as const;
const OK_TREND = [
  '/api/assessments',
  () =>
    jsonResponse({
      assessments: [
        { takenAt: '2026-04-10T00:00:00.000Z', overall: 2.5 },
        { takenAt: '2026-08-10T00:00:00.000Z', overall: 2.9 },
      ],
    }),
] as const;
const OK_GAMES = ['/api/games', () => jsonResponse({ games: [{ id: 'g1' }, { id: 'g2' }, { id: 'g3' }] })] as const;
const OK_KUDOS = [
  '/api/kudos',
  () => jsonResponse({ kudos: [{ tag: 'clutch', count: 3 }, { tag: 'nice_shot', count: 2 }] }),
] as const;

function renderStrip(name: string | null = 'Lin') {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <OverviewStrip activeName={name} />
    </NextIntlClientProvider>,
  );
}

describe('OverviewStrip', () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('renders all three tiles when every read succeeds', async () => {
    mockFetchByUrl([OK_LEVEL, OK_TREND, OK_GAMES, OK_KUDOS]);
    renderStrip();
    await waitFor(() => expect(screen.getByText('2.9')).toBeTruthy());
    expect(screen.getByText('3')).toBeTruthy(); // games
    expect(screen.getByText('5')).toBeTruthy(); // kudos 3 + 2
  });

  it('renders nothing without an active name', () => {
    mockFetchByUrl([OK_LEVEL, OK_TREND, OK_GAMES, OK_KUDOS]);
    const { container } = renderStrip(null);
    expect(container.textContent).toBe('');
  });

  // ── The independence contract ───────────────────────────────────────────
  it('a failed kudos read does not blank the level or games tiles', async () => {
    mockFetchByUrl([
      OK_LEVEL,
      OK_TREND,
      OK_GAMES,
      ['/api/kudos', () => jsonResponse({ error: 'load_failed' }, false)],
    ]);
    renderStrip();
    await waitFor(() => expect(screen.getByText("Couldn't load")).toBeTruthy());
    // The other two still hold their values.
    expect(screen.getByText('2.9')).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy();
  });

  it('a failed level read does not blank games or kudos', async () => {
    mockFetchByUrl([
      ['/api/stats/level', () => jsonResponse({ error: 'load_failed' }, false)],
      OK_TREND,
      OK_GAMES,
      OK_KUDOS,
    ]);
    renderStrip();
    await waitFor(() => expect(screen.getByText("Couldn't load")).toBeTruthy());
    expect(screen.getByText('3')).toBeTruthy();
    expect(screen.getByText('5')).toBeTruthy();
  });

  // ── No lying zeros ──────────────────────────────────────────────────────
  it('shows an em dash, never 0.0, when there is no check-in yet', async () => {
    mockFetchByUrl([
      ['/api/stats/level', () => jsonResponse({ level: { level: null } })],
      ['/api/assessments', () => jsonResponse({ assessments: [] })],
      OK_GAMES,
      OK_KUDOS,
    ]);
    renderStrip();
    await waitFor(() => expect(screen.getByText('Take a check-in')).toBeTruthy());
    expect(screen.queryByText('0.0')).toBeNull();
  });

  it('shows an em dash, never 0, for a failed count', async () => {
    mockFetchByUrl([
      OK_LEVEL,
      OK_TREND,
      ['/api/games', () => jsonResponse({ error: 'load_failed' }, false)],
      OK_KUDOS,
    ]);
    renderStrip();
    await waitFor(() => expect(screen.getByText("Couldn't load")).toBeTruthy());
    expect(screen.queryByText('0')).toBeNull();
  });

  it('shows a genuine zero as 0 with its normal caption', async () => {
    mockFetchByUrl([
      OK_LEVEL,
      OK_TREND,
      ['/api/games', () => jsonResponse({ games: [] })],
      ['/api/kudos', () => jsonResponse({ kudos: [] })],
    ]);
    renderStrip();
    await waitFor(() => expect(screen.getAllByText('0').length).toBe(2));
    expect(screen.getByText('logged')).toBeTruthy();
    expect(screen.getByText('from partners')).toBeTruthy();
    expect(screen.queryByText("Couldn't load")).toBeNull();
  });

  // ── Delta captions ──────────────────────────────────────────────────────
  it('renders an up delta against the previous snapshot', async () => {
    mockFetchByUrl([OK_LEVEL, OK_TREND, OK_GAMES, OK_KUDOS]);
    renderStrip();
    await waitFor(() => expect(screen.getByText(/since April/)).toBeTruthy());
    expect(screen.getByText(/▲ 0.4 since April/)).toBeTruthy();
  });

  it('says "Your baseline" on a first snapshot rather than inventing a delta', async () => {
    mockFetchByUrl([
      OK_LEVEL,
      ['/api/assessments', () => jsonResponse({ assessments: [{ takenAt: '2026-08-10T00:00:00.000Z', overall: 2.9 }] })],
      OK_GAMES,
      OK_KUDOS,
    ]);
    renderStrip();
    await waitFor(() => expect(screen.getByText('Your baseline')).toBeTruthy());
  });

  it('never renders a 0.0 delta — an imperceptible change reads as level', async () => {
    mockFetchByUrl([
      OK_LEVEL,
      [
        '/api/assessments',
        () =>
          jsonResponse({
            assessments: [
              { takenAt: '2026-04-10T00:00:00.000Z', overall: 2.92 },
              { takenAt: '2026-08-10T00:00:00.000Z', overall: 2.9 },
            ],
          }),
      ],
      OK_GAMES,
      OK_KUDOS,
    ]);
    renderStrip();
    await waitFor(() => expect(screen.getByText('level with April')).toBeTruthy());
    expect(screen.queryByText(/0\.0 since/)).toBeNull();
  });

  it('keeps the level number when only the trend read fails', async () => {
    mockFetchByUrl([
      OK_LEVEL,
      ['/api/assessments', () => jsonResponse({ error: 'load_failed' }, false)],
      OK_GAMES,
      OK_KUDOS,
    ]);
    renderStrip();
    await waitFor(() => expect(screen.getByText('2.9')).toBeTruthy());
    // Caption degrades, the number survives.
    expect(screen.getByText('Your baseline')).toBeTruthy();
  });
});
