// @vitest-environment jsdom
// @vitest-environment-options { "url": "http://localhost:3000/bpm" }
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, within, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import StringsWeOfferCard from '../../components/stringing/StringsWeOfferCard';
import { resetCatalogCache } from '@/components/stats/useCatalog';
import enMessages from '../../messages/en.json';

/**
 * "Strings in stock" (docs/design/strings-shelf-spec.md, design 4a): the map
 * by default, with power, control or feel up the side; the list one tap away;
 * and the list alone when there is too little to plot.
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
  it('opens on the map, with the first in-stock string selected', async () => {
    // Exbolt and BG66 sort first (power 9) but BG66 is out.
    mockApi(['BG80', 'BG66', 'BG65', 'Exbolt'], { stock: { BG66: 'out', Exbolt: 'in' }, prices: { Exbolt: 3200 } });
    wrap();
    const map = await screen.findByRole('group', { name: 'Strings by power and durability' });
    const pressed = within(map).getAllByRole('button').filter((b) => b.getAttribute('aria-pressed') === 'true');
    expect(pressed.map((b) => b.getAttribute('aria-label'))).toEqual(['Yonex Exbolt 63: power 9 out of 10, durability 5 out of 10']);
    expect(screen.getByText('$32')).toBeDefined();
    // The card is the list's row: its ratings are the coloured trait line
    // (the meters moved to the string's page, under "Ratings and specs").
    expect(document.querySelector('button[data-selected="true"]')!.textContent).toContain('Power 9 · Control 7 · Durability 5');
    // The subtitle names the view; the icon beside it switches.
    expect(screen.getByText('Map view')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Show as a list' })).toBeDefined();
  });

  it('moves the panel when a dot is tapped, without opening the sheet', async () => {
    mockApi(['BG80', 'BG66', 'BG65']);
    wrap();
    fireEvent.click(await screen.findByRole('button', { name: /^Yonex BG65:/ }));
    // The panel follows: the card names the string the dot stands for.
    expect(screen.getAllByText('BG65').length).toBeGreaterThan(0);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows the picked string as the list’s own row, tinted, and the whole card opens its page', async () => {
    resetCatalogCache();
    const before = CATALOG[3].attributes;
    CATALOG[3].attributes = { ...before, stringType: 'Repulsion', feel: 'Hard', feelScale: 4, hittingSound: 8, ratingSource: 'Brand published' } as typeof before;
    try {
      mockApi(['BG80', 'BG66', 'BG65', 'Exbolt'], { stock: { Exbolt: 'low' }, prices: { Exbolt: 3200 }, colours: { Exbolt: ['white'] } });
      wrap();
      await screen.findByRole('group', { name: 'Strings by power and durability' });
      const card = document.querySelector<HTMLButtonElement>('button[data-selected="true"]')!;
      expect(card).not.toBeNull();
      // The same row as the list: name, price, type · feel, stock, what it is for, traits.
      const text = card.textContent ?? '';
      for (const part of ['Exbolt', '$32', 'Power · Hard feel', 'Low on stock', 'Exbolt 63 is for you', 'Power 9 · Control 7 · Durability 5']) {
        expect(text).toContain(part);
      }
      expect(within(card).getByRole('img', { name: 'Colours: White' })).toBeDefined();
      expect(card.querySelectorAll('[data-trait]')).toHaveLength(3);
      // Picked: a solid accent tint, never a ring; a chevron says it opens.
      expect(card.style.background).toContain('--accent');
      expect(card.getAttribute('style') ?? '').not.toMatch(/(^|;\s*)(border|outline|box-shadow)\s*:/);
      expect(within(card).getByText('chevron_right')).toBeDefined();
      // The meters, whose ratings and the feel scale are the page's now.
      expect(screen.queryByText('Power, control and durability as rated by Yonex')).toBeNull();
      expect(screen.queryByText('Feel')).toBeNull();
      expect(screen.queryByText('See how it plays')).toBeNull();
      expect(document.querySelectorAll('.bpm-meter-fill')).toHaveLength(0);
      fireEvent.click(card);
      const sheet = await screen.findByRole('dialog');
      expect(within(sheet).getByText('Yonex Exbolt 63')).toBeDefined();
    } finally {
      CATALOG[3].attributes = before;
    }
  });

  it('moves the selection with the arrow keys, in list order', async () => {
    mockApi(['BG80', 'BG66', 'BG65']);
    wrap();
    const first = await screen.findByRole('button', { name: /^Yonex BG66:/ });
    fireEvent.keyDown(first, { key: 'ArrowRight' });
    expect(screen.getByRole('button', { name: /^Yonex BG80:/ }).getAttribute('aria-pressed')).toBe('true');
  });

  it('lists strings it cannot plot under "Not on the map"', async () => {
    mockApi(['BG80', 'BG66', 'BG65', 'Unrated', 'House']);
    wrap();
    await screen.findByRole('group', { name: 'Strings by power and durability' });
    expect(screen.getByText('Not on the map')).toBeDefined();
    // An unlinked label is listed, as a plain row: it has no page to open, but
    // it is on offer, so it is not drawn as a disabled one (audit 2026-10-12).
    expect(screen.getByText('House').closest('button')).toBeNull();
  });

  it('draws no stock legend, and says stock on the card only when it is low or out', async () => {
    // Grant, on the map: "Does user care about stock here?"
    mockApi(['BG80', 'BG66', 'BG65'], { stock: { BG80: 'in', BG66: 'low', BG65: 'in' } });
    wrap();
    await screen.findByRole('group', { name: 'Strings by power and durability' });
    expect(screen.queryByText('In stock')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^Yonex BG66:/ }));
    expect(screen.getByText('Low on stock')).toBeDefined();
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
      const map = screen.getByRole('group', { name: '2 strings at Power 8 · Durability 6' });
      expect(within(map).getAllByRole('button')).toHaveLength(2);
      expect(screen.getByRole('status').textContent).toBe('2 strings at Power 8 · Durability 6');
      fireEvent.click(within(map).getByRole('button', { name: /^Yonex BG80 Twin:/ }));
      expect(within(map).getByRole('button', { name: /^Yonex BG80 Twin:/ }).getAttribute('aria-pressed')).toBe('true');
      fireEvent.click(screen.getByRole('button', { name: 'All strings' }));
      expect(screen.getByRole('group', { name: 'Strings by power and durability' })).toBeDefined();
    } finally {
      CATALOG.pop();
    }
  });
});

describe('what runs up the side', () => {
  it('switches from power to control, says so, and remembers it', async () => {
    mockApi(['BG80', 'BG66', 'BG65', 'Exbolt']);
    wrap();
    await screen.findByRole('group', { name: 'Strings by power and durability' });
    expect(screen.getByText('More power →')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Control' }));
    const map = screen.getByRole('group', { name: 'Strings by control and durability' });
    expect(within(map).getByRole('button', { name: 'Yonex BG80: control 7 out of 10, durability 6 out of 10' })).toBeDefined();
    expect(screen.getByText('More control →')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Control' }).getAttribute('aria-pressed')).toBe('true');
    expect(localStorage.getItem('bpm:strings-axis')).toBe('control');
  });

  it('plots feel out of 5, higher is harder', async () => {
    resetCatalogCache();
    CATALOG.forEach((c, i) => { (c.attributes as Record<string, unknown>).feelScale = [4, 3, 2, 5, 3][i]; });
    try {
      mockApi(['BG80', 'BG66', 'BG65', 'Exbolt']);
      wrap();
      fireEvent.click(await screen.findByRole('button', { name: 'Feel' }));
      const map = screen.getByRole('group', { name: 'Strings by feel and durability' });
      expect(within(map).getByRole('button', { name: 'Yonex BG65: feel 2 out of 5, higher is harder, durability 9 out of 10' })).toBeDefined();
      expect(screen.getByText('Harder feel →')).toBeDefined();
    } finally {
      CATALOG.forEach((c) => { delete (c.attributes as Record<string, unknown>).feelScale; });
    }
  });

  it('offers only the axes enough strings are rated on, and falls back to power', async () => {
    // The fixtures carry no feel rating: Feel is not offered, and a stored
    // "feel" opens on power rather than an empty map.
    localStorage.setItem('bpm:strings-axis', 'feel');
    mockApi(['BG80', 'BG66', 'BG65', 'Exbolt']);
    wrap();
    await screen.findByRole('group', { name: 'Strings by power and durability' });
    expect(screen.queryByRole('button', { name: 'Feel' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Control' })).toBeDefined();
  });
});

describe('the list', () => {
  it('is one tap away, sorted by power, and remembered', async () => {
    mockApi(['BG65', 'BG80', 'BG66']);
    wrap();
    fireEvent.click(await screen.findByRole('button', { name: 'Show as a list' }));
    expect(screen.getByText('List view')).toBeDefined();
    expect(screen.queryByRole('group', { name: 'Strings by power and durability' })).toBeNull();
    // By the SHELF name, what a request sends; sorted by power.
    const rows = screen.getAllByRole('listitem').map((li) => li.textContent ?? '');
    expect(rows.map((r) => r.match(/^BG\d+/)?.[0])).toEqual(['BG66', 'BG80', 'BG65']);
    expect(localStorage.getItem('bpm:strings-view')).toBe('list');
  });

  it('is all there is, with no toggle, when fewer than three strings plot', async () => {
    mockApi(['BG80', 'BG66', 'Unrated']);
    wrap();
    await screen.findByText('BG80');
    expect(screen.queryByRole('button', { name: 'Show as a list' })).toBeNull();
    expect(screen.queryByRole('group', { name: 'Strings by power and durability' })).toBeNull();
  });

  it('opens on the list for a long shelf, unless the member chose the map', async () => {
    resetCatalogCache();
    const extra = Array.from({ length: 6 }, (_, i) => str(`s-x${i}`, `Extra ${i}`, 4 + i, 4 + i));
    CATALOG.push(...extra);
    try {
      const labels = ['BG80', 'BG66', 'BG65', ...extra.map((e) => e.model)];
      const links: Record<string, string> = { BG80: 's-80', BG66: 's-66', BG65: 's-65', ...Object.fromEntries(extra.map((e) => [e.model, e.id])) };
      vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
        if (String(url).includes('/catalog')) return Promise.resolve({ ok: true, json: async () => ({ items: CATALOG }) } as Response);
        return Promise.resolve({ ok: true, json: async () => ({ strings: labels, links }) } as Response);
      }));
      wrap();
      expect(await screen.findByText('List view')).toBeDefined();
      cleanup();
      localStorage.setItem('bpm:strings-view', 'map');
      wrap();
      expect(await screen.findByText('Map view')).toBeDefined();
    } finally {
      CATALOG.splice(CATALOG.length - extra.length, extra.length);
    }
  });

  it('names a row by power, control and durability, with its stock in words', async () => {
    // Grant, 2026-11-12: what the string's page led with belongs on the list.
    mockApi(['BG65', 'BG80', 'BG66'], { stock: { BG80: 'low' } });
    wrap();
    fireEvent.click(await screen.findByRole('button', { name: 'Show as a list' }));
    const row = screen.getByText('BG80').closest('button')!;
    expect(row.textContent).toContain('Power 8 · Control 7 · Durability 6');
    expect(row.textContent).toContain('Low on stock');
    // A string with no stock band says nothing about stock, never "out".
    expect(screen.getByText('BG66').closest('button')!.textContent).not.toMatch(/stock/i);
  });

  it('leads each row with name and price, then type · feel beside the stock, then what it is for', async () => {
    resetCatalogCache();
    const before = CATALOG[0].attributes;
    CATALOG[0].attributes = { ...before, stringType: 'Repulsion', feel: 'Medium-Hard' } as typeof before;
    try {
      mockApi(['BG65', 'BG80', 'BG66'], { stock: { BG80: 'in' }, prices: { BG80: 3200 } });
      wrap();
      fireEvent.click(await screen.findByRole('button', { name: 'Show as a list' }));
      const row = screen.getByText('BG80').closest('button')!;
      const text = row.textContent ?? '';
      expect(within(row).getByText('Power · Hard feel')).toBeDefined();
      expect(within(row).getByText('In stock')).toBeDefined();
      expect(within(row).getByText('BG80 is for you')).toBeDefined();
      // Reading order: name, price, type · feel, stock, description, traits.
      const at = (part: string) => text.indexOf(part);
      expect(at('BG80')).toBe(0);
      expect(at('BG80')).toBeLessThan(at('$32'));
      expect(at('$32')).toBeLessThan(at('Power · Hard feel'));
      expect(at('Power · Hard feel')).toBeLessThan(at('In stock'));
      expect(at('In stock')).toBeLessThan(at('BG80 is for you'));
      expect(at('BG80 is for you')).toBeLessThan(at('Power 8 · Control 7'));
    } finally {
      CATALOG[0].attributes = before;
    }
  });

  it('hands the stringer’s note for a string to its page', async () => {
    try { localStorage.setItem('bpm:strings-view', 'list'); } catch { /* jsdom always has it */ }
    mockApi(['BG80', 'BG65'], { notes: { BG80: 'Hard hitters: 26 lb.' } });
    wrap();
    // The note is the page's, not the list's.
    await screen.findByText('BG80');
    expect(screen.queryByText('Hard hitters: 26 lb.')).toBeNull();
    fireEvent.click(screen.getByText('BG80').closest('button')!);
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
  it('shows the stringer’s colours on the row; the string’s page lists none (the request picks the colour)', async () => {
    try { localStorage.setItem('bpm:strings-view', 'list'); } catch { /* jsdom always has it */ }
    mockApi(['BG80', 'BG65'], { colours: { BG80: ['white', 'yellow', 'not-a-colour'] } });
    wrap();
    expect(await screen.findByRole('img', { name: 'Colours: White, Yellow' })).toBeDefined();
    // Only the string the stringer described carries dots.
    expect(screen.getAllByRole('img', { name: /^Colours:/ })).toHaveLength(1);
    fireEvent.click(screen.getByText('BG80').closest('button')!);
    const sheet = await screen.findByRole('dialog');
    // Grant, 2026-11-12: "people dont do any selection here. The CTA takes
    // them to the request sheet with this string preselected."
    expect(within(sheet).queryByText('On the reel')).toBeNull();
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
    mockApi(['BG65', 'BG80', 'BG66']);
    wrap();
    fireEvent.click(await screen.findByRole('button', { name: 'Show as a list' }));
    const row = screen.getByText('BG80').closest('button')!;
    const parts = Array.from(row.querySelectorAll<HTMLElement>('[data-trait]'));
    expect(parts.map((p) => [p.dataset.trait, p.textContent])).toEqual([
      ['power', 'Power 8'], ['control', 'Control 7'], ['durability', 'Durability 6'],
    ]);
    for (const p of parts) {
      expect(p.style.whiteSpace).toBe('nowrap');
      expect(p.style.color).toBe(norm(traitTint(p.dataset.trait as 'power' | 'control' | 'durability')));
    }
    // The separators are outside the coloured parts, in the row's muted ink.
    expect(parts.every((p) => !p.textContent!.includes('·'))).toBe(true);
    expect(row.textContent).toContain('Power 8 · Control 7 · Durability 6');
  });

  it('colours each map dot by its string type, with a legend and the type in words on the card', async () => {
    const { typeDotFill } = await import('@/lib/stringShelf');
    mockTyped(['BG80', 'BG66', 'BG65', 'Exbolt']);
    wrap();
    const map = await screen.findByRole('group', { name: 'Strings by power and durability' });
    const dotOf = (name: RegExp) => within(map).getByRole('button', { name }).querySelector<HTMLElement>('[data-dot-type]')!;
    expect(dotOf(/^Yonex BG80:/).dataset.dotType).toBe('repulsion');
    expect(dotOf(/^Yonex BG80:/).style.background).toBe(normBg(typeDotFill('repulsion')));
    expect(dotOf(/^Yonex BG66:/).dataset.dotType).toBe('control');
    expect(dotOf(/^Yonex BG66:/).style.background).toBe(normBg(typeDotFill('control')));
    expect(dotOf(/^Yonex Exbolt 63:/).dataset.dotType).toBe('hybrid');

    const legend = screen.getByRole('list', { name: "Dot colour: the string's type" });
    expect(within(legend).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Power', 'Control', 'Durability', 'Hybrid']);

    // The selected string's card says its type in words, beside the colour.
    fireEvent.click(within(map).getByRole('button', { name: /^Yonex BG66:/ }));
    expect(screen.getByTestId('selected-type').textContent).toBe('Control');
  });

  it('draws a string with no type in neutral ink, never the accent, and leaves it out of the legend', async () => {
    mockApi(['BG80', 'BG66', 'BG65']);
    wrap();
    const map = await screen.findByRole('group', { name: 'Strings by power and durability' });
    const dot = within(map).getByRole('button', { name: /^Yonex BG80:/ }).querySelector<HTMLElement>('[data-dot-type]')!;
    expect(dot.dataset.dotType).toBe('none');
    expect(dot.getAttribute('style')).not.toContain('--accent');
    expect(screen.queryByRole('list', { name: "Dot colour: the string's type" })).toBeNull();
    expect(screen.queryByTestId('selected-type')).toBeNull();
  });
});
