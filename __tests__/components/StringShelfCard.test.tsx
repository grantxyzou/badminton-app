// @vitest-environment jsdom
// @vitest-environment-options { "url": "http://localhost:3000/bpm" }
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import StringShelfCard from '../../components/admin/CommandCenter/StringShelfCard';
import { resetCatalogCache } from '../../components/stats/useCatalog';
import enMessages from '../../messages/en.json';

/**
 * One strings list (docs/plans/bench-redesign.md): each shelf string with
 * its price and what is left, and the stock bought or strung under a name the
 * shelf does not offer, which can be COUNTED as a shelf string (an alias)
 * without renaming anything.
 */

const line = (label: string, over: Record<string, unknown> = {}) => ({
  label, catalogId: null, setMetres: 10, purchasedMetres: 0, purchasedCostCents: 0, purchases: 0,
  usedSets: 0, usedMetres: 0, remainingMetres: 0, remainingSets: 0, costPerSetCents: null, usedCostCents: null, ...over,
});
const totals = { purchasedCostCents: 18900, usedSets: 0, usedCostCents: 0, remainingValueCents: 18900 };

function respond(opts: { strings?: unknown; stockOk?: boolean; stock?: Record<string, unknown> } = {}) {
  const patches: Array<Record<string, unknown>> = [];
  const shelf = { strings: ['BG80 Power-White', 'Li-Ning No. 1'], links: {}, prices: { 'BG80 Power-White': 3200 }, ...((opts.strings as object) ?? {}) };
  const stock = {
    lines: [
      line('BG80 Power-White', { purchases: 1, purchasedMetres: 200, remainingMetres: 200, remainingSets: 20, costPerSetCents: 900 }),
      line('Li-Ning No. 1'),
      line('Lining No.1', { purchases: 1, purchasedMetres: 200, remainingMetres: 200, remainingSets: 20, costPerSetCents: 945 }),
    ],
    unmatched: [{ label: 'BG80P', usedSets: 1 }],
    purchases: [],
    aliases: {},
    totals,
    ...(opts.stock ?? {}),
  };
  const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
    const u = String(url);
    if (u.includes('/catalog')) return Promise.resolve({ ok: true, json: async () => ({ items: [] }) } as Response);
    if (u.includes('/stock')) {
      if (opts.stockOk === false) return Promise.resolve({ ok: false, status: 503, json: async () => ({}) } as Response);
      return Promise.resolve({ ok: true, json: async () => stock } as Response);
    }
    if (u.includes('/strings') && init?.method === 'PATCH') {
      const body = JSON.parse(String(init.body));
      patches.push(body);
      return Promise.resolve({ ok: true, json: async () => body } as Response);
    }
    return Promise.resolve({ ok: true, json: async () => shelf } as Response);
  });
  vi.stubGlobal('fetch', fetchMock);
  return patches;
}

function wrap() {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <StringShelfCard />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  resetCatalogCache();
  vi.stubGlobal('navigator', { ...global.navigator, onLine: true });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('one row per shelf string', () => {
  it('carries the price and what is left, and says so when either is missing', async () => {
    respond();
    wrap();
    const bg = await screen.findByRole('button', { name: 'Open BG80 Power-White' });
    expect(within(bg).getByText('$32')).toBeDefined();
    expect(within(bg).getByText('20 sets left')).toBeDefined();
    const ln = screen.getByRole('button', { name: 'Open Li-Ning No. 1' });
    expect(within(ln).getByText('No price')).toBeDefined();
    expect(within(ln).getByText('No stock logged')).toBeDefined();
  });

  it('a failed stock read is an error, never a shelf with no stock', async () => {
    respond({ stockOk: false });
    wrap();
    expect(await screen.findByText(/Couldn't load your strings/)).toBeDefined();
    expect(screen.queryByText('No stock logged')).toBeNull();
    expect(screen.queryByRole('textbox', { name: 'Add a string' })).toBeNull();
  });

  it('sets a price from the string’s sheet', async () => {
    const patches = respond();
    wrap();
    fireEvent.click(await screen.findByRole('button', { name: 'Open Li-Ning No. 1' }));
    fireEvent.change(screen.getByLabelText('Restring price'), { target: { value: '30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(patches).toHaveLength(1));
    expect(patches[0].prices).toEqual({ 'BG80 Power-White': 3200, 'Li-Ning No. 1': 3000 });
  });

  it('takes two taps to remove a string from the shelf', async () => {
    const patches = respond();
    wrap();
    fireEvent.click(await screen.findByRole('button', { name: 'Open Li-Ning No. 1' }));
    fireEvent.click(screen.getByRole('button', { name: /Remove from shelf/ }));
    expect(patches).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(patches).toHaveLength(1));
    expect(patches[0].strings).toEqual(['BG80 Power-White']);
  });
});

describe('not on your shelf', () => {
  it('counts stock bought under another name as a shelf string, without renaming it', async () => {
    const patches = respond();
    wrap();
    fireEvent.click(await screen.findByRole('button', { name: 'Open Lining No.1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Li-Ning No. 1' }));
    await waitFor(() => expect(patches).toHaveLength(1));
    expect(patches[0].aliases).toEqual({ 'Lining No.1': 'Li-Ning No. 1' });
    // The list itself is untouched: nothing was renamed or added.
    expect(patches[0].strings).toEqual(['BG80 Power-White', 'Li-Ning No. 1']);
  });

  it('folds names only jobs used behind one row, and offers no "Offer it" for them', async () => {
    respond();
    wrap();
    const fold = await screen.findByRole('button', { name: /1 racket was strung with names not on your shelf/ });
    expect(screen.queryByRole('button', { name: 'Open BG80P' })).toBeNull();
    fireEvent.click(fold);
    fireEvent.click(await screen.findByRole('button', { name: 'Open BG80P' }));
    expect(await screen.findByText('Same string as')).toBeDefined();
    expect(screen.queryByRole('button', { name: /Offer it/ })).toBeNull();
  });
});
