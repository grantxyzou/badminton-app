// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, cleanup, waitFor, act, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import GearRegister from '../../components/stats/GearRegister';
import { resetCatalogCache } from '../../components/stats/useCatalog';
import enMessages from '../../messages/en.json';

/**
 * NEXT_PUBLIC_FLAG_GEAR_SETUP on: the register is the Set-up card, and every
 * reader still has exactly one instance. The card, the tension card and the
 * club card all show facts about the same bag and the same tally — a second
 * reader of either is two chances to disagree on one screen.
 */
function calls(match: (u: string) => boolean): string[] {
  return (global.fetch as ReturnType<typeof vi.fn>).mock.calls.map((c) => String(c[0])).filter(match);
}

function mount() {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <GearRegister activeName="Lin" />
    </NextIntlClientProvider>,
  );
}

describe('GearRegister — flag on: the Set-up card', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_FLAG_GEAR_SETUP = 'true';
    resetCatalogCache();
    global.fetch = vi.fn().mockImplementation(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ gear: null, items: [], entries: [], item: null, needsCheckIn: true }) }),
    ) as unknown as typeof fetch;
  });
  afterEach(() => {
    delete process.env.NEXT_PUBLIC_FLAG_GEAR_SETUP;
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders the card, and no rail or kit list', async () => {
    mount();
    expect(await screen.findByText('Set-up')).toBeTruthy();
    expect(screen.queryByText('Your equipment')).toBeNull();
  });

  it('one gear read, one tally read, one recommend read per sourced category', async () => {
    mount();
    await screen.findByText('Set-up');
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    await waitFor(() => expect(calls((u) => u.includes('/api/recommend')).length).toBe(2));
    expect(calls((u) => u.includes('/api/equipment/gear')).length).toBe(1);
    expect(calls((u) => u.includes('/api/stats/club/gear')).length).toBe(1);
  });
});

describe('GearRegister — flag off: unchanged', () => {
  beforeEach(() => {
    delete process.env.NEXT_PUBLIC_FLAG_GEAR_SETUP;
    global.fetch = vi.fn().mockImplementation(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ gear: null, items: [], entries: [] }) }),
    ) as unknown as typeof fetch;
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it('renders the kit card and not the Set-up card', async () => {
    mount();
    expect(await screen.findByText('Your equipment')).toBeTruthy();
    expect(screen.queryByText('Set-up')).toBeNull();
  });
});

describe('GearRegister — flag on: one door per line', () => {
  /**
   * The routing table: a blank line NAMES itself (the add sheet, as the one in
   * play), a filled line is MANAGED (its own sheet), and the dashed "Add lb"
   * slot belongs to a FILLED string — so it opens the line sheet, never the
   * catalog. Each sheet is tested alone; this is the decision between them.
   */
  function mountWithBag(items: unknown[]) {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      const u = String(url);
      const body = u.includes('/api/equipment/gear')
        ? { gear: { id: 'gear-m1', memberId: 'm1', items, activeRacketId: 'r1', updatedAt: '' } }
        : u.includes('/api/equipment/catalog') ? { items: [] }
        : u.includes('/api/recommend') ? { item: null, needsCheckIn: true }
        : { entries: [] };
      return Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
    }) as unknown as typeof fetch;
    return mount();
  }

  beforeEach(() => {
    process.env.NEXT_PUBLIC_FLAG_GEAR_SETUP = 'true';
    resetCatalogCache();
  });
  afterEach(() => {
    delete process.env.NEXT_PUBLIC_FLAG_GEAR_SETUP;
    cleanup();
    vi.restoreAllMocks();
  });

  it('a blank racket line opens "Add a racket"', async () => {
    mountWithBag([]);
    const blanks = await screen.findAllByText('Tap to name it');
    act(() => { blanks[0].click(); });
    expect(await screen.findByText('Add a racket')).toBeTruthy();
  });

  it('a filled racket line opens its own sheet, not the catalog', async () => {
    mountWithBag([{ id: 'r1', catalogId: null, category: 'racket', label: 'Li-Ning Air Force 79' }]);
    const line = await screen.findByText('Li-Ning Air Force 79');
    act(() => { line.click(); });
    expect(await screen.findByText('The one you play')).toBeTruthy();
    expect(screen.queryByText('Add a racket')).toBeNull();
  });

  it('"Add lb" on a string with no tension opens the string\'s line sheet', async () => {
    mountWithBag([
      { id: 'r1', catalogId: null, category: 'racket', label: 'Li-Ning Air Force 79' },
      { id: 's1', catalogId: null, category: 'string', label: 'Yonex BG65' },
    ]);
    const chip = await screen.findByRole('button', { name: 'Add lb' });
    act(() => { chip.click(); });
    expect(await screen.findByText('Tension')).toBeTruthy();
    expect(screen.queryByText('Add strings')).toBeNull();
  });
});

describe('GearRegister — flag on: swapping rackets', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_FLAG_GEAR_SETUP = 'true';
    resetCatalogCache();
    let active = 'r1';
    const items = [
      { id: 'r1', catalogId: null, category: 'racket', label: 'Li-Ning Air Force 79' },
      { id: 'r2', catalogId: null, category: 'racket', label: 'Yonex Nanoflare 800' },
    ];
    global.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.includes('/api/equipment/gear') && init?.method === 'PATCH') {
        active = JSON.parse(String(init.body)).activeRacketId;
      }
      const body = u.includes('/api/equipment/gear')
        ? { gear: { id: 'gear-m1', memberId: 'm1', items, activeRacketId: active, updatedAt: '' } }
        : u.includes('/api/equipment/catalog') ? { items: [] }
        : u.includes('/api/recommend') ? { item: null, needsCheckIn: true }
        : { entries: [] };
      return Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
    }) as unknown as typeof fetch;
  });
  afterEach(() => {
    delete process.env.NEXT_PUBLIC_FLAG_GEAR_SETUP;
    cleanup();
    vi.restoreAllMocks();
  });

  it('a burst of swaps re-asks the picks once, not twice per swap', async () => {
    mount();
    await screen.findByText('Set-up');
    await waitFor(() => expect(calls((u) => u.includes('/api/recommend')).length).toBe(2));
    for (let i = 0; i < 3; i++) {
      const swap = await screen.findByRole('button', { name: /^Swap in/ });
      await act(async () => { swap.click(); await new Promise((r) => setTimeout(r, 20)); });
    }
    const patches = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.filter((c) => (c[1] as RequestInit | undefined)?.method === 'PATCH');
    expect(patches.length).toBe(3);
    await act(async () => { await new Promise((r) => setTimeout(r, 700)); });
    expect(calls((u) => u.includes('/api/recommend')).length).toBe(4);
  });
});
