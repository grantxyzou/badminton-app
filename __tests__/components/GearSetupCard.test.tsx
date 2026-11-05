// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import { racketHeadSrc } from '../../lib/racketLook';
import { NextIntlClientProvider } from 'next-intl';
import GearSetupCard from '../../components/stats/GearSetupCard';
import type { UseGear } from '../../components/stats/useGear';
import type { UseGearPicks } from '../../components/stats/useGearPicks';
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
    setFeel: vi.fn(async () => ({ ok: true as const })),
    setLook: vi.fn(async () => ({ ok: true as const })),
    setCrosses: vi.fn(async () => ({ ok: true as const })),
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

function renderCard(gear: UseGear, opts: { picks?: UseGearPicks; onOpenFit?: () => void; onOpenLine?: (c: string) => void; onAddTension?: (i: GearItem) => void; onShare?: () => void; onAddSpare?: () => void; onOpenSpare?: (id: string) => void } = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <GearSetupCard
        activeName="Lin"
        gear={gear}
        picks={opts.picks ?? fakePicks()}
        onOpenLine={opts.onOpenLine ?? vi.fn()}
        onOpenFit={opts.onOpenFit ?? vi.fn()}
        onShare={opts.onShare}
        onAddTension={opts.onAddTension}
        onAddSpare={opts.onAddSpare}
        onOpenSpare={opts.onOpenSpare}
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
    expect(container.textContent).not.toContain('Main racket');
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

  it('one of two: the main racket names itself in its sub-line, and the string line quotes a READY pairing', async () => {
    const pick = { status: 'ready' as const, pick: { item: { ...CATALOG.string[0], model: 'BG65 Ti' }, reasons: [], tensionLbs: 26, pairedWith: { label: 'Li-Ning Air Force 79', source: 'owned' as const } } };
    renderCard(fakeGear(doc([AF79], 'r1')), { picks: fakePicks(pick) });
    expect(screen.getByText('1 of 2')).toBeTruthy();
    // No label row above each line (Grant, 2026-11-05: "vertical cluttered"):
    // the role leads the sub-line, and no In-play pill (2026-10-19).
    expect(await screen.findByText('Main racket · 4U · even')).toBeTruthy();
    expect(screen.queryByText('In play')).toBeNull();
    expect(screen.getByText("For this frame we'd pair BG65 Ti at 26 lb")).toBeTruthy();
    expect(screen.queryByText(/Two lines is the whole card/)).toBeNull();
  });

  it('a parked or errored string pick quotes nothing', () => {
    renderCard(fakeGear(doc([AF79], 'r1')), { picks: fakePicks({ status: 'error', pick: null }) });
    expect(screen.queryByText(/we'd pair/)).toBeNull();
  });

  it('the string names itself too, under its packet', async () => {
    const { container } = renderCard(fakeGear(doc([AF79, { ...BG65, tensionLbs: 26 }], 'r1')));
    expect(await screen.findByText('Strings · 0.70mm · durable')).toBeTruthy();
    // The card counts no one: "What the club plays" carries that.
    expect(container.textContent).not.toMatch(/others play|in this group use/);
  });

  it('the fitting door is in the main area, and stays there when the read fails', () => {
    const onOpenFit = vi.fn();
    const { container } = renderCard(fakeGear(doc([AF79], 'r1'), { loadError: true }), { onOpenFit });
    const main = container.querySelector('.setup-main') as HTMLElement;
    fireEvent.click(within(main).getByRole('button', { name: /Racket and tension fitting/ }));
    expect(onOpenFit).toHaveBeenCalled();
  });
});

describe('GearSetupCard — complete, with a spare', () => {
  it('no progress pill once both lines are filled; the spare has its own row', () => {
    renderCard(fakeGear(doc([AF79, NF800, { ...BG65, tensionLbs: 26 }], 'r1')));
    expect(screen.queryByText(/of 2/)).toBeNull();
    expect(screen.getByText('Spare rackets')).toBeTruthy();
    expect(screen.getByText('Yonex Nanoflare 800')).toBeTruthy();
    expect(screen.getByText('26')).toBeTruthy();
  });

  // Grant, 2026-11-05: "Racket and String should be next to each other then a
  // divider below show spare rackets. Clicking on the spare would bring up
  // their sheet."
  it('a spare sits below the racket and its string, and tapping it opens ITS sheet', () => {
    const onOpenSpare = vi.fn();
    const { container } = renderCard(fakeGear(doc([AF79, NF800, BG65], 'r1')), { onOpenSpare });
    const lines = container.querySelector('.setup-main')!;
    expect(lines.textContent).toContain('Yonex BG65');
    expect(lines.textContent).not.toContain('Yonex Nanoflare 800');
    fireEvent.click(within(container.querySelector('.setup-spares') as HTMLElement).getByRole('button', { name: /Yonex Nanoflare 800/ }));
    expect(onOpenSpare).toHaveBeenCalledWith('r2');
  });

  // Grant, 2026-11-05: "Dont need the string for spare" — its sheet has it.
  it('a spare row is its name only, and the Strings line keeps the main racket\'s string', () => {
    const onSpare: GearItem = { id: 's2', catalogId: null, category: 'string', label: 'Yonex BG80', tensionLbs: 28, racketId: 'r2' };
    renderCard(fakeGear(doc([AF79, NF800, { ...BG65, racketId: 'r1', tensionLbs: 24 }, onSpare], 'r1')));
    expect(screen.queryByText(/Yonex BG80/)).toBeNull();
    expect(screen.getByText('24')).toBeTruthy();
    expect(screen.queryByText('28')).toBeNull();
  });

  it('only the main racket is drawn on the card', () => {
    const { container } = renderCard(fakeGear(doc([AF79, NF800], 'r1')));
    const pics = container.querySelectorAll('.setup-corner img');
    expect(pics).toHaveLength(1);
    // Its own large render of the head, never the list picture scaled up.
    expect(pics[0].getAttribute('src')).toBe(racketHeadSrc('rk-af79'));
  });

  it('a string with no tension shows an empty slot that says what it wants — never a zero', () => {
    const onAddTension = vi.fn();
    renderCard(fakeGear(doc([AF79, BG65], 'r1')), { onAddTension });
    expect(screen.queryByText('0')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '+ String tension' }));
    expect(onAddTension).toHaveBeenCalledWith(BG65);
  });
});

describe('GearSetupCard — adding a spare is a row in the spares group', () => {
  // Grant, 2026-11-05: "a little disjointed" when it sat alone in a footer.
  it('under a main racket, "Add a spare racket" is the spares group\'s last row and opens the add sheet', () => {
    const onAddSpare = vi.fn();
    const { container } = renderCard(fakeGear(doc([AF79, NF800], 'r1')), { onAddSpare });
    const rows = within(container.querySelector('.setup-spares') as HTMLElement).getAllByRole('button').map((b) => b.textContent);
    expect(rows[0]).toContain('Yonex Nanoflare 800');
    expect(rows[rows.length - 1]).toContain('Add a spare racket');
    fireEvent.click(screen.getByRole('button', { name: /Add a spare racket/ }));
    expect(onAddSpare).toHaveBeenCalled();
  });

  it('not before there is a racket to be a spare to', () => {
    renderCard(fakeGear(doc([])), { onAddSpare: vi.fn() });
    expect(screen.queryByRole('button', { name: /Add a spare racket/ })).toBeNull();
  });

});

describe('GearSetupCard — Share appears with the complete card', () => {
  it('not while a line is blank', () => {
    renderCard(fakeGear(doc([AF79], 'r1')), { onShare: vi.fn() });
    expect(screen.queryByRole('button', { name: /Share/ })).toBeNull();
  });

  it('in place of the progress pill once both lines are filled', () => {
    const onShare = vi.fn();
    renderCard(fakeGear(doc([AF79, BG65], 'r1')), { onShare });
    fireEvent.click(screen.getByRole('button', { name: /Share/ }));
    expect(onShare).toHaveBeenCalled();
  });
});

describe('GearSetupCard — a hybrid is still one Strings line', () => {
  it('stacks mains over crosses, each with its own figure, and the line opens the string sheet', async () => {
    const onOpenLine = vi.fn();
    const hybrid: GearItem = { ...BG65, tensionLbs: 26, crosses: { catalogId: null, label: 'Yonex BG80', tensionLbs: 28 } };
    renderCard(fakeGear(doc([AF79, hybrid], 'r1')), { onOpenLine, onAddTension: vi.fn() });
    expect(await screen.findByText(/^Mains · /)).toBeTruthy();
    expect(screen.getByText('Crosses')).toBeTruthy();
    expect(screen.getByText('Yonex BG80')).toBeTruthy();
    expect(screen.getByText('26')).toBeTruthy();
    expect(screen.getByText('28')).toBeTruthy();
    fireEvent.click(screen.getByText('Yonex BG80'));
    expect(onOpenLine).toHaveBeenCalledWith('string');
    // Crosses are part of the Strings line, not a third line.
    expect(screen.queryByText('3 of 2')).toBeNull();
  });

  it('one string throughout names no roles', async () => {
    renderCard(fakeGear(doc([AF79, { ...BG65, tensionLbs: 26 }], 'r1')));
    expect(await screen.findByText('26')).toBeTruthy();
    expect(screen.queryByText(/Mains/)).toBeNull();
    expect(screen.queryByText(/Crosses/)).toBeNull();
  });
});
