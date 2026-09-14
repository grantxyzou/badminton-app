// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import GearSetupCard from '../../components/stats/GearSetupCard';
import type { UseGear } from '../../components/stats/useGear';
import type { UseGearPicks } from '../../components/stats/useGearPicks';
import type { UseClubGear } from '../../components/stats/useClubGear';
import { resetCatalogCache } from '../../components/stats/useCatalog';
import { activeRacket, rackets as racketsOf } from '../../lib/activeRacket';
import type { CatalogItem, GearItem, PlayerGear } from '../../lib/types';
import enMessages from '../../messages/en.json';

const AF79: GearItem = { id: 'r1', catalogId: 'rk-af79', category: 'racket', label: 'Li-Ning Air Force 79' };
const NF800: GearItem = { id: 'r2', catalogId: null, category: 'racket', label: 'Yonex Nanoflare 800' };
const BG65: GearItem = { id: 's1', catalogId: 'string-bg65', category: 'string', label: 'Yonex BG65' };

const CATALOG: Record<string, CatalogItem[]> = {
  racket: [{ id: 'rk-af79', category: 'racket', brand: 'Li-Ning', model: 'Air Force 79', skillRange: [1, 3], attributes: { weight: '4U', balance: 'Even' } }],
  string: [{ id: 'string-bg65', category: 'string', brand: 'Yonex', model: 'BG65', skillRange: [1, 3], attributes: { gaugeMm: 0.7, stringType: 'Durability' } }],
};

function doc(items: GearItem[], activeRacketId?: string): PlayerGear {
  return { id: 'gear-m1', memberId: 'm1', items, activeRacketId, updatedAt: '' } as PlayerGear;
}

function fakeGear(d: PlayerGear | null, overrides: Partial<UseGear> = {}): UseGear {
  return {
    gear: d,
    rackets: racketsOf(d),
    active: activeRacket(d),
    loaded: true,
    loadError: false,
    forbidden: false,
    busy: false,
    online: true,
    reload: vi.fn(),
    add: vi.fn(async () => ({ ok: true as const })),
    addCustom: vi.fn(async () => ({ ok: true as const })),
    activate: vi.fn(async () => ({ ok: true as const })),
    remove: vi.fn(async () => ({ ok: true as const })),
    setPrefs: vi.fn(async () => ({ ok: true as const })),
    setTension: vi.fn(async () => ({ ok: true as const })),
    ...overrides,
  };
}

function fakePicks(stringPick: UseGearPicks['view']['string'] = { status: 'parked', pick: null }): UseGearPicks {
  const parked = { status: 'parked' as const, pick: null };
  return {
    view: { racket: parked, string: stringPick, shoe: parked, shuttle: parked, bag: parked, grip: parked },
    refused: false,
    parkReasons: {},
    retry: vi.fn(),
    isOwned: () => false,
    railStatus: (s) => s,
    refresh: vi.fn(),
  };
}

const noClub: UseClubGear = { entries: [], status: 'ready', retry: vi.fn() };

function renderCard(gear: UseGear, opts: { picks?: UseGearPicks; club?: UseClubGear; onOpenLine?: (c: string) => void; onAddTension?: (i: GearItem) => void } = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <GearSetupCard
        activeName="Lin"
        gear={gear}
        picks={opts.picks ?? fakePicks()}
        club={opts.club ?? noClub}
        onOpenLine={opts.onOpenLine ?? vi.fn()}
        onOpenFit={vi.fn()}
        onAddTension={opts.onAddTension}
      />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  resetCatalogCache();
  global.fetch = vi.fn().mockImplementation((url: string) => {
    const cat = new URL(String(url), 'http://x').searchParams.get('category') ?? '';
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ items: CATALOG[cat] ?? [] }) });
  }) as unknown as typeof fetch;
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('GearSetupCard — the three states that are not a card', () => {
  it('loading draws a skeleton, not two blank lines', () => {
    const { container } = renderCard(fakeGear(null, { loaded: false }));
    expect(screen.queryByText('Tap to name it')).toBeNull();
    expect(container.textContent).not.toContain('Set-up');
  });

  it('a refused read locks the card and names no gear', () => {
    renderCard(fakeGear(null, { loadError: true, forbidden: true }));
    expect(screen.queryByText('Tap to name it')).toBeNull();
    expect(screen.getByText(/to see and manage your equipment/)).toBeTruthy();
  });

  it('a failed read says so with Try again, and draws NO dashed lines — an unread card is not an empty one', () => {
    const gear = fakeGear(doc([AF79]), { loadError: true });
    renderCard(gear);
    expect(screen.getByRole('alert').textContent).toContain("Couldn't load your equipment");
    expect(screen.queryByText('Tap to name it')).toBeNull();
    expect(screen.queryByText('0 of 2')).toBeNull();
    // Nor the bag it could not read.
    expect(screen.queryByText('Li-Ning Air Force 79')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(gear.reload).toHaveBeenCalled();
  });
});

describe('GearSetupCard — filling it in', () => {
  it('blank: two lines to name, 0 of 2, and the reason to fill them', () => {
    renderCard(fakeGear(doc([])));
    expect(screen.getAllByText('Tap to name it')).toHaveLength(2);
    expect(screen.getByText('0 of 2')).toBeTruthy();
    expect(screen.getByText(/Two lines is the whole card/)).toBeTruthy();
  });

  it('tapping a blank line asks to name THAT line', () => {
    const onOpenLine = vi.fn();
    renderCard(fakeGear(doc([])), { onOpenLine });
    fireEvent.click(screen.getAllByText('Tap to name it')[1]);
    expect(onOpenLine).toHaveBeenCalledWith('string');
  });

  it('one of two: the racket is in play with its spec, and the string line quotes a READY pairing', async () => {
    const pick = { status: 'ready' as const, pick: { item: { ...CATALOG.string[0], model: 'BG65 Ti' }, reasons: [], tensionLbs: 26, pairedWith: { label: 'Li-Ning Air Force 79', source: 'owned' as const } } };
    renderCard(fakeGear(doc([AF79], 'r1')), { picks: fakePicks(pick) });
    expect(screen.getByText('1 of 2')).toBeTruthy();
    expect(screen.getByText('In play')).toBeTruthy();
    expect(screen.getByText("For this frame we'd pair BG65 Ti at 26 lb")).toBeTruthy();
    expect(await screen.findByText('4U · even')).toBeTruthy();
    expect(screen.queryByText(/Two lines is the whole card/)).toBeNull();
  });

  it('a parked or errored string pick quotes nothing', () => {
    renderCard(fakeGear(doc([AF79], 'r1')), { picks: fakePicks({ status: 'error', pick: null }) });
    expect(screen.queryByText(/we'd pair/)).toBeNull();
  });

  it('the club fact appears only when the cohort-guarded tally has an entry', async () => {
    const club: UseClubGear = { entries: [{ category: 'racket', label: 'Li-Ning Air Force 79', count: 5 }], status: 'ready', retry: vi.fn() };
    renderCard(fakeGear(doc([AF79], 'r1')), { club });
    expect(await screen.findByText('4U · even · 4 others play it')).toBeTruthy();
  });

  it('an errored tally contributes no fact', async () => {
    const club: UseClubGear = { entries: [{ category: 'racket', label: 'Li-Ning Air Force 79', count: 5 }], status: 'error', retry: vi.fn() };
    renderCard(fakeGear(doc([AF79], 'r1')), { club });
    expect(await screen.findByText('4U · even')).toBeTruthy();
    expect(screen.queryByText(/others play it/)).toBeNull();
  });
});

describe('GearSetupCard — complete, with a spare', () => {
  it('no progress pill once both lines are filled; the spare has its own line', () => {
    renderCard(fakeGear(doc([AF79, NF800, { ...BG65, tensionLbs: 26 }], 'r1')));
    expect(screen.queryByText(/of 2/)).toBeNull();
    expect(screen.getByText('Spare')).toBeTruthy();
    expect(screen.getByText('Yonex Nanoflare 800')).toBeTruthy();
    expect(screen.getByText('26')).toBeTruthy();
  });

  it('Swap in activates the spare', async () => {
    const gear = fakeGear(doc([AF79, NF800], 'r1'));
    renderCard(gear);
    fireEvent.click(screen.getByRole('button', { name: /Swap in — Yonex Nanoflare 800/ }));
    await waitFor(() => expect(gear.activate).toHaveBeenCalledWith('r2'));
  });

  it('a refused swap is rendered, not swallowed', async () => {
    const gear = fakeGear(doc([AF79, NF800], 'r1'), { activate: vi.fn(async () => ({ ok: false as const, reason: 'rate_limited' as const })) });
    renderCard(gear);
    fireEvent.click(screen.getByRole('button', { name: /Swap in/ }));
    expect(await screen.findByRole('alert')).toBeTruthy();
  });

  it('a string with no tension shows an empty slot that says what it wants — never a zero', () => {
    const onAddTension = vi.fn();
    renderCard(fakeGear(doc([AF79, BG65], 'r1')), { onAddTension });
    expect(screen.queryByText('0')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Add lb' }));
    expect(onAddTension).toHaveBeenCalledWith(BG65);
  });
});
