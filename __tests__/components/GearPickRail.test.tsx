// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import GearPickRail from '../../components/stats/GearPickRail';
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
});
