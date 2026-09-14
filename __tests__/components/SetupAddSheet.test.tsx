// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { useState } from 'react';
import SetupAddSheet from '../../components/stats/SetupAddSheet';
import type { UseGear } from '../../components/stats/useGear';
import type { UseGearPicks } from '../../components/stats/useGearPicks';
import { resetCatalogCache } from '../../components/stats/useCatalog';
import { activeRacket, rackets as racketsOf } from '../../lib/activeRacket';
import type { CatalogItem, GearItem, PlayerGear } from '../../lib/types';
import enMessages from '../../messages/en.json';

const AF79: CatalogItem = { id: 'rk-af79', category: 'racket', brand: 'Li-Ning', model: 'Air Force 79', skillRange: [1, 3], msrp: 129, attributes: { weight: '4U', balance: 'Even', flex: 'Medium' } };
const NF800: CatalogItem = { id: 'rk-nf800', category: 'racket', brand: 'Yonex', model: 'Nanoflare 800', skillRange: [1, 3], attributes: { weight: '4U', balance: 'Head-light' } };
const BG65: CatalogItem = { id: 'st-bg65', category: 'string', brand: 'Yonex', model: 'BG65 Ti', skillRange: [1, 3], attributes: { gaugeMm: 0.7, stringType: 'Durability' } };
const AERO: CatalogItem = { id: 'st-ab', category: 'string', brand: 'Yonex', model: 'Aerobite', skillRange: [1, 3], attributes: { gaugeMm: 0.67, stringType: 'Control' } };
const CATALOG: Record<string, CatalogItem[]> = { racket: [AF79, NF800], string: [BG65, AERO] };

function doc(items: GearItem[], activeRacketId?: string): PlayerGear {
  return { id: 'gear-m1', memberId: 'm1', items, activeRacketId, updatedAt: '' } as PlayerGear;
}

/** A `UseGear` whose `add` really appends, so the saved panel can find its row. */
function useFakeGear(initial: PlayerGear, spies: Partial<UseGear> = {}): UseGear {
  const [d, setD] = useState(initial);
  return {
    gear: d,
    rackets: racketsOf(d),
    active: activeRacket(d),
    loaded: true, loadError: false, forbidden: false, busy: false, online: true,
    reload: vi.fn(),
    add: async (item, extra) => {
      if (spies.add && (await spies.add(item, extra)).ok === false) return { ok: false, reason: 'bag_full' };
      const gi: GearItem = { id: `new-${item.id}`, catalogId: item.id, category: item.category, label: `${item.brand} ${item.model}` };
      setD((p) => ({ ...p, items: [...p.items, gi], activeRacketId: extra?.makeActive ? gi.id : p.activeRacketId ?? (item.category === 'racket' ? gi.id : undefined) }));
      return { ok: true };
    },
    addCustom: vi.fn(async () => ({ ok: true as const })),
    activate: spies.activate ?? vi.fn(async () => ({ ok: true as const })),
    remove: spies.remove ?? vi.fn(async () => ({ ok: true as const })),
    setPrefs: vi.fn(async () => ({ ok: true as const })),
    setTension: spies.setTension ?? vi.fn(async () => ({ ok: true as const })),
  };
}

function picksWith(view: Partial<UseGearPicks['view']>): UseGearPicks {
  const parked = { status: 'parked' as const, pick: null };
  return {
    view: { racket: parked, string: parked, shoe: parked, shuttle: parked, bag: parked, grip: parked, ...view },
    refused: false, parkReasons: {}, retry: vi.fn(), isOwned: () => false, railStatus: (s) => s, refresh: vi.fn(),
  };
}

function Harness({ category, initial, picks, spies = {}, onClose = vi.fn(), makeActive = true, replacesId }: {
  category: 'racket' | 'string'; initial: PlayerGear; picks: UseGearPicks; spies?: Partial<UseGear>; onClose?: () => void; makeActive?: boolean; replacesId?: string;
}) {
  const gear = useFakeGear(initial, spies);
  return (
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <SetupAddSheet open onClose={onClose} category={category} gear={gear} picks={picks} makeActive={makeActive} replacesId={replacesId} />
    </NextIntlClientProvider>
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

describe('SetupAddSheet — the suggestion asks before it saves', () => {
  const racketPick = { status: 'ready' as const, pick: { item: AF79, reasons: [] } };

  it('tapping the suggestion adds NOTHING until "Yes, add it"', async () => {
    const add = vi.fn(async () => ({ ok: true as const }));
    render(<Harness category="racket" initial={doc([])} picks={picksWith({ racket: racketPick })} spies={{ add }} />);
    fireEvent.click(await screen.findByText('Li-Ning · 4U · even · ~$129'));
    expect(screen.getByText('Is this the one you play?')).toBeTruthy();
    expect(add).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Yes, add it' }));
    await waitFor(() => expect(add).toHaveBeenCalledWith(AF79, { makeActive: true }));
  });

  it('"Not mine" dismisses the suggestion and writes nothing', async () => {
    const add = vi.fn(async () => ({ ok: true as const }));
    render(<Harness category="racket" initial={doc([])} picks={picksWith({ racket: racketPick })} spies={{ add }} />);
    fireEvent.click(await screen.findByText('Li-Ning · 4U · even · ~$129'));
    fireEvent.click(screen.getByRole('button', { name: 'Not mine' }));
    expect(screen.queryByText('From your check-in')).toBeNull();
    expect(add).not.toHaveBeenCalled();
  });

  it('a filled racket line is not offered a suggestion — "is this yours?" about a step up asks the wrong thing', async () => {
    const owned: GearItem = { id: 'r1', catalogId: 'rk-nf800', category: 'racket', label: 'Yonex Nanoflare 800' };
    render(<Harness category="racket" initial={doc([owned], 'r1')} picks={picksWith({ racket: racketPick })} makeActive={false} />);
    await screen.findByText('Air Force 79');
    expect(screen.queryByText('From your check-in')).toBeNull();
  });
});

describe('SetupAddSheet — a tap saves, and the row expands with the one follow-up', () => {
  it('a string: "Don\'t know" closes without writing a tension', async () => {
    const setTension = vi.fn(async () => ({ ok: true as const }));
    const onClose = vi.fn();
    render(<Harness category="string" initial={doc([])} picks={picksWith({})} spies={{ setTension }} onClose={onClose} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Yonex BG65 Ti' }));
    expect(await screen.findByText('Saved')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: "Don't know" }));
    expect(onClose).toHaveBeenCalled();
    expect(setTension).not.toHaveBeenCalled();
  });

  it('a string: an untouched suggestion is not a tension; a chosen one is written once, on Done', async () => {
    const setTension = vi.fn(async () => ({ ok: true as const }));
    const onClose = vi.fn();
    const stringPick = { status: 'ready' as const, pick: { item: BG65, reasons: [], tensionLbs: 26 } };
    render(<Harness category="string" initial={doc([])} picks={picksWith({ string: stringPick })} spies={{ setTension }} onClose={onClose} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Yonex BG65 Ti' }));
    await screen.findByText('Saved');
    // The pairing's 26 is shown as a starting point only.
    expect(screen.getByText('26').className).toContain('suggested');
    fireEvent.click(screen.getByRole('button', { name: 'Raise tension' }));
    fireEvent.click(screen.getByRole('button', { name: 'Raise tension' }));
    expect(setTension).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(setTension).toHaveBeenCalledTimes(1));
    expect((setTension.mock.calls[0] as unknown[])[1]).toBe(28);
    expect(onClose).toHaveBeenCalled();
  });

  it("a string: the pairing's tension is not a starting point for a DIFFERENT string", async () => {
    const other = { ...BG65, id: 'st-bg85', model: 'BG85' };
    const stringPick = { status: 'ready' as const, pick: { item: other, reasons: [], tensionLbs: 23 } };
    render(<Harness category="string" initial={doc([])} picks={picksWith({ string: stringPick })} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Yonex BG65 Ti' }));
    await screen.findByText('Saved');
    expect(screen.queryByText('23')).toBeNull();
    expect(screen.getByText('–')).toBeTruthy();
  });

  it('a racket added as a spare can be made the one in play from its saved row', async () => {
    const owned: GearItem = { id: 'r1', catalogId: 'rk-nf800', category: 'racket', label: 'Yonex Nanoflare 800' };
    const activate = vi.fn(async () => ({ ok: true as const }));
    render(<Harness category="racket" initial={doc([owned], 'r1')} picks={picksWith({})} spies={{ activate }} makeActive={false} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Li-Ning Air Force 79' }));
    const sw = await screen.findByRole('switch', { name: 'This is the one I play' });
    expect(sw.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(sw);
    await waitFor(() => expect(activate).toHaveBeenCalledWith('new-rk-af79'));
  });

  it('owned rows stay in place and cannot be tapped', async () => {
    const owned: GearItem = { id: 'r1', catalogId: 'rk-nf800', category: 'racket', label: 'Yonex Nanoflare 800' };
    render(<Harness category="racket" initial={doc([owned], 'r1')} picks={picksWith({})} makeActive={false} />);
    expect(await screen.findByText('Nanoflare 800')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Yonex Nanoflare 800' })).toBeNull();
  });
});

describe('SetupAddSheet — "Change the string" replaces', () => {
  const OLD: GearItem = { id: 's-old', catalogId: 'st-bg65', category: 'string', label: 'Yonex BG65 Ti', tensionLbs: 24 };

  it('adds the new string, then removes the one it replaces — once, even if another is added after', async () => {
    const order: string[] = [];
    const add = vi.fn(async (item: CatalogItem) => { order.push(`add:${item.id}`); return { ok: true as const }; });
    const remove = vi.fn(async (id: string) => { order.push(`remove:${id}`); return { ok: true as const }; });
    render(<Harness category="string" initial={doc([OLD])} picks={picksWith({})} spies={{ add, remove }} replacesId="s-old" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Yonex Aerobite' }));
    await waitFor(() => expect(remove).toHaveBeenCalledWith('s-old'));
    expect(order).toEqual(['add:st-ab', 'remove:s-old']);
    fireEvent.click(screen.getByRole('button', { name: 'Add another string' }));
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('a failed add keeps the string the member has', async () => {
    const add = vi.fn(async () => ({ ok: false as const, reason: 'bag_full' as const }));
    const remove = vi.fn(async () => ({ ok: true as const }));
    render(<Harness category="string" initial={doc([OLD])} picks={picksWith({})} spies={{ add, remove }} replacesId="s-old" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Yonex Aerobite' }));
    await waitFor(() => expect(add).toHaveBeenCalled());
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(remove).not.toHaveBeenCalled();
  });

  it('without replacesId a string is only added', async () => {
    const remove = vi.fn(async () => ({ ok: true as const }));
    render(<Harness category="string" initial={doc([])} picks={picksWith({})} spies={{ remove }} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Yonex Aerobite' }));
    expect(await screen.findByText('Saved')).toBeTruthy();
    expect(remove).not.toHaveBeenCalled();
  });
});
