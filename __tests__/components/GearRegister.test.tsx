// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, cleanup, waitFor, act, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import GearRegister from '../../components/stats/GearRegister';
import { resetCatalogCache } from '../../components/stats/useCatalog';
import { resetSharedReads } from '@/lib/sharedRead';
import enMessages from '../../messages/en.json';

/**
 * The register is the Set-up card (its flag retired 2026-10-14), and every
 * reader has exactly one instance. The card, the tension card and the
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

describe('GearRegister — the Set-up card', () => {
  beforeEach(() => {
    resetCatalogCache();
    global.fetch = vi.fn().mockImplementation(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ gear: null, items: [], entries: [], item: null, needsCheckIn: true }) }),
    ) as unknown as typeof fetch;
  });
  afterEach(() => {
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

describe('GearRegister — one door per line', () => {
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
    resetCatalogCache();
  });
  afterEach(() => {
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

describe('GearRegister — swapping rackets', () => {
  beforeEach(() => {
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

describe('GearRegister — single owner of the gear document', () => {
  // The level read goes through sharedRead (shared with OverviewStrip), whose
  // 2s dedupe would hand one test's answer to the next.
  beforeEach(() => { resetSharedReads(); resetCatalogCache(); });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  /**
   * Ported from the retired rail's test. Asserting `toBe(1)` inside `waitFor`
   * passes the instant the count REACHES 1 — before a second reader firing in
   * a LATER tick has had its chance. So: wait for the card, drain a macrotask
   * boundary, and only then count.
   */
  it('issues exactly ONE GET /api/equipment/gear per mount, including after the read settles', async () => {
    global.fetch = vi.fn().mockImplementation(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ gear: null, items: [], entries: [], item: null, needsCheckIn: true }) }),
    ) as unknown as typeof fetch;
    mount();
    const gearReads = () => calls((u) => u.includes('/api/equipment/gear') && !u.includes('method'));
    await waitFor(() => expect(gearReads().length).toBe(1));
    await screen.findByText('Set-up');
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(gearReads().length).toBe(1);
  });
});

describe('GearRegister — D2, one tension number at a time', () => {
  beforeEach(() => { resetSharedReads(); resetCatalogCache(); });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  function mountWith(tensionLbs: number | null) {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      const u = String(url);
      if (u.includes('/api/recommend') && u.includes('category=string')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            item: { id: 's1', category: 'string', brand: 'Yonex', model: 'BG65', skillRange: [1, 5], attributes: {} },
            reasons: ['Wide usable tension window'],
            warnings: [],
            pairedWith: { label: 'Yonex Astrox 88D Pro', source: 'owned' },
            tensionLbs,
          }),
        });
      }
      if (u.includes('/api/stats/level')) {
        // StringTensionCard reads d.level.level, not d.level — with the wrong
        // shape it renders nothing and the "is it hidden" test passes for the
        // wrong reason.
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ level: { level: 4 } }) });
      }
      if (u.includes('/api/recommend')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ item: null, needsCheckIn: true }) });
      }
      if (u.includes('/api/equipment/catalog')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ items: [] }) });
      }
      // A racket in play and a BLANK string line: the pairing's tension is on
      // screen only when the server paired against THIS owned frame
      // (`blankStringPairing`), so the labels must match.
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ gear: { id: 'gear-m1', memberId: 'm1', items: [{ id: 'r1', catalogId: null, category: 'racket', label: 'Yonex Astrox 88D Pro' }], activeRacketId: 'r1', updatedAt: '' }, items: [], entries: [] }) });
    }) as unknown as typeof fetch;
    return mount();
  }

  it('hides the level-based tension card once a pairing has given a real number', async () => {
    mountWith(25.5);
    await screen.findByText('Set-up');
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    await waitFor(() => expect(screen.queryByText('String tension')).toBeNull());
  });

  it('keeps the level-based card when the pairing could not give one', async () => {
    // 11 of 71 frames publish no tension ceiling. Falling back is the whole
    // reason lib/tension.ts is not deleted.
    mountWith(null);
    await screen.findByText('Set-up');
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    await waitFor(() => expect(screen.queryByText('String tension')).not.toBeNull());
  });
});
