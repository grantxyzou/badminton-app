// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import enMessages from '@/messages/en.json';
import StringerShelfCard from '@/components/stringing/StringerShelfCard';

/**
 * A stringer's shelf card (docs/plans/stringer-shelf-edits.md): the strings
 * with their reel colours, and a sheet that saves a name and colours together.
 */
beforeEach(() => {
  vi.stubGlobal('navigator', { ...global.navigator, onLine: true });
});
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
    fireEvent.click(screen.getByRole('button', { name: /Yellow/ }));
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
    fireEvent.click(screen.getByRole('button', { name: /Red/ }));
    fireEvent.click(save);
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

  it('a failed list read says so, with Try again, never an empty shelf', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 503 })));
    wrap();
    expect((await screen.findByRole('alert')).textContent).toContain("Couldn't load the strings.");
    expect(screen.queryByText('No strings are listed yet. An admin adds them on the bench.')).toBeNull();
  });
});
