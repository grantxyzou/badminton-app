// @vitest-environment jsdom
// @vitest-environment-options { "url": "http://localhost:3000/bpm" }
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import { MAX_OFFERED } from '../../lib/stringingLimits';
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
  label, catalogId: null, setMetres: 10, purchasedMetres: 0, purchasedCostCents: 0, purchases: 0, purchaseIds: [],
  usedSets: 0, usedMetres: 0, remainingMetres: 0, remainingSets: 0, costPerSetCents: null, usedCostCents: null, ...over,
});
const totals = { purchasedCostCents: 18900, usedSets: 0, usedCostCents: 0, remainingValueCents: 18900 };

function respond(opts: { strings?: unknown; stockOk?: boolean; stock?: Record<string, unknown>; patchOk?: boolean; catalog?: unknown[]; renameStatus?: number } = {}) {
  const patches: Array<Record<string, unknown>> = [];
  const deletes: string[] = [];
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
    if (u.includes('/catalog')) return Promise.resolve({ ok: true, json: async () => ({ items: opts.catalog ?? [] }) } as Response);
    if (u.includes('/stock') && init?.method === 'DELETE') {
      deletes.push(u);
      return Promise.resolve({ ok: true, json: async () => ({}) } as Response);
    }
    if (u.includes('/stock')) {
      if (opts.stockOk === false) return Promise.resolve({ ok: false, status: 503, json: async () => ({}) } as Response);
      return Promise.resolve({ ok: true, json: async () => stock } as Response);
    }
    if (u.includes('/strings') && init?.method === 'PATCH') {
      const body = JSON.parse(String(init.body));
      patches.push(body);
      if (opts.patchOk === false) return Promise.resolve({ ok: false, status: 503, json: async () => ({}) } as Response);
      if (body.rename && opts.renameStatus) {
        return Promise.resolve({ ok: false, status: opts.renameStatus, json: async () => ({ error: 'name_taken' }) } as Response);
      }
      if (body.rename) {
        // What the route answers: the list with the one name changed, its maps carried across.
        const { from, to } = body.rename as { from: string; to: string };
        const strings = shelf.strings.map((x: string) => (x === from ? to : x));
        return Promise.resolve({ ok: true, json: async () => ({ strings, links: {}, prices: {}, aliases: { [from]: to }, colours: {} }) } as Response);
      }
      return Promise.resolve({ ok: true, json: async () => body } as Response);
    }
    return Promise.resolve({ ok: true, json: async () => shelf } as Response);
  });
  vi.stubGlobal('fetch', fetchMock);
  return Object.assign(patches, { deletes });
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

describe('review fixes (docs/plans/bench-redesign.md)', () => {
  it('sends only the list and the map it changed, so another device’s aliases and links survive', async () => {
    const patches = respond();
    wrap();
    fireEvent.click(await screen.findByRole('button', { name: 'Open Li-Ning No. 1' }));
    fireEvent.change(screen.getByLabelText('Restring price'), { target: { value: '30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(patches).toHaveLength(1));
    expect(Object.keys(patches[0]).sort()).toEqual(['prices', 'strings']);
  });

  it('a linked string reads as matched even before the catalog has loaded, with no search to overwrite it', async () => {
    respond({ strings: { links: { 'Li-Ning No. 1': 'string-ln-no1' } } });
    wrap();
    fireEvent.click(await screen.findByRole('button', { name: 'Open Li-Ning No. 1' }));
    const sheet = screen.getByRole('dialog');
    expect(within(sheet).queryByText(/Not matched yet/)).toBeNull();
    expect(within(sheet).getByRole('img', { name: 'Matched in the catalog' })).toBeDefined();
    expect(within(sheet).queryByRole('textbox', { name: 'Search the catalog' })).toBeNull();
  });

  it('says so inside the sheet when a save fails', async () => {
    respond({ patchOk: false });
    wrap();
    fireEvent.click(await screen.findByRole('button', { name: 'Open Li-Ning No. 1' }));
    fireEvent.change(screen.getByLabelText('Restring price'), { target: { value: '30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    const sheet = screen.getByRole('dialog');
    expect(await within(sheet).findByText(/Couldn't save that/)).toBeDefined();
  });

  it('can set "Ask" on a string that has no price yet', async () => {
    const patches = respond();
    wrap();
    fireEvent.click(await screen.findByRole('button', { name: 'Open Li-Ning No. 1' }));
    const save = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    await waitFor(() => expect(patches).toHaveLength(1));
    expect((patches[0].prices as Record<string, unknown>)['Li-Ning No. 1']).toBeNull();
  });

  it('keeps what was typed when the shelf is full', async () => {
    const full = Array.from({ length: MAX_OFFERED }, (_, i) => `String ${i + 1}`);
    const patches = respond({ strings: { strings: full, prices: {} } });
    wrap();
    const box = (await screen.findByRole('textbox', { name: 'Add a string' })) as HTMLInputElement;
    fireEvent.change(box, { target: { value: 'One more' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(box.value).toBe('One more');
    expect(patches).toHaveLength(0);
    expect(screen.getByText(/Your shelf is full/)).toBeDefined();
  });

  it('lists the purchases on an off-shelf line, with their notes, so they can be deleted', async () => {
    respond({
      stock: {
        lines: [
          line('BG80 Power-White', { purchases: 1, purchasedMetres: 200, remainingMetres: 200, remainingSets: 20, purchaseIds: ['sp-a'] }),
          line('Li-Ning No. 1', { purchaseIds: [] }),
          line('Lining No.1', { purchases: 1, purchasedMetres: 200, remainingMetres: 200, remainingSets: 20, purchaseIds: ['sp-b'] }),
        ],
        purchases: [
          { id: 'sp-a', kind: 'stringPurchase', label: 'BG80 Power-White', unit: 'reel', units: 1, metresPerUnit: 200, totalCostCents: 18000, date: '2026-10-01', createdAt: '2026-10-01T00:00:00Z', createdBy: 'g' },
          { id: 'sp-b', kind: 'stringPurchase', label: 'Lining No.1', unit: 'reel', units: 1, metresPerUnit: 200, totalCostCents: 18900, date: '2026-10-01', createdAt: '2026-10-01T00:00:00Z', createdBy: 'g', notes: 'from the club shop' },
        ],
      },
    });
    wrap();
    fireEvent.click(await screen.findByRole('button', { name: 'Open Lining No.1' }));
    const sheet = screen.getByRole('dialog');
    expect(within(sheet).getByText(/from the club shop/)).toBeDefined();
    expect(within(sheet).queryByRole('button', { name: /Delete the purchase from/ })).toBeNull();
    fireEvent.click(within(sheet).getByRole('button', { name: /More for the purchase from/ }));
    expect(within(sheet).getByRole('button', { name: /Delete the purchase from/ })).toBeDefined();
  });
});

/** The footer's one Save. */
const saveButton = () => within(screen.getByRole('dialog')).getByRole('button', { name: 'Save' }) as HTMLButtonElement;

const BG80 = { id: 'string-yonex-bg80', category: 'string', brand: 'Yonex', model: 'BG80', attributes: { stringType: 'repulsion' } };
const stocked = (over: Record<string, unknown> = {}) => ({
  stock: {
    lines: [
      line('BG80 Power-White', {
        purchases: 1, purchasedMetres: 200, remainingMetres: 190, remainingSets: 19, usedSets: 1, usedMetres: 10,
        costPerSetCents: 600, purchaseIds: ['sp-a'], ...over,
      }),
      line('Li-Ning No. 1'),
    ],
    purchases: [
      { id: 'sp-a', kind: 'stringPurchase', label: 'BG80 Power-White', unit: 'reel', units: 1, metresPerUnit: 200, totalCostCents: 12000, date: '2026-10-01', color: 'white', createdAt: '2026-10-01T00:00:00Z', createdBy: 'g' },
    ],
  },
});

describe('a string on the shelf · rethought', () => {
  it('names the catalog match in the header, with its type, in place of a Catalog section', async () => {
    respond({ strings: { links: { 'BG80 Power-White': BG80.id } }, catalog: [BG80] });
    wrap();
    fireEvent.click(await screen.findByRole('button', { name: 'Open BG80 Power-White' }));
    const sheet = screen.getByRole('dialog');
    const catalogLine = await within(sheet).findByTestId('shelf-catalog-line');
    await waitFor(() => expect(catalogLine.textContent).toContain('Yonex BG80 · Power'));
    expect(within(catalogLine).getByRole('img', { name: 'Matched in the catalog' })).toBeDefined();
    expect(within(sheet).queryByText('Catalog')).toBeNull();
  });

  it('leads with what is left, the metres, what a set costs and what it earns', async () => {
    respond(stocked());
    wrap();
    fireEvent.click(await screen.findByRole('button', { name: 'Open BG80 Power-White' }));
    const stock = within(screen.getByRole('dialog')).getByTestId('shelf-stock');
    expect(within(stock).getByText('19')).toBeDefined();
    expect(within(stock).getByText('sets left')).toBeDefined();
    expect(within(stock).getByText('190 of 200 m')).toBeDefined();
    expect(within(stock).getByRole('progressbar').getAttribute('aria-valuenow')).toBe('190');
    expect(within(stock).getByText('1 used · costs you $6 a set')).toBeDefined();
    // $32 a restring, $6 a set of string.
    expect(within(stock).getByText('You make $26 a set')).toBeDefined();
  });

  it('says a loss plainly, and nothing about margin without a price', async () => {
    respond({ ...stocked(), strings: { prices: { 'BG80 Power-White': 500 } } });
    wrap();
    fireEvent.click(await screen.findByRole('button', { name: 'Open BG80 Power-White' }));
    expect(within(screen.getByTestId('shelf-stock')).getByText('You lose $1 a set')).toBeDefined();
    cleanup();
    respond({ ...stocked(), strings: { prices: {} } });
    wrap();
    fireEvent.click(await screen.findByRole('button', { name: 'Open BG80 Power-White' }));
    expect(within(screen.getByTestId('shelf-stock')).queryByText(/You make|You lose/)).toBeNull();
  });

  it('says "No stock logged" in the stock block when nothing was bought', async () => {
    respond();
    wrap();
    fireEvent.click(await screen.findByRole('button', { name: 'Open Li-Ning No. 1' }));
    expect(within(screen.getByTestId('shelf-stock')).getByText('No stock logged')).toBeDefined();
  });

  it('has one Save, pinned in the footer, and no per-field save buttons', async () => {
    respond();
    wrap();
    fireEvent.click(await screen.findByRole('button', { name: 'Open BG80 Power-White' }));
    const sheet = screen.getByRole('dialog');
    expect(within(sheet).getAllByRole('button', { name: 'Save' })).toHaveLength(1);
    expect(saveButton().closest('.bottom-sheet-footer')).not.toBeNull();
    for (const name of ['Rename', 'Save colours', 'Save note']) {
      expect(within(sheet).queryByRole('button', { name })).toBeNull();
    }
    expect(within(sheet).getByText('Renaming keeps every job and purchase under the old name with this string.')).toBeDefined();
  });

  it('keeps Save off until something changes, and off again once it is put back', async () => {
    const patches = respond();
    wrap();
    fireEvent.click(await screen.findByRole('button', { name: 'Open BG80 Power-White' }));
    expect(saveButton().disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Note for players'), { target: { value: 'Hard hitters.' } });
    expect(saveButton().disabled).toBe(false);
    fireEvent.change(screen.getByLabelText('Note for players'), { target: { value: '' } });
    expect(saveButton().disabled).toBe(true);
    expect(patches).toHaveLength(0);
  });

  it('saves price, note and colours in one PATCH that carries only the maps it changed', async () => {
    const patches = respond({ strings: { notes: { 'Li-Ning No. 1': 'Control.' } } });
    wrap();
    fireEvent.click(await screen.findByRole('button', { name: 'Open BG80 Power-White' }));
    fireEvent.change(screen.getByLabelText('Restring price'), { target: { value: '34' } });
    fireEvent.change(screen.getByLabelText('Note for players'), { target: { value: '  Hard hitters: 26 lb.  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Edit the colours on the reel' }));
    fireEvent.click(screen.getByRole('checkbox', { name: /White/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    fireEvent.click(saveButton());
    await waitFor(() => expect(patches).toHaveLength(1));
    expect(Object.keys(patches[0]).sort()).toEqual(['colours', 'notes', 'prices', 'strings']);
    expect(patches[0].prices).toEqual({ 'BG80 Power-White': 3400 });
    // Trimmed, and the other string's note sent back as it was.
    expect(patches[0].notes).toEqual({ 'Li-Ning No. 1': 'Control.', 'BG80 Power-White': 'Hard hitters: 26 lb.' });
    expect(patches[0].colours).toEqual({ 'BG80 Power-White': ['white'] });
    // Saved: the sheet closes.
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('emptying the note deletes it', async () => {
    const patches = respond({ strings: { notes: { 'BG80 Power-White': 'Hard hitters.', 'Li-Ning No. 1': 'Control.' } } });
    wrap();
    fireEvent.click(await screen.findByRole('button', { name: 'Open BG80 Power-White' }));
    const field = screen.getByLabelText('Note for players') as HTMLTextAreaElement;
    expect(field.value).toBe('Hard hitters.');
    fireEvent.change(field, { target: { value: '   ' } });
    fireEvent.click(saveButton());
    await waitFor(() => expect(patches).toHaveLength(1));
    expect(patches[0].notes).toEqual({ 'Li-Ning No. 1': 'Control.' });
    expect(patches[0].prices).toBeUndefined();
  });

  it('renames FIRST, then saves the rest under the new name, and the list follows', async () => {
    const patches = respond();
    wrap();
    fireEvent.click(await screen.findByRole('button', { name: 'Open BG80 Power-White' }));
    const name = screen.getByLabelText('Name on the shelf') as HTMLInputElement;
    expect(name.value).toBe('BG80 Power-White');
    fireEvent.change(name, { target: { value: 'BG80 Power' } });
    fireEvent.change(screen.getByLabelText('Restring price'), { target: { value: '30' } });
    fireEvent.click(saveButton());
    await waitFor(() => expect(patches).toHaveLength(2));
    expect(patches[0]).toEqual({ rename: { from: 'BG80 Power-White', to: 'BG80 Power' } });
    expect(patches[1].strings).toEqual(['BG80 Power', 'Li-Ning No. 1']);
    expect(patches[1].prices).toEqual({ 'BG80 Power': 3000 });
    expect(await screen.findByRole('button', { name: 'Open BG80 Power' })).toBeDefined();
  });

  it('a rename alone is one PATCH', async () => {
    const patches = respond();
    wrap();
    fireEvent.click(await screen.findByRole('button', { name: 'Open BG80 Power-White' }));
    fireEvent.change(screen.getByLabelText('Name on the shelf'), { target: { value: 'BG80 Power' } });
    fireEvent.click(saveButton());
    expect(await screen.findByRole('button', { name: 'Open BG80 Power' })).toBeDefined();
    expect([...patches]).toEqual([{ rename: { from: 'BG80 Power-White', to: 'BG80 Power' } }]);
  });

  it('will not rename onto another shelf string’s name', async () => {
    const patches = respond();
    wrap();
    fireEvent.click(await screen.findByRole('button', { name: 'Open BG80 Power-White' }));
    fireEvent.change(screen.getByLabelText('Name on the shelf'), { target: { value: 'li-ning no. 1' } });
    expect(screen.getByRole('alert').textContent).toContain('already has that name');
    expect(saveButton().disabled).toBe(true);
    expect(patches).toHaveLength(0);
  });

  it('a name the server refuses is said in the sheet, and nothing else is sent', async () => {
    const patches = respond({ renameStatus: 409 });
    wrap();
    fireEvent.click(await screen.findByRole('button', { name: 'Open BG80 Power-White' }));
    fireEvent.change(screen.getByLabelText('Name on the shelf'), { target: { value: 'BG80 Power' } });
    fireEvent.change(screen.getByLabelText('Restring price'), { target: { value: '30' } });
    fireEvent.click(saveButton());
    expect(await screen.findByText(/already has that name/)).toBeDefined();
    expect(patches).toHaveLength(1);
    // The edits are kept.
    expect((screen.getByLabelText('Restring price') as HTMLInputElement).value).toBe('30');
  });

  it('a failed save is said in the footer, above Save, and keeps the edits', async () => {
    respond({ patchOk: false });
    wrap();
    fireEvent.click(await screen.findByRole('button', { name: 'Open BG80 Power-White' }));
    fireEvent.change(screen.getByLabelText('Note for players'), { target: { value: 'Hard hitters.' } });
    fireEvent.click(saveButton());
    const error = await within(screen.getByRole('dialog')).findByText(/Couldn't save that/);
    expect(error.closest('.bottom-sheet-footer')).not.toBeNull();
    expect((screen.getByLabelText('Note for players') as HTMLTextAreaElement).value).toBe('Hard hitters.');
  });
});

describe('colours on the reel', () => {
  it('opens a picker from Edit, toggles, comes back with Done, and Save sends the colours', async () => {
    const patches = respond();
    wrap();
    fireEvent.click(await screen.findByRole('button', { name: 'Open BG80 Power-White' }));
    expect(screen.getByText("None picked: players see the maker's colours")).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Edit the colours on the reel' }));

    const picker = screen.getByRole('group', { name: 'Other colours' });
    expect(screen.getByText('0 picked')).toBeDefined();
    expect(screen.getByText("Pick none to fall back to the maker's colours.")).toBeDefined();
    fireEvent.click(within(picker).getByRole('checkbox', { name: /Yellow/ }));
    fireEvent.click(within(picker).getByRole('checkbox', { name: /White/ }));
    expect(within(picker).getByRole('checkbox', { name: /White/ }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByText('2 picked')).toBeDefined();
    // Nothing is saved by picking.
    expect(patches).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));

    // Back on the sheet, palette order whatever order they were tapped in.
    expect(screen.getByText('White, Yellow')).toBeDefined();
    fireEvent.click(saveButton());
    await waitFor(() => expect(patches).toHaveLength(1));
    expect(patches[0].colours).toEqual({ 'BG80 Power-White': ['white', 'yellow'] });
    expect(patches[0].prices).toBeUndefined();
  });

  it('the back chevron returns too, and unpicking everything clears the string’s colours', async () => {
    const patches = respond({ strings: { colours: { 'BG80 Power-White': ['white'], 'Li-Ning No. 1': ['red'] } } });
    wrap();
    fireEvent.click(await screen.findByRole('button', { name: 'Open BG80 Power-White' }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit the colours on the reel' }));
    fireEvent.click(screen.getByRole('checkbox', { name: /White/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    fireEvent.click(saveButton());
    await waitFor(() => expect(patches).toHaveLength(1));
    expect(patches[0].colours).toEqual({ 'Li-Ning No. 1': ['red'] });
  });
});

describe('the reel-colour picker: the maker\'s, two-colour sets, your own (2026-11-12)', () => {
  const BG80_COLOURS = { ...BG80, attributes: { stringType: 'repulsion', colors: 'White; Blue; Yellow' } };
  const AEROBITE = { id: 'string-yonex-aerobite', category: 'string', brand: 'Yonex', model: 'Aerobite', attributes: { colors: 'Red/White' } };
  const openPicker = async (label = 'BG80 Power-White') => {
    fireEvent.click(await screen.findByRole('button', { name: `Open ${label}` }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit the colours on the reel' }));
  };

  it('lists the maker\'s colours first, then the sets, then the rest, each three across', async () => {
    respond({ strings: { links: { 'BG80 Power-White': BG80_COLOURS.id } }, catalog: [BG80_COLOURS] });
    wrap();
    await openPicker();
    const maker = await screen.findByRole('group', { name: 'Yonex makes BG80 in' });
    const sections = screen.getAllByRole('group').map((g) => g.getAttribute('aria-label'));
    expect(sections).toEqual(['Yonex makes BG80 in', 'Two-colour sets', 'Other colours']);
    expect(within(maker).getAllByRole('checkbox').map((b) => b.getAttribute('aria-label'))).toEqual(['White', 'Blue', 'Yellow']);
    expect((maker as HTMLElement).style.gridTemplateColumns).toBe('repeat(3, minmax(0, 1fr))');
    const other = screen.getByRole('group', { name: 'Other colours' });
    const otherNames = within(other).getAllByRole('checkbox').map((b) => b.getAttribute('aria-label'));
    // The maker's are not repeated, and the long name fits a tile's one line.
    expect(otherNames).not.toContain('White');
    expect(within(other).getByRole('checkbox', { name: 'Fluorescent yellow' }).textContent).toBe('Fl. yellow');
    expect(within(other).getByRole('button', { name: 'Custom colour' })).toBeDefined();
    expect(within(screen.getByRole('group', { name: 'Two-colour sets' })).getByRole('button', { name: 'New combo' })).toBeDefined();
    expect(screen.getByText('Mains one colour, crosses another. M mains, C crosses; mains are named first.')).toBeDefined();
  });

  it('offers a hybrid\'s set from the maker, split M / C, and saves it as one colour', async () => {
    const patches = respond({ strings: { links: { 'BG80 Power-White': AEROBITE.id } }, catalog: [AEROBITE] });
    wrap();
    await openPicker();
    await screen.findByRole('checkbox', { name: 'Red / White' });
    // Only sets from this maker: no single-colour section to show.
    expect(screen.queryByRole('group', { name: /makes/ })).toBeNull();
    const set = within(screen.getByRole('group', { name: 'Two-colour sets' })).getByRole('checkbox', { name: 'Red / White' });
    const swatch = set.querySelector('[data-swatch="combo"]') as HTMLElement;
    expect(swatch.textContent).toBe('MC');
    fireEvent.click(set);
    expect(set.getAttribute('aria-checked')).toBe('true');
    // A set shows it is picked by the tile's tint, never a check over its letters.
    expect(within(set).queryByText('check')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.getByText('Red / White')).toBeDefined();
    fireEvent.click(saveButton());
    await waitFor(() => expect(patches).toHaveLength(1));
    expect(patches[0].colours).toEqual({ 'BG80 Power-White': ['combo:red+white'] });
  });

  it('makes a new set, mains then crosses, and offers the club\'s sets on another string', async () => {
    const patches = respond({ strings: { colours: { 'Li-Ning No. 1': ['combo:blue+yellow'] } } });
    wrap();
    await openPicker();
    // Li-Ning's set is the club's: offered here too.
    expect(within(screen.getByRole('group', { name: 'Two-colour sets' })).getByRole('checkbox', { name: 'Blue / Yellow' })).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'New combo' }));
    expect(screen.getByRole('button', { name: 'Add set' })).toHaveProperty('disabled', true);
    fireEvent.click(within(screen.getByRole('radiogroup', { name: 'Mains' })).getByRole('radio', { name: /Navy/ }));
    fireEvent.click(within(screen.getByRole('radiogroup', { name: 'Crosses' })).getByRole('radio', { name: /Navy/ }));
    expect(screen.getByTestId('combo-preview-name').textContent).toBe('Mains and crosses need two different colours.');
    expect(screen.getByRole('button', { name: 'Add set' })).toHaveProperty('disabled', true);
    fireEvent.click(within(screen.getByRole('radiogroup', { name: 'Crosses' })).getByRole('radio', { name: /Gold/ }));
    expect(screen.getByTestId('combo-preview-name').textContent).toBe('Navy / Gold');
    fireEvent.click(screen.getByRole('button', { name: 'Add set' }));
    expect(screen.getByRole('checkbox', { name: 'Navy / Gold' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByText('1 picked')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    fireEvent.click(saveButton());
    await waitFor(() => expect(patches).toHaveLength(1));
    expect(patches[0].colours).toEqual({ 'BG80 Power-White': ['combo:navy+gold'], 'Li-Ning No. 1': ['combo:blue+yellow'] });
    expect(patches[0]).not.toHaveProperty('addColours');
  });

  it('adds a colour of the club\'s own, held until Save, and sends its definition with the list', async () => {
    const patches = respond();
    wrap();
    await openPicker();
    fireEvent.click(screen.getByRole('button', { name: 'Custom colour' }));
    expect(screen.getByText('How it shows to players: a swatch and the name you give it.')).toBeDefined();
    expect(screen.getByText("It joins this string's reel only. Stock counts it like any other colour.")).toBeDefined();
    const add = screen.getByRole('button', { name: 'Add colour' });
    expect(add).toHaveProperty('disabled', true);
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Mint' } });
    fireEvent.change(screen.getByLabelText('Hex'), { target: { value: '#12' } });
    expect(screen.getByRole('alert').textContent).toBe('Use a hex colour like #14B8A6.');
    expect(add).toHaveProperty('disabled', true);
    fireEvent.click(screen.getByRole('button', { name: 'Use #84CC16' }));
    expect((screen.getByLabelText('Hex') as HTMLInputElement).value).toBe('#84CC16');
    expect(screen.getByTestId('custom-preview').style.background).toBe('rgb(132, 204, 22)');
    expect(add).toHaveProperty('disabled', false);
    fireEvent.click(add);
    // Back on the picker, picked, under "Other colours" by its name alone.
    const tile = within(screen.getByRole('group', { name: 'Other colours' })).getByRole('checkbox', { name: 'Mint' });
    expect(tile.getAttribute('aria-checked')).toBe('true');
    expect(tile.querySelector('.fs-xs')?.textContent).toBe('Mint');
    expect(patches).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    fireEvent.click(saveButton());
    await waitFor(() => expect(patches).toHaveLength(1));
    expect(patches[0].colours).toEqual({ 'BG80 Power-White': ['custom:84cc16'] });
    expect(patches[0].addColours).toEqual([{ name: 'Mint', hex: '#84cc16' }]);
  });

  it('refuses a name or a colour the club already has, and a palette colour\'s name', async () => {
    respond({ strings: { customColours: [{ id: 'custom:14b8a6', name: 'Teal', hex: '#14b8a6' }] } });
    wrap();
    await openPicker();
    fireEvent.click(screen.getByRole('button', { name: 'Custom colour' }));
    const add = screen.getByRole('button', { name: 'Add colour' });
    // The first quick pick IS the club's Teal.
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Sea' } });
    expect(screen.getByRole('alert').textContent).toBe('The club already has this exact colour: Teal.');
    fireEvent.change(screen.getByLabelText('Hex'), { target: { value: '#123456' } });
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'teal' } });
    expect(screen.getByRole('alert').textContent).toBe('The club already has a colour called that.');
    expect(add).toHaveProperty('disabled', true);
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Navy' } });
    expect(screen.getByRole('alert').textContent).toMatch(/^Give it a name of up to 30 characters/);
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Ink' } });
    expect(add).toHaveProperty('disabled', false);
  });

  it('stops at the most a string can list', async () => {
    respond({ strings: { colours: { 'BG80 Power-White': ['white', 'yellow', 'gold', 'orange', 'red', 'pink', 'purple', 'blue'] } } });
    wrap();
    await openPicker();
    expect(screen.getByText('8 colours is the most one string can list.')).toBeDefined();
    expect(screen.getByRole('checkbox', { name: 'Navy' })).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: 'New combo' })).toHaveProperty('disabled', true);
    // Unpicking is always allowed.
    expect(screen.getByRole('checkbox', { name: 'White' })).toHaveProperty('disabled', false);
  });
});

describe('purchases and Remove still act at once', () => {
  it('lists each purchase with its size, cost, day and colour, and deletes one from its ⋯', async () => {
    const calls = respond(stocked());
    wrap();
    fireEvent.click(await screen.findByRole('button', { name: 'Open BG80 Power-White' }));
    const sheet = screen.getByRole('dialog');
    expect(within(sheet).getByText('1 reel × 200 m · $120')).toBeDefined();
    expect(within(sheet).getByText(/Oct 1, 2026 · White/)).toBeDefined();
    fireEvent.click(within(sheet).getByRole('button', { name: /More for the purchase from/ }));
    fireEvent.click(within(sheet).getByRole('button', { name: /Delete the purchase from/ }));
    await waitFor(() => expect(calls.deletes).toHaveLength(1));
    expect(calls.deletes[0]).toContain('id=sp-a');
    expect(calls).toHaveLength(0);
  });

  it('opens the purchase flow from "Log a purchase"', async () => {
    respond();
    wrap();
    fireEvent.click(await screen.findByRole('button', { name: 'Open BG80 Power-White' }));
    fireEvent.click(screen.getByRole('button', { name: /Log a purchase/ }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Log purchase' })).toBeDefined());
  });
});
