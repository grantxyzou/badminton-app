// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import GearPickRail from '../../components/stats/GearPickRail';
import GearPickSheet from '../../components/stats/GearPickSheet';
import type { UseGear } from '../../components/stats/useGear';
import enMessages from '../../messages/en.json';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

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
    ...overrides,
  };
}

function renderRail(gear: UseGear = fakeGear()) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <GearPickRail activeName="Lin" gear={gear} />
    </NextIntlClientProvider>,
  );
}

/** Answers every /api/recommend call with one body. */
function mockRecommend(body: unknown) {
  global.fetch = vi.fn(() =>
    Promise.resolve({ ok: true, json: () => Promise.resolve(body) }),
  ) as unknown as typeof fetch;
}

describe('GearPickRail — a throttled response is not a product state', () => {
  // /api/recommend's rate-limit branch returns a bare {item: null, reason: null}
  // with a 200 and NO `unavailable` field. Rendering that as the parked
  // "Coming soon" card would tell a throttled member that a live category is
  // unbuilt. Unknown must render as unknown.
  it('renders the error state for a 200 with neither item nor unavailable', async () => {
    mockRecommend({ item: null, reason: null });
    renderRail();
    const alerts = await screen.findAllByRole('alert');
    expect(alerts.length).toBeGreaterThan(0);
    expect(screen.queryByText('Why this?')).toBeNull();
  });

  it('still renders the parked card for needsCheckIn — that is an honest empty', async () => {
    mockRecommend({ item: null, reason: null, needsCheckIn: true });
    renderRail();
    expect(await screen.findAllByText('Coming soon')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('renders the parked card for an unavailable category', async () => {
    mockRecommend({ item: null, reason: null, unavailable: 'no_engine' });
    renderRail();
    expect(await screen.findAllByText('Coming soon')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('GearPickRail — the card opens the detail sheet', () => {
  it('tapping a ready card opens GearPickSheet with its reasons and the add action', async () => {
    mockRecommend({
      item: ITEM,
      reason: 'Suits your smash.',
      reasons: ['Suits your smash.', 'Four people at the club play it.'],
      warnings: ['Heavier than most 4U frames.'],
    });
    renderRail();

    const card = await screen.findByLabelText('Racket — Why this?');
    fireEvent.click(card);

    expect(await screen.findByText('Add to my kit')).toBeTruthy();
    // The headline reason reads as plain language; the rest sit under WHY THIS.
    expect(screen.getByText('Four people at the club play it.')).toBeTruthy();
    // A warning is never collapsed away.
    expect(screen.getByText('Heavier than most 4U frames.')).toBeTruthy();
  });

  it('adding goes through the shared gear owner, not a fetch of its own', async () => {
    mockRecommend({ item: ITEM, reason: null, reasons: ['Suits your smash.'] });
    const gear = fakeGear();
    renderRail(gear);

    fireEvent.click(await screen.findByLabelText('Racket — Why this?'));
    fireEvent.click(await screen.findByText('Add to my kit'));

    expect(gear.add).toHaveBeenCalledWith(expect.objectContaining({ id: 'r1' }));
  });

  // RacketRecCard's disclosure tap was the ONLY writer of the Value-Hub
  // Slice-0 kill-criterion, and deleting it without replacing the beacon would
  // flatline the metric — which the append-only `events` container cannot
  // distinguish afterwards from real disengagement.
  it('records the Slice-0 engagement beacon when a card opens', async () => {
    mockRecommend({ item: ITEM, reason: null, reasons: [] });
    renderRail();

    fireEvent.click(await screen.findByLabelText('Racket — Why this?'));

    await waitFor(() => {
      const posted = (global.fetch as ReturnType<typeof vi.fn>).mock.calls
        .map((c) => String(c[0]))
        .filter((u) => u.includes('/api/events'));
      expect(posted.length).toBe(1);
    });
  });

  it('asks /api/recommend once per sourced category, not once per rail slot', async () => {
    mockRecommend({ item: ITEM, reason: null, reasons: [] });
    renderRail();

    await screen.findByLabelText('Racket — Why this?');
    const asked = (global.fetch as ReturnType<typeof vi.fn>).mock.calls
      .map((c) => String(c[0]))
      .filter((u) => u.includes('/api/recommend'));
    expect(asked.length).toBe(2);
  });
});

describe('GearPickSheet — a pick that went away is an error, not a vanishing sheet', () => {
  // The controls inside the sheet change the gear doc, which refetches the
  // pick. If that comes back empty (a throttled response is the easy way in),
  // unmounting the sheet would drop the member mid-interaction with no
  // explanation. It stays and says so instead.
  it('renders an error state when open with no resolved pick', () => {
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <GearPickSheet open onClose={vi.fn()} category="racket" pick={null} owned={false} gear={fakeGear()} />
      </NextIntlClientProvider>,
    );
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.queryByText('Add to my kit')).toBeNull();
  });
});
