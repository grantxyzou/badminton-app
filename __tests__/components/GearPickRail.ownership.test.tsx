// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import GearPickRail from '../../components/stats/GearPickRail';
import GearRegister from '../../components/stats/GearRegister';
import type { UseGear } from '../../components/stats/useGear';
import enMessages from '../../messages/en.json';

/**
 * `useGear` sets `loadError: true` AND `loaded: true` on a failed read, and the
 * rail gated only on `loaded`. So a member whose bag could not be read had
 * `isOwned()` answer false for every category: the IN YOUR KIT badge dropped
 * and the rail recommended back the racket already in their bag — the exact
 * bug the rail's docstring says the redesign exists to prevent.
 */
const ITEM = {
  id: 'r1',
  category: 'racket' as const,
  brand: 'Yonex',
  model: 'Astrox 99 Pro',
  skillRange: [3, 6] as [number, number],
  attributes: { weight: '4U', balance: 'head-heavy' },
};

function fakeGear(overrides: Partial<UseGear> = {}): UseGear {
  return {
    gear: null,
    rackets: [],
    active: null,
    loaded: true,
    loadError: false,
    busy: false,
    online: true,
    reload: vi.fn(),
    add: vi.fn(async () => ({ ok: true as const })),
    activate: vi.fn(async () => ({ ok: true as const })),
    remove: vi.fn(async () => ({ ok: true as const })),
    setPrefs: vi.fn(async () => ({ ok: true as const })),
    setTension: vi.fn(async () => ({ ok: true as const })),
    ...overrides,
  };
}

/** Answers /api/recommend with a real racket pick for every sourced category. */
function mockPick() {
  global.fetch = vi.fn(() =>
    Promise.resolve({ ok: true, json: () => Promise.resolve({ item: ITEM, reasons: [], warnings: [] }) }),
  ) as unknown as typeof fetch;
}

function renderRail(gear: UseGear) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <GearPickRail activeName="Lin" gear={gear} />
    </NextIntlClientProvider>,
  );
}

const IN_KIT = enMessages.stats.gear.railInKit;
const KIT_ERROR = enMessages.stats.gear.kitError;
const SHOE_SOON = enMessages.stats.gear.railShoesSoon;

describe('GearPickRail — ownership must be known before it is claimed', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('flags IN YOUR KIT when the bag read succeeded and holds the pick', async () => {
    renderRailWithBag();
    await waitFor(() => expect(screen.getAllByText(IN_KIT).length).toBeGreaterThan(0));
    expect(screen.queryByText(KIT_ERROR)).toBeNull();
  });

  it('shows the pick with NO badge when the bag read succeeded and is genuinely empty', async () => {
    mockPick();
    renderRail(fakeGear({ gear: null, loaded: true, loadError: false }));
    await waitFor(() => expect(screen.getAllByText(/Astrox 99 Pro/).length).toBeGreaterThan(0));
    expect(screen.queryByText(IN_KIT)).toBeNull();
    // A loaded-empty bag is not a failure.
    expect(screen.queryByText(KIT_ERROR)).toBeNull();
  });

  // ── B2 ──────────────────────────────────────────────────────────────────
  it('degrades a card WITH a pick to the error state when the bag read failed', async () => {
    mockPick();
    renderRail(fakeGear({ gear: null, loaded: true, loadError: true }));
    await waitFor(() => expect(screen.getAllByText(KIT_ERROR).length).toBeGreaterThan(0));
    // It must not recommend back gear it cannot confirm the member already owns.
    expect(screen.queryByText(/Astrox 99 Pro/)).toBeNull();
    expect(screen.queryByText(IN_KIT)).toBeNull();
  });

  it('leaves genuinely PARKED categories alone — they say nothing about the bag', async () => {
    mockPick();
    renderRail(fakeGear({ gear: null, loaded: true, loadError: true }));
    await waitFor(() => expect(screen.getAllByText(KIT_ERROR).length).toBeGreaterThan(0));
    // Shoe has no engine and no fetch; its "coming soon" copy is still true.
    expect(screen.getByText(SHOE_SOON)).toBeTruthy();
  });
});

/**
 * Composed check: the rail's degraded string card must not leave the tension
 * card silently absent. `GearRegister` suppresses `StringTensionCard` when the
 * string pairing produced a number (D2) — but under `gear.loadError` that
 * number is no longer on screen, so the stand-down would reintroduce exactly
 * the C1 defect (a failure rendering like "no check-in yet") one level up.
 */
describe('GearRegister — a failed gear read must not silence BOTH tension surfaces', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('shows the rail kit error AND the tension card error, never a blank gap', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        const json = (body: unknown, status = 200) =>
          Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => body } as Response);
        // The gear doc is what fails.
        if (url.includes('/api/equipment/gear')) return json({ error: 'load_failed' }, 500);
        // A string pick WITH a tension is what triggers the D2 stand-down.
        if (url.includes('category=string')) {
          return json({ item: { ...ITEM, id: 's1', category: 'string' }, reasons: [], warnings: [], tensionLbs: 25 });
        }
        if (url.includes('/api/recommend')) return json({ item: ITEM, reasons: [], warnings: [] });
        if (url.includes('/api/stats/level')) return json({ level: { level: 3 } });
        return json({});
      }) as unknown as typeof fetch,
    );

    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <GearRegister activeName="Lin" />
      </NextIntlClientProvider>,
    );

    await waitFor(() => expect(screen.getAllByText(KIT_ERROR).length).toBeGreaterThan(0));
    await waitFor(() => expect(screen.getByText(enMessages.stats.gear.tensionError)).toBeTruthy());
    // And no number was printed against an unknown play format.
    expect(screen.queryByText('24')).toBeNull();
    expect(screen.queryByText('26')).toBeNull();
  });
});

function renderRailWithBag() {
  mockPick();
  return renderRail(
    fakeGear({
      loaded: true,
      loadError: false,
      gear: {
        name: 'Lin',
        items: [{ id: 'i1', catalogId: 'r1', category: 'racket', label: 'Yonex Astrox 99 Pro' }],
      } as never,
    }),
  );
}
