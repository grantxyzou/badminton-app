// @vitest-environment jsdom
// @vitest-environment-options { "url": "http://localhost:3000/bpm" }
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, within, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import StringsWeOfferCard from '../../components/stringing/StringsWeOfferCard';
import { resetCatalogCache } from '@/components/stats/useCatalog';
import enMessages from '../../messages/en.json';

/**
 * "Strings in stock" (docs/design/strings-shelf-spec.md, design 4a; the
 * Stringing canvas, idea B, 2026-11-12): a card that holds only the map, with
 * repulsion, control, sound or shock up the side; a quiet peek on the tab bar
 * that names the picked string and opens it; the whole shelf as a list in a
 * sheet; and the list alone when there is too little to plot.
 */

const str = (id: string, model: string, repulsion: number | null, durability: number | null, extra: Record<string, unknown> = {}) => ({
  id,
  category: 'string',
  brand: 'Yonex',
  model,
  attributes: { ...(repulsion !== null ? { repulsion } : {}), ...(durability !== null ? { durability } : {}), control: 7, bestFor: `${model} is for you`, ...extra },
});

const CATALOG = [
  str('s-80', 'BG80', 8, 6),
  str('s-66', 'BG66', 9, 4),
  str('s-65', 'BG65', 5, 9),
  str('s-ex', 'Exbolt 63', 9, 5),
  str('s-nr', 'Unrated', null, null, { gaugeMm: 0.7 }),
];

function mockApi(strings: string[], extra: Record<string, unknown> = {}) {
  const links: Record<string, string> = { BG80: 's-80', BG66: 's-66', BG65: 's-65', Exbolt: 's-ex', Unrated: 's-nr' };
  vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
    if (String(url).includes('/catalog')) return Promise.resolve({ ok: true, json: async () => ({ items: CATALOG }) } as Response);
    return Promise.resolve({ ok: true, json: async () => ({ strings, links, ...extra }) } as Response);
  }));
}

function wrap() {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <StringsWeOfferCard />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  resetCatalogCache();
  try { localStorage.clear(); } catch { /* jsdom always has it */ }
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('the map', () => {
  it('opens on the map with nothing picked, the peek pointing back at it', async () => {
    mockApi(['BG80', 'BG66', 'BG65', 'Exbolt'], { stock: { BG66: 'out', Exbolt: 'in' }, prices: { Exbolt: 3200 } });
    wrap();
    const map = await screen.findByRole('group', { name: 'Strings by repulsion and durability' });
    expect(within(map).getAllByRole('button').filter((b) => b.getAttribute('aria-pressed') === 'true')).toHaveLength(0);
    const peek = screen.getByTestId('string-peek');
    expect(peek.textContent).toContain('Tap a dot on the map to see it here');
    expect(within(peek).getByRole('button', { name: 'Show every string as a list' })).toBeDefined();
    // The card holds only the map: no list switch, the lesson behind a button.
    expect(screen.getByText('Map view')).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Show as a list' })).toBeNull();
    expect(screen.getByRole('button', { name: 'How to choose a string' })).toBeDefined();
  });

  it('names a tapped dot in the peek, with its two map numbers, and the peek opens its sheet', async () => {
    mockApi(['BG80', 'BG66', 'BG65', 'Exbolt'], { stock: { Exbolt: 'low' }, prices: { Exbolt: 3200 } });
    wrap();
    fireEvent.click(await screen.findByRole('button', { name: /^Yonex Exbolt 63:/ }));
    // Tapping a dot never opens the sheet.
    expect(screen.queryByRole('dialog')).toBeNull();
    const peek = screen.getByTestId('string-peek');
    expect(peek.textContent).toContain('Exbolt');
    expect(peek.textContent).toContain('Repulsion 9 · Durability 5');
    // The peek says what the map says and nothing more: no price or stock.
    expect(peek.textContent).not.toContain('$32');
    expect(peek.textContent).not.toContain('Low on stock');
    fireEvent.click(within(peek).getByRole('button', { name: 'Open Yonex Exbolt 63' }));
    const sheet = await screen.findByRole('dialog');
    expect(within(sheet).getByText('Yonex Exbolt 63')).toBeDefined();
    expect(within(sheet).getByText(/Low on stock/)).toBeDefined();
  });

  it('follows the axis in the peek', async () => {
    mockApi(['BG80', 'BG66', 'BG65', 'Exbolt']);
    wrap();
    fireEvent.click(await screen.findByRole('button', { name: /^Yonex BG80:/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Control' }));
    expect(screen.getByTestId('string-peek').textContent).toContain('Control 7 · Durability 6');
  });

  it('moves the selection with the arrow keys, in list order', async () => {
    mockApi(['BG80', 'BG66', 'BG65']);
    wrap();
    const first = await screen.findByRole('button', { name: /^Yonex BG66:/ });
    fireEvent.keyDown(first, { key: 'ArrowRight' });
    expect(screen.getByRole('button', { name: /^Yonex BG80:/ }).getAttribute('aria-pressed')).toBe('true');
  });

  it('points strings it cannot plot to the list, where they are', async () => {
    mockApi(['BG80', 'BG66', 'BG65', 'Unrated', 'House']);
    wrap();
    await screen.findByRole('group', { name: 'Strings by repulsion and durability' });
    fireEvent.click(screen.getByRole('button', { name: '2 more strings aren’t on the map · see the list' }));
    const sheet = await screen.findByRole('dialog');
    // An unlinked label is listed, as a plain row: it has no page to open, but
    // it is on offer, so it is not drawn as a disabled one (audit 2026-10-12).
    expect(within(sheet).getByText('House').closest('button')).toBeNull();
    expect(within(sheet).getByText('Unrated').closest('button')).not.toBeNull();
  });

  it('draws no stock legend; the string’s sheet says it when it is low or out', async () => {
    // Grant, on the map: "Does user care about stock here?"
    mockApi(['BG80', 'BG66', 'BG65'], { stock: { BG80: 'in', BG66: 'low', BG65: 'in' } });
    wrap();
    await screen.findByRole('group', { name: 'Strings by repulsion and durability' });
    expect(screen.queryByText('In stock')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^Yonex BG66:/ }));
    fireEvent.click(within(screen.getByTestId('string-peek')).getByRole('button'));
    expect(within(await screen.findByRole('dialog')).getByText(/Low on stock/)).toBeDefined();
  });

  it('puts strings with identical scores on ONE dot with their count, and zooms in on a tap', async () => {
    // Grant: "How do we handel large list of maps? they overlapp".
    resetCatalogCache();
    CATALOG.push(str('s-twin', 'BG80 Twin', 8, 6));
    try {
      const links = { BG80: 's-80', BG66: 's-66', BG65: 's-65', Twin: 's-twin' };
      vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
        if (String(url).includes('/catalog')) return Promise.resolve({ ok: true, json: async () => ({ items: CATALOG }) } as Response);
        return Promise.resolve({ ok: true, json: async () => ({ strings: ['BG80', 'Twin', 'BG66', 'BG65'], links }) } as Response);
      }));
      wrap();
      const cluster = await screen.findByRole('button', { name: '2 strings: BG80, BG80 Twin' });
      expect(cluster.textContent).toBe('2');
      fireEvent.click(cluster);
      // Zoomed: only the two, a way back, and what they share.
      const map = screen.getByRole('group', { name: '2 strings at Repulsion 8 · Durability 6' });
      expect(within(map).getAllByRole('button')).toHaveLength(2);
      expect(screen.getByRole('status').textContent).toBe('2 strings at Repulsion 8 · Durability 6');
      fireEvent.click(within(map).getByRole('button', { name: /^Yonex BG80 Twin:/ }));
      expect(within(map).getByRole('button', { name: /^Yonex BG80 Twin:/ }).getAttribute('aria-pressed')).toBe('true');
      fireEvent.click(screen.getByRole('button', { name: 'All strings' }));
      expect(screen.getByRole('group', { name: 'Strings by repulsion and durability' })).toBeDefined();
    } finally {
      CATALOG.pop();
    }
  });
});

describe('what runs up the side', () => {
  it('switches from power to control, says so, and remembers it', async () => {
    mockApi(['BG80', 'BG66', 'BG65', 'Exbolt']);
    wrap();
    await screen.findByRole('group', { name: 'Strings by repulsion and durability' });
    expect(screen.getByText('More repulsion →')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Control' }));
    const map = screen.getByRole('group', { name: 'Strings by control and durability' });
    expect(within(map).getByRole('button', { name: 'Yonex BG80: control 7 out of 10, durability 6 out of 10' })).toBeDefined();
    expect(screen.getByText('More control →')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Control' }).getAttribute('aria-pressed')).toBe('true');
    expect(localStorage.getItem('bpm:strings-axis')).toBe('control');
  });

  it('plots hitting sound and shock absorption, the maker’s own ratings, out of 10', async () => {
    resetCatalogCache();
    CATALOG.forEach((c, i) => {
      (c.attributes as Record<string, unknown>).hittingSound = [7, 8, 6, 10, 5][i];
      (c.attributes as Record<string, unknown>).shockAbsorption = [6, 7, 6, 7, 5][i];
    });
    try {
      mockApi(['BG80', 'BG66', 'BG65', 'Exbolt']);
      wrap();
      fireEvent.click(await screen.findByRole('button', { name: 'Sound' }));
      let map = screen.getByRole('group', { name: 'Strings by hitting sound and durability' });
      expect(within(map).getByRole('button', { name: 'Yonex BG65: hitting sound 6 out of 10, durability 9 out of 10' })).toBeDefined();
      fireEvent.click(screen.getByRole('button', { name: 'Shock' }));
      map = screen.getByRole('group', { name: 'Strings by shock absorption and durability' });
      expect(within(map).getByRole('button', { name: 'Yonex BG66: shock absorption 7 out of 10, durability 4 out of 10' })).toBeDefined();
      expect(screen.getByText('More shock absorption →')).toBeDefined();
    } finally {
      CATALOG.forEach((c) => {
        delete (c.attributes as Record<string, unknown>).hittingSound;
        delete (c.attributes as Record<string, unknown>).shockAbsorption;
      });
    }
  });

  it('offers only the axes enough strings are rated on, and falls back to repulsion', async () => {
    // The fixtures carry no sound or shock rating: neither is offered, and a
    // stored pick that is no longer an axis ("feel") opens on repulsion.
    localStorage.setItem('bpm:strings-axis', 'feel');
    mockApi(['BG80', 'BG66', 'BG65', 'Exbolt']);
    wrap();
    await screen.findByRole('group', { name: 'Strings by repulsion and durability' });
    expect(screen.queryByRole('button', { name: 'Sound' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Feel' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Control' })).toBeDefined();
  });
});

describe('the list', () => {
  it('is the peek’s swipe-up: every string, sorted by repulsion, the maker’s ratings as chips', async () => {
    mockApi(['BG65', 'BG80', 'BG66']);
    wrap();
    await screen.findByRole('group', { name: 'Strings by repulsion and durability' });
    fireEvent.click(within(screen.getByTestId('string-peek')).getByRole('button'));
    const sheet = await screen.findByRole('dialog', { name: '3 strings in stock' });
    // By the SHELF name, what a request sends; sorted by repulsion.
    const rows = within(sheet).getAllByRole('listitem').filter((li) => li.querySelector('.string-list-row'));
    expect(rows.map((r) => r.textContent?.match(/BG\d+/)?.[0])).toEqual(['BG66', 'BG80', 'BG65']);
    const bg80 = rows[1];
    expect(within(bg80).getByRole('img', { name: 'Repulsion 8, Durability 6, Control 7' })).toBeDefined();
    // The chip it is sorted by is filled solid.
    expect(bg80.querySelector<HTMLElement>('[data-chip="power"]')!.style.background).not.toContain('color-mix');
    expect(bg80.querySelector<HTMLElement>('[data-chip="durability"]')!.style.background).toContain('color-mix');
  });

  it('sorts by any trait or the price, its button and menu in the trait’s colour', async () => {
    const { traitTint } = await import('@/lib/stringShelf');
    const norm = (c: string) => { const el = document.createElement('span'); el.style.color = c; return el.style.color; };
    mockApi(['BG65', 'BG80', 'BG66'], { prices: { BG65: 2800, BG80: 3200, BG66: 3000 } });
    wrap();
    await screen.findByRole('group', { name: 'Strings by repulsion and durability' });
    fireEvent.click(within(screen.getByTestId('string-peek')).getByRole('button'));
    const sheet = await screen.findByRole('dialog', { name: '3 strings in stock' });
    const sortButton = within(sheet).getByTestId('list-sort');
    expect(sortButton.textContent).toContain('Repulsion');
    expect(sortButton.style.color).toBe(norm(traitTint('power')));
    fireEvent.click(sortButton);
    const menu = within(sheet).getByRole('menu');
    expect(within(menu).getAllByRole('menuitemradio').map((b) => b.querySelector('span:not([aria-hidden])')?.textContent)).toEqual(['Repulsion', 'Durability', 'Control', 'Sound', 'Shock', 'Price']);
    expect(within(menu).getByRole('menuitemradio', { name: 'Repulsion' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(within(menu).getByRole('menuitemradio', { name: 'Durability' }));
    expect(within(sheet).getByTestId('list-sort').style.color).toBe(norm(traitTint('durability')));
    const order = () => within(sheet).getAllByRole('listitem').filter((li) => li.querySelector('.string-list-row')).map((r) => r.textContent?.match(/BG\d+/)?.[0]);
    expect(order()).toEqual(['BG65', 'BG80', 'BG66']);
    fireEvent.click(within(sheet).getByTestId('list-sort'));
    fireEvent.click(within(sheet).getByRole('menuitemradio', { name: 'Price' }));
    expect(order()).toEqual(['BG65', 'BG66', 'BG80']);
  });

  it('is all there is, with no toggle, when fewer than three strings plot', async () => {
    mockApi(['BG80', 'BG66', 'Unrated']);
    wrap();
    await screen.findByText('BG80');
    expect(screen.queryByRole('button', { name: 'Show as a list' })).toBeNull();
    expect(screen.queryByRole('group', { name: 'Strings by repulsion and durability' })).toBeNull();
    // No map, so no peek either.
    expect(screen.queryByTestId('string-peek')).toBeNull();
  });

  it('names a short shelf’s row by repulsion, control and durability, with its stock in words', async () => {
    // Too few to plot: the list is the card, as before.
    mockApi(['BG80', 'BG66', 'Unrated'], { stock: { BG80: 'low' } });
    wrap();
    const row = (await screen.findByText('BG80')).closest('button')!;
    expect(row.textContent).toContain('Repulsion 8 · Control 7 · Durability 6');
    expect(row.textContent).toContain('Low on stock');
    // A string with no stock band says nothing about stock, never "out".
    expect(screen.getByText('BG66').closest('button')!.textContent).not.toMatch(/stock/i);
  });

  it('leads each list row with name and price, then type · feel, then what it is for', async () => {
    resetCatalogCache();
    const before = CATALOG[0].attributes;
    CATALOG[0].attributes = { ...before, stringType: 'Repulsion', feel: 'Medium-Hard' } as typeof before;
    try {
      mockApi(['BG65', 'BG80', 'BG66'], { stock: { BG80: 'low' }, prices: { BG80: 3200 } });
      wrap();
      await screen.findByRole('group', { name: 'Strings by repulsion and durability' });
      fireEvent.click(within(screen.getByTestId('string-peek')).getByRole('button'));
      const sheet = await screen.findByRole('dialog', { name: '3 strings in stock' });
      const row = within(sheet).getByText('BG80').closest('button')!;
      const text = row.textContent ?? '';
      // Reading order: name, price, type · feel, description; stock is the
      // string's sheet's (Grant: "remove" the list's "Low on stock").
      const at = (part: string) => text.indexOf(part);
      expect(at('BG80')).toBe(0);
      expect(at('BG80')).toBeLessThan(at('$32'));
      expect(at('$32')).toBeLessThan(at('Repulsion · Hard feel'));
      expect(at('Repulsion · Hard feel')).toBeLessThan(at('BG80 is for you'));
      expect(text).not.toContain('Low on stock');
    } finally {
      CATALOG[0].attributes = before;
    }
  });

  it('hands the stringer’s note for a string to its page', async () => {
    mockApi(['BG80', 'BG66', 'BG65'], { notes: { BG80: 'Hard hitters: 26 lb.' } });
    wrap();
    fireEvent.click(await screen.findByRole('button', { name: /^Yonex BG80:/ }));
    expect(screen.queryByText('Hard hitters: 26 lb.')).toBeNull();
    fireEvent.click(within(screen.getByTestId('string-peek')).getByRole('button'));
    const sheet = await screen.findByRole('dialog');
    expect(within(sheet).getByText('Your stringer recommends')).toBeDefined();
    expect(within(sheet).getByText('Hard hitters: 26 lb.')).toBeDefined();
  });

  it('shows "Ask" for a null price and nothing when none is set', async () => {
    mockApi(['BG80', 'BG66'], { prices: { BG80: null } });
    wrap();
    const bg80 = (await screen.findByText('BG80')).closest('button')!;
    const bg66 = screen.getByText('BG66').closest('button')!;
    expect(bg80.textContent).toContain('Ask');
    expect(bg66.textContent).not.toMatch(/\$|Ask/);
  });
});

/**
 * The Strings tab is where every price lives now (docs/plans/stringing-tabs.md):
 * the service card's "View pricing" expander went, so the own-string price and
 * the stringer's note moved here, beside the strings they are priced against.
 */
function mockWithPricing(strings: string[], pricing: Record<string, unknown> | 'fail', extra: Record<string, unknown> = {}) {
  const links: Record<string, string> = { BG80: 's-80', BG66: 's-66', BG65: 's-65' };
  vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
    const u = String(url);
    if (u.includes('/catalog')) return Promise.resolve({ ok: true, json: async () => ({ items: CATALOG }) } as Response);
    if (u.includes('/pricing')) {
      return pricing === 'fail'
        ? Promise.resolve({ ok: false, status: 503, json: async () => ({ error: 'read_failed' }) } as Response)
        : Promise.resolve({ ok: true, json: async () => ({ services: [], ...pricing }) } as Response);
    }
    return Promise.resolve({ ok: true, json: async () => ({ strings, links, ...extra }) } as Response);
  }));
}

function wrapWith(node: React.ReactNode) {
  return render(<NextIntlClientProvider locale="en" messages={enMessages}>{node}</NextIntlClientProvider>);
}

describe('the stringer\'s note', () => {
  // "Bring your own string" and its price left this card for the request
  // sheet's own row, where the choice is made (docs/plans/stringing-canvas-redesign.md).
  it('shows the note, and no own-string row', async () => {
    mockWithPricing(['BG80', 'BG66'], { ownStringCents: 1800, note: 'Ready in about a week.' });
    wrapWith(<StringsWeOfferCard />);
    expect(await screen.findByText('Ready in about a week.')).toBeDefined();
    expect(screen.queryByText('Bring your own string')).toBeNull();
    expect(screen.queryByText('$18')).toBeNull();
  });

  it('says the note did not load, rather than go quiet', async () => {
    mockWithPricing(['BG80', 'BG66'], 'fail');
    wrapWith(<StringsWeOfferCard />);
    expect((await screen.findByRole('alert')).textContent).toBe(enMessages.home.stringing.offer.pricesError);
  });
});

describe('failures and unknowns (design-system audit, 2026-10-12)', () => {
  const O = enMessages.home.stringing.offer;

  it('says the details did not load when the catalog fails, instead of calling every string unknown', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
      const u = String(url);
      if (u.includes('/catalog')) return Promise.resolve({ ok: false, status: 503, json: async () => ({ error: 'read_failed' }) } as Response);
      if (u.includes('/pricing')) return Promise.resolve({ ok: true, json: async () => ({ services: [], ownStringCents: 1800, note: '' }) } as Response);
      return Promise.resolve({ ok: true, json: async () => ({ strings: ['BG80', 'BG66'], links: { BG80: 's-80', BG66: 's-66' }, prices: { BG80: 3000 } }) } as Response);
    }));
    wrapWith(<StringsWeOfferCard />);
    expect(await screen.findByText(O.catalogError)).toBeDefined();
    expect(screen.queryByText(O.unknown)).toBeNull();
    expect(screen.getByText('BG80')).toBeDefined();
    expect(screen.getByText('$30')).toBeDefined();
  });

  it('lists a string the catalog does not know at full strength, not as a disabled row', async () => {
    mockWithPricing(['Mystery 70'], { ownStringCents: null, note: '' }, { prices: { 'Mystery 70': 2600 } });
    wrapWith(<StringsWeOfferCard />);
    const name = await screen.findByText('Mystery 70');
    expect(name.closest('button')).toBeNull();
    expect(name.closest('[aria-disabled]')).toBeNull();
    expect(screen.getByText(O.unknown)).toBeDefined();
  });

  it('offers a retry when the other prices fail, and shows them once they load', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
      const u = String(url);
      if (u.includes('/catalog')) return Promise.resolve({ ok: true, json: async () => ({ items: CATALOG }) } as Response);
      if (u.includes('/pricing')) {
        calls += 1;
        return calls === 1
          ? Promise.resolve({ ok: false, status: 503, json: async () => ({ error: 'read_failed' }) } as Response)
          : Promise.resolve({ ok: true, json: async () => ({ services: [], ownStringCents: 1800, note: '' }) } as Response);
      }
      return Promise.resolve({ ok: true, json: async () => ({ strings: ['BG80'], links: { BG80: 's-80' } }) } as Response);
    }));
    wrapWith(<StringsWeOfferCard />);
    await screen.findByText(O.pricesError);
    fireEvent.click(screen.getByRole('button', { name: O.retry }));
    await waitFor(() => expect(screen.queryByText(O.pricesError)).toBeNull());
  });

  it('keeps the card on screen while the string list is asked for again', async () => {
    // Retrying used to set the card back to "loading", which returns null; the
    // reveal slot had already let go of its skeleton, so the register went blank.
    let stringCalls = 0;
    let answer: (v: Response) => void = () => {};
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
      const u = String(url);
      if (u.includes('/catalog')) return Promise.resolve({ ok: true, json: async () => ({ items: CATALOG }) } as Response);
      if (u.includes('/pricing')) return Promise.resolve({ ok: true, json: async () => ({ services: [], ownStringCents: 1800, note: '' }) } as Response);
      stringCalls += 1;
      if (stringCalls === 1) return Promise.resolve({ ok: false, status: 503, json: async () => ({ error: 'read_failed' }) } as Response);
      return new Promise<Response>((resolve) => { answer = resolve; });
    }));
    wrapWith(<StringsWeOfferCard />);
    fireEvent.click(await screen.findByRole('button', { name: O.retry }));
    expect(screen.getByText(O.title)).toBeDefined();
    answer({ ok: true, json: async () => ({ strings: ['BG80'], links: { BG80: 's-80' } }) } as Response);
    expect(await screen.findByText('BG80')).toBeDefined();
  });

  it('keeps the map\'s axis copy to the map', async () => {
    mockApi(['BG80', 'BG66', 'Unrated']);
    wrap();
    await screen.findByText('BG80');
    expect(screen.getByText(O.subtitle)).toBeDefined();
    expect(screen.queryByText('Map view')).toBeNull();
  });
});

describe('as a whole tab', () => {
  it('says the stringer has listed nothing, instead of rendering nothing', async () => {
    mockWithPricing([], { ownStringCents: null, note: '' });
    wrapWith(<StringsWeOfferCard showEmpty />);
    expect(await screen.findByText(enMessages.home.stringing.offer.empty)).toBeDefined();
  });

  it('still renders nothing on its own when empty, outside the tab', async () => {
    mockWithPricing([], { ownStringCents: null, note: '' });
    const { container } = wrapWith(<StringsWeOfferCard />);
    await new Promise((r) => setTimeout(r, 0));
    expect(container.textContent).toBe('');
  });
});

describe('the colours on the reel', () => {
  it('shows the stringer’s colours on the row, and names them on the string’s sheet', async () => {
    mockApi(['BG80', 'BG65'], { colours: { BG80: ['white', 'yellow', 'not-a-colour'] } });
    wrap();
    expect(await screen.findByRole('img', { name: 'Colours: White, Yellow' })).toBeDefined();
    // Only the string the stringer described carries dots.
    expect(screen.getAllByRole('img', { name: /^Colours:/ })).toHaveLength(1);
    fireEvent.click(screen.getByText('BG80').closest('button')!);
    const sheet = await screen.findByRole('dialog');
    // The canvas, frame 3: the colours sit above the price, which may one day
    // depend on them. Still nothing to pick here: the request picks.
    expect(within(sheet).getByText('Colours on the reel')).toBeDefined();
    expect(within(sheet).queryByText(enMessages.home.stringing.offer.coloursNote)).toBeNull();
  });
});

describe('colour by trait (Grant, 2026-11-12: "A for lists, D for map")', () => {
  // The browser's own reading of a colour, so a hex and its rgb() compare equal.
  const norm = (c: string) => { const el = document.createElement('span'); el.style.color = c; return el.style.color; };
  const normBg = (c: string) => { const el = document.createElement('span'); el.style.background = c; return el.style.background; };

  const TYPED = [
    str('s-80', 'BG80', 8, 6, { stringType: 'Repulsion' }),
    str('s-66', 'BG66', 9, 4, { stringType: 'Control' }),
    str('s-65', 'BG65', 5, 9, { stringType: 'Durability' }),
    str('s-ex', 'Exbolt 63', 9, 5, { stringType: 'Hybrid' }),
  ];
  function mockTyped(strings: string[]) {
    const links: Record<string, string> = { BG80: 's-80', BG66: 's-66', BG65: 's-65', Exbolt: 's-ex' };
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
      if (String(url).includes('/catalog')) return Promise.resolve({ ok: true, json: async () => ({ items: TYPED }) } as Response);
      return Promise.resolve({ ok: true, json: async () => ({ strings, links }) } as Response);
    }));
  }

  it('draws each "Trait N" on a list row in its trait colour, unbroken, with muted separators', async () => {
    const { traitTint } = await import('@/lib/stringShelf');
    // A short shelf: the list is the card.
    mockApi(['BG80', 'BG66', 'Unrated']);
    wrap();
    const row = (await screen.findByText('BG80')).closest('button')!;
    const parts = Array.from(row.querySelectorAll<HTMLElement>('[data-trait]'));
    expect(parts.map((p) => [p.dataset.trait, p.textContent])).toEqual([
      ['power', 'Repulsion 8'], ['control', 'Control 7'], ['durability', 'Durability 6'],
    ]);
    for (const p of parts) {
      expect(p.style.whiteSpace).toBe('nowrap');
      expect(p.style.color).toBe(norm(traitTint(p.dataset.trait as 'power' | 'control' | 'durability')));
    }
    // The separators are outside the coloured parts, in the row's muted ink.
    expect(parts.every((p) => !p.textContent!.includes('·'))).toBe(true);
    expect(row.textContent).toContain('Repulsion 8 · Control 7 · Durability 6');
  });

  it('colours each map dot by its string type, with a legend and the type in words on the card', async () => {
    const { typeDotFill } = await import('@/lib/stringShelf');
    mockTyped(['BG80', 'BG66', 'BG65', 'Exbolt']);
    wrap();
    const map = await screen.findByRole('group', { name: 'Strings by repulsion and durability' });
    const dotOf = (name: RegExp) => within(map).getByRole('button', { name }).querySelector<HTMLElement>('[data-dot-type]')!;
    expect(dotOf(/^Yonex BG80:/).dataset.dotType).toBe('repulsion');
    expect(dotOf(/^Yonex BG80:/).style.background).toBe(normBg(typeDotFill('repulsion')));
    expect(dotOf(/^Yonex BG66:/).dataset.dotType).toBe('control');
    expect(dotOf(/^Yonex BG66:/).style.background).toBe(normBg(typeDotFill('control')));
    expect(dotOf(/^Yonex Exbolt 63:/).dataset.dotType).toBe('hybrid');

    const legend = screen.getByRole('list', { name: "Dot colour: the string's type" });
    expect(within(legend).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Repulsion', 'Control', 'Durability', 'Hybrid']);

    // The peek names the picked string beside its type's dot.
    fireEvent.click(within(map).getByRole('button', { name: /^Yonex BG66:/ }));
    expect(screen.getByTestId('string-peek').textContent).toContain('BG66');
  });

  it('draws a string with no type in neutral ink, never the accent, and leaves it out of the legend', async () => {
    mockApi(['BG80', 'BG66', 'BG65']);
    wrap();
    const map = await screen.findByRole('group', { name: 'Strings by repulsion and durability' });
    const dot = within(map).getByRole('button', { name: /^Yonex BG80:/ }).querySelector<HTMLElement>('[data-dot-type]')!;
    expect(dot.dataset.dotType).toBe('none');
    expect(dot.getAttribute('style')).not.toContain('--accent');
    expect(screen.queryByRole('list', { name: "Dot colour: the string's type" })).toBeNull();
    expect(screen.queryByTestId('selected-type')).toBeNull();
  });
});

describe('what suits your racket, on the map (Grant: "it should be top level visible")', () => {
  function mockWithFit(fit: unknown) {
    const links: Record<string, string> = { BG80: 's-80', BG66: 's-66', BG65: 's-65', Exbolt: 's-ex' };
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
      const u = String(url);
      if (u.includes('/catalog')) return Promise.resolve({ ok: true, json: async () => ({ items: CATALOG }) } as Response);
      if (u.includes('/fit?ids=')) return Promise.resolve({ ok: true, json: async () => fit } as Response);
      return Promise.resolve({ ok: true, json: async () => ({ strings: ['BG80', 'BG66', 'BG65', 'Exbolt'], links }) } as Response);
    }));
  }

  it('names the racket, glows the strings that suit it, and says so in the peek and the list', async () => {
    mockWithFit({ racket: 'Yonex Astrox 88D Pro', fits: { 's-80': 'good_match', 's-66': 'worth_a_look', 's-65': 'not_for_frame', 's-ex': 'good_match' } });
    wrap();
    const strip = await screen.findByTestId('map-fit-strip');
    expect(strip.textContent).toContain('For your Yonex Astrox 88D Pro · glowing dots suit it best');
    const map = screen.getByRole('group', { name: 'Strings by repulsion and durability' });
    const glow = (name: RegExp) => within(map).getByRole('button', { name }).querySelector<HTMLElement>('[data-dot-type]')!.dataset.match;
    expect(glow(/^Yonex BG80:/)).toBe('true');
    expect(glow(/^Yonex Exbolt 63:/)).toBe('true');
    expect(glow(/^Yonex BG66:/)).toBeUndefined();
    fireEvent.click(within(map).getByRole('button', { name: /^Yonex BG80:/ }));
    expect(screen.getByTestId('peek-match').textContent).toBe('check_circleGood match for your Yonex Astrox 88D Pro');
    // The fit was asked once, for every string the catalog knows.
    const calls = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((c) => String(c[0]));
    expect(calls.filter((u) => u.includes('/fit?ids=')).length).toBe(1);
  });

  it('says nothing about a racket the engine cannot pair, and glows nothing', async () => {
    mockWithFit({ fits: null, reason: 'no_frame' });
    wrap();
    const map = await screen.findByRole('group', { name: 'Strings by repulsion and durability' });
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByTestId('map-fit-strip')).toBeNull();
    expect(map.querySelectorAll('[data-match]')).toHaveLength(0);
  });
});
