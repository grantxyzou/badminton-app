// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import OverviewStrip from '../../components/stats/OverviewStrip';
import enMessages from '../../messages/en.json';
import type { UseCheckIn } from '../../components/stats/useCheckIn';
import { resetSharedReads } from '../../lib/sharedRead';

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
/** The level read with its trail (`docs/plans/one-level.md`): the caption is
 *  the step between its last two points. */
const levelWithTrail = (level: number, trail: Array<[string, number]>) =>
  ['/api/stats/level', () => jsonResponse({ level: { level, trail: trail.map(([at, l]) => ({ at, level: l })) } })] as const;
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

/**
 * The check-in history arrives as a PROP now, not as this card's own fetch.
 *
 * `useCheckIn` in `SkillsTab` is the single owner — this strip, `SkillTrendCard`
 * and the sheet were each reading `/api/assessments` separately and could
 * disagree mid-flight. The delta cases below therefore stub the owner rather
 * than the endpoint. Everything they assert is unchanged: the four reads are
 * still independent, a failed history still only degrades the CAPTION, and no
 * tile shows a confident value it has not earned.
 */
function stubCheckIn(
  snapshots: Array<{ takenAt?: string; overall?: number | null }>,
  status: 'loading' | 'ready' | 'error' = 'ready',
): UseCheckIn {
  return {
    snapshots,
    status,
    latest: snapshots[snapshots.length - 1],
    previous: undefined,
    open: false,
    openFrom: () => {},
    close: () => {},
    reload: () => {},
    onSaved: () => {},
    savedAt: 0,
  };
}

function renderStrip(name: string | null = 'Lin', checkIn?: UseCheckIn) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <OverviewStrip activeName={name} checkIn={checkIn} />
    </NextIntlClientProvider>,
  );
}

describe('OverviewStrip', () => {
  beforeEach(() => {
    localStorage.clear();
    // The shared-read dedupe is module state: one test's answer must not be
    // handed to the next (lib/sharedRead.ts).
    resetSharedReads();
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
  it('renders an up delta against the level at the previous check-in', async () => {
    mockFetchByUrl([levelWithTrail(2.9, [['2026-04-10T00:00:00.000Z', 2.5], ['2026-08-10T00:00:00.000Z', 2.9]]), OK_GAMES, OK_KUDOS]);
    renderStrip('Lin', stubCheckIn([
      { takenAt: '2026-04-10T00:00:00.000Z', overall: 2.5 },
      { takenAt: '2026-08-10T00:00:00.000Z', overall: 2.9 },
    ]));
    await waitFor(() => expect(screen.getByText(/since April/)).toBeTruthy());
    expect(screen.getByText(/▲ 0.4 since April/)).toBeTruthy();
  });

  it('the change adds up to the number shown: it is the level trail, never the raw check-in jump', async () => {
    // Lin, 2026-10-29: check-ins 2.6 → 3.4, canonical level 3.1. The tile
    // said 3.1 "▲ 0.8"; 0.8 is the raw jump and nothing on screen was 2.3.
    mockFetchByUrl([levelWithTrail(3.1, [['2026-09-24T00:00:00.000Z', 2.6], ['2026-10-24T00:00:00.000Z', 3.1]]), OK_GAMES, OK_KUDOS]);
    renderStrip('Lin', stubCheckIn([
      { takenAt: '2026-09-24T00:00:00.000Z', overall: 2.64 },
      { takenAt: '2026-10-24T00:00:00.000Z', overall: 3.43 },
    ]));
    await waitFor(() => expect(screen.getByText('3.1')).toBeTruthy());
    expect(screen.getByText(/▲ 0.5 since September/)).toBeTruthy();
    expect(screen.queryByText(/0\.8/)).toBeNull();
  });

  it('says "Your baseline" on a first snapshot rather than inventing a delta', async () => {
    mockFetchByUrl([OK_LEVEL, OK_GAMES, OK_KUDOS]);
    renderStrip('Lin', stubCheckIn([{ takenAt: '2026-08-10T00:00:00.000Z', overall: 2.9 }]));
    await waitFor(() => expect(screen.getByText('Your baseline')).toBeTruthy());
  });

  it('never renders a 0.0 delta — an imperceptible change reads as level', async () => {
    mockFetchByUrl([levelWithTrail(2.9, [['2026-04-10T00:00:00.000Z', 2.92], ['2026-08-10T00:00:00.000Z', 2.9]]), OK_GAMES, OK_KUDOS]);
    renderStrip('Lin', stubCheckIn([
      { takenAt: '2026-04-10T00:00:00.000Z', overall: 2.92 },
      { takenAt: '2026-08-10T00:00:00.000Z', overall: 2.9 },
    ]));
    await waitFor(() => expect(screen.getByText('level with April')).toBeTruthy());
    expect(screen.queryByText(/0\.0 since/)).toBeNull();
  });

  it('keeps the level number when only the trend read fails', async () => {
    mockFetchByUrl([OK_LEVEL, OK_GAMES, OK_KUDOS]);
    // A FAILED history, not an empty one — the strip must not treat the two
    // alike, and the number it already has is not in doubt either way.
    renderStrip('Lin', stubCheckIn([
      { takenAt: '2026-04-10T00:00:00.000Z', overall: 2.5 },
      { takenAt: '2026-08-10T00:00:00.000Z', overall: 2.9 },
    ], 'error'));
    await waitFor(() => expect(screen.getByText('2.9')).toBeTruthy());
    // Caption degrades, the number survives.
    expect(screen.getByText('Your baseline')).toBeTruthy();
  });

  // ── The door ────────────────────────────────────────────────────────────
  it('makes the level tile a button that opens the check-in, naming the source', async () => {
    mockFetchByUrl([OK_LEVEL, OK_GAMES, OK_KUDOS]);
    const opened: string[] = [];
    const stub = { ...stubCheckIn([]), openFrom: (src: string) => opened.push(src) } as unknown as UseCheckIn;
    renderStrip('Lin', stub);
    const tile = await screen.findByRole('button', { name: /Tap to check in again|Tap to take a check-in/ });
    tile.click();
    expect(opened).toEqual(['strip']);
  });

  it('is STILL a door when the level read fails — opening a sheet is not a mutation', async () => {
    mockFetchByUrl([
      ['/api/stats/level', () => jsonResponse({ error: 'boom' }, false)],
      OK_GAMES,
      OK_KUDOS,
    ]);
    renderStrip('Lin', stubCheckIn([]));
    // On the day the read fails this is the only way to reach the check-in.
    await screen.findByRole('button', { name: /Level couldn't load\. Tap to take a check-in\./ });
  });

  it('does not announce "no level yet" while the level is still loading', async () => {
    // The visible caption has a loading arm that renders blank; the aria chain
    // had none, so every not-yet-ready state fell through to the confident
    // negative meant for a member who genuinely has no level. This label
    // REPLACES label + value + unit + caption on the button, so there is no
    // surrounding text a screen-reader user could read around it.
    mockFetchByUrl([
      ['/api/stats/level', () => new Promise<Response>(() => {})],
      OK_GAMES,
      OK_KUDOS,
    ]);
    renderStrip('Lin', stubCheckIn([]));
    await screen.findByRole('button', { name: /Level loading\. Tap to open the check-in\./ });
    expect(screen.queryByRole('button', { name: /No level yet/ })).toBeNull();
  });

  it('renders a plain tile, not a button, with no owner supplied', async () => {
    mockFetchByUrl([OK_LEVEL, OK_GAMES, OK_KUDOS]);
    renderStrip('Lin');
    await waitFor(() => expect(screen.getByText('2.9')).toBeTruthy());
    expect(screen.queryByRole('button')).toBeNull();
  });
});
