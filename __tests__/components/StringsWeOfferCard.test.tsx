// @vitest-environment jsdom
// @vitest-environment-options { "url": "http://localhost:3000/bpm" }
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
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
    expect(screen.getByText('Power 9/10 · Durability 5/10 · Control 7/10')).toBeDefined();
    expect(screen.getByText(enMessages.home.stringing.offer.subtitleMap)).toBeDefined();
  });

  it('moves the panel when a dot is tapped, without opening the sheet', async () => {
    mockApi(['BG80', 'BG66', 'BG65']);
    wrap();
    fireEvent.click(await screen.findByRole('button', { name: /^Yonex BG65:/ }));
    expect(screen.getByText('BG65 is for you')).toBeDefined();
    expect(screen.queryByRole('dialog')).toBeNull();
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

  it('shows a legend only when some string has a band', async () => {
    mockApi(['BG80', 'BG66', 'BG65']);
    wrap();
    await screen.findByRole('group', { name: 'Strings by power and durability' });
    expect(screen.queryByText('In stock')).toBeNull();
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
    fireEvent.click(await screen.findByRole('button', { name: 'List' }));
    expect(screen.queryByRole('group', { name: 'Strings by power and durability' })).toBeNull();
    const rows = screen.getAllByText(/^Yonex /).map((n) => n.textContent);
    expect(rows).toEqual(['Yonex BG66', 'Yonex BG80', 'Yonex BG65']);
    expect(localStorage.getItem('bpm:strings-view')).toBe('list');
  });

  it('is all there is, with no toggle, when fewer than three strings plot', async () => {
    mockApi(['BG80', 'BG66', 'Unrated']);
    wrap();
    await screen.findByText('Yonex BG80');
    expect(screen.queryByRole('button', { name: 'List' })).toBeNull();
    expect(screen.queryByRole('group', { name: 'Strings by power and durability' })).toBeNull();
  });

  it('shows "Ask" for a null price and nothing when none is set', async () => {
    mockApi(['BG80', 'BG66'], { prices: { BG80: null } });
    wrap();
    const bg80 = (await screen.findByText('Yonex BG80')).closest('button')!;
    const bg66 = screen.getByText('Yonex BG66').closest('button')!;
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

describe('the rest of the prices', () => {
  it('lists a restring with your own string, and the stringer’s note', async () => {
    mockWithPricing(['BG80', 'BG66'], { ownStringCents: 1800, note: 'Ready in about a week.' });
    wrapWith(<StringsWeOfferCard />);
    const own = await screen.findByText('Bring your own string');
    expect(within(own.parentElement as HTMLElement).getByText('$18')).toBeDefined();
    expect(screen.getByText('Ready in about a week.')).toBeDefined();
  });

  it('says Ask when no own-string price is set', async () => {
    mockWithPricing(['BG80', 'BG66'], { ownStringCents: null, note: '' });
    wrapWith(<StringsWeOfferCard />);
    const own = await screen.findByText('Bring your own string');
    expect(within(own.parentElement as HTMLElement).getByText('Ask')).toBeDefined();
  });

  it('says the other prices did not load, rather than guess or go quiet', async () => {
    // The Strings register is the only place the own-string price lives now,
    // so a failed read must be visible (local review, 2026-10-12).
    mockWithPricing(['BG80', 'BG66'], 'fail');
    wrapWith(<StringsWeOfferCard />);
    expect((await screen.findByRole('alert')).textContent).toBe(enMessages.home.stringing.offer.pricesError);
    expect(screen.queryByText('Bring your own string')).toBeNull();
    expect(screen.queryByText('Ask')).toBeNull();
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
    expect(await screen.findByText('Bring your own string')).toBeDefined();
    expect(screen.getByText('$18')).toBeDefined();
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
    expect(await screen.findByText('Yonex BG80')).toBeDefined();
  });

  it('keeps the map\'s axis copy to the map', async () => {
    mockApi(['BG80', 'BG66', 'Unrated']);
    wrap();
    await screen.findByText('Yonex BG80');
    expect(screen.getByText(O.subtitle)).toBeDefined();
    expect(screen.queryByText(O.subtitleMap)).toBeNull();
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
