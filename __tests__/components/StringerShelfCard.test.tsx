// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import enMessages from '@/messages/en.json';
import StringerShelfCard from '@/components/stringing/StringerShelfCard';
import { resetCatalogCache } from '@/components/stats/useCatalog';

/**
 * A stringer's shelf card (docs/plans/stringer-shelf-edits.md): the strings
 * with their reel colours, and a sheet that saves a name and colours together.
 */
beforeEach(() => {
  resetCatalogCache();
  vi.stubGlobal('navigator', { ...global.navigator, onLine: true });
});

/** Open the reel-colour step, tick these, and come back with Done. */
function pickColours(...names: RegExp[]) {
  fireEvent.click(screen.getByRole('button', { name: 'Edit the colours on the reel' }));
  for (const name of names) fireEvent.click(screen.getByRole('checkbox', { name }));
  fireEvent.click(screen.getByRole('button', { name: 'Done' }));
}
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

type Call = { method: string; body: unknown };

function mockApi(patchAnswer?: (body: Record<string, unknown>) => Response) {
  const calls: Call[] = [];
  let shelf = { strings: ['BG80', 'Aerobite'], colours: { BG80: ['white'] } as Record<string, string[]> };
  vi.stubGlobal('fetch', vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, body });
    if (method === 'GET') return Promise.resolve(new Response(JSON.stringify({ ...shelf, links: {}, prices: {}, stock: {}, players: {} })));
    if (patchAnswer) return Promise.resolve(patchAnswer(body));
    if (body.rename) {
      const { from, to } = body.rename;
      shelf = { strings: shelf.strings.map((s) => (s === from ? to : s)), colours: Object.fromEntries(Object.entries(shelf.colours).map(([k, v]) => [k === from ? to : k, v])) };
    }
    if (body.colours) shelf = { ...shelf, colours: { ...shelf.colours, ...body.colours } };
    return Promise.resolve(new Response(JSON.stringify(shelf)));
  }));
  return calls;
}

const wrap = () => render(
  <NextIntlClientProvider locale="en" messages={enMessages}>
    <StringerShelfCard hasIdentity />
  </NextIntlClientProvider>,
);

describe('<StringerShelfCard />', () => {
  it('lists the strings, saying which have no colours yet', async () => {
    mockApi();
    wrap();
    expect(await screen.findByRole('button', { name: 'Edit BG80' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Edit Aerobite' }).textContent).toContain('No colours set');
  });

  it('saves a new name first, then the colours under the new name', async () => {
    const calls = mockApi();
    wrap();
    fireEvent.click(await screen.findByRole('button', { name: 'Edit BG80' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'BG80 white' } });
    pickColours(/^Yellow$/);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const patches = calls.filter((c) => c.method === 'PATCH').map((c) => c.body);
    expect(patches).toEqual([
      { rename: { from: 'BG80', to: 'BG80 white' } },
      { colours: { 'BG80 white': ['white', 'yellow'] } },
    ]);
    expect(await screen.findByRole('button', { name: 'Edit BG80 white' })).toBeDefined();
  });

  it('sends only the colours when the name is unchanged, and Save waits for a change', async () => {
    const calls = mockApi();
    wrap();
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Aerobite' }));
    const save = screen.getByRole('button', { name: 'Save' });
    expect(save).toHaveProperty('disabled', true);
    pickColours(/^Red$/);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(1));
    expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ colours: { Aerobite: ['red'] } });
  });

  it('refuses a name another string has before asking, and says the server’s refusal in words', async () => {
    mockApi(() => new Response(JSON.stringify({ error: 'forbidden_field' }), { status: 403 }));
    wrap();
    fireEvent.click(await screen.findByRole('button', { name: 'Edit BG80' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'aerobite' } });
    expect(screen.getByRole('alert').textContent).toBe('Another string on the shelf already has that name.');
    expect(screen.getByRole('button', { name: 'Save' })).toHaveProperty('disabled', true);
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'BG80 new' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect((await screen.findByRole('alert')).textContent).toBe("You can't change the strings any more. Ask an admin.");
  });

  it('picks on the admin\'s picker: the maker\'s colours first, a new two-colour set, and no "Custom colour"', async () => {
    const calls: Call[] = [];
    const aerobite = { id: 'string-yx-aerobite', category: 'string', brand: 'Yonex', model: 'Aerobite', attributes: { colors: 'Red/White' } };
    const bg80 = { id: 'string-yx-bg80', category: 'string', brand: 'Yonex', model: 'BG80', attributes: { colors: 'White; Blue; Yellow' } };
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ method, body });
      if (String(url).includes('/catalog')) return Promise.resolve(new Response(JSON.stringify({ items: [aerobite, bg80] })));
      const shelf = {
        strings: ['BG80', 'Aerobite'],
        links: { BG80: bg80.id, Aerobite: aerobite.id },
        colours: { BG80: ['white', 'custom:14b8a6'], ...(body?.colours ?? {}) },
        customColours: [{ id: 'custom:14b8a6', name: 'Teal', hex: '#14b8a6' }],
      };
      return Promise.resolve(new Response(JSON.stringify(shelf)));
    }));
    wrap();
    // The club's own colour reads by its name on the row.
    expect((await screen.findByRole('img', { name: 'Colours: White, Teal' }))).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Edit BG80' }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit the colours on the reel' }));
    const maker = await screen.findByRole('group', { name: 'Yonex makes BG80 in' });
    expect(within(maker).getAllByRole('checkbox').map((b) => b.getAttribute('aria-label'))).toEqual(['White', 'Blue', 'Yellow']);
    // The club's colour is offered under "Other colours", and no stringer may name a new one.
    expect(within(screen.getByRole('group', { name: 'Other colours' })).getByRole('checkbox', { name: 'Teal' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.queryByRole('button', { name: 'Custom colour' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'New combo' }));
    fireEvent.click(within(screen.getByRole('radiogroup', { name: 'Mains' })).getByRole('radio', { name: /Red/ }));
    fireEvent.click(within(screen.getByRole('radiogroup', { name: 'Crosses' })).getByRole('radio', { name: /Teal/ }));
    expect(screen.getByTestId('combo-preview-name').textContent).toBe('Red / Teal');
    fireEvent.click(screen.getByRole('button', { name: 'Add set' }));
    expect(screen.getByRole('checkbox', { name: 'Red / Teal' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(1));
    expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ colours: { BG80: ['white', 'custom:14b8a6', 'combo:red+custom:14b8a6'] } });
  });

  it('a failed list read says so, with Try again, never an empty shelf', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 503 })));
    wrap();
    expect((await screen.findByRole('alert')).textContent).toContain("Couldn't load the strings.");
    expect(screen.queryByText('No strings are listed yet. An admin adds them on the bench.')).toBeNull();
  });
});
