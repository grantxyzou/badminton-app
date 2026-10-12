// @vitest-environment jsdom
// @vitest-environment-options { "url": "http://localhost:3000/bpm" }
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import OtherPricesCard from '../../components/admin/CommandCenter/OtherPricesCard';
import enMessages from '../../messages/en.json';

/**
 * What is left of the rate card (docs/plans/bench-redesign.md, PR 2): the
 * own-string price and a note. The old list is no longer shown to players,
 * and while it still holds lines the card says so, with a way to clear it.
 */
function respond(stored: Record<string, unknown>, ok = true) {
  const patches: Array<Record<string, unknown>> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      if (init?.method === 'PATCH') {
        const body = JSON.parse(String(init.body));
        patches.push(body);
        return Promise.resolve({ ok: true, json: async () => ({ ...stored, ...body }) } as Response);
      }
      return Promise.resolve({ ok, status: ok ? 200 : 503, json: async () => stored } as Response);
    }),
  );
  return patches;
}

function wrap() {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <OtherPricesCard />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  vi.stubGlobal('navigator', { ...global.navigator, onLine: true });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('other prices', () => {
  it('saves the own-string price and the note together', async () => {
    const patches = respond({ services: [], ownStringCents: null, note: '' });
    wrap();
    const own = await screen.findByLabelText('Bring your own string');
    await waitFor(() => expect((own as HTMLInputElement).disabled).toBe(false));
    fireEvent.change(own, { target: { value: '15' } });
    fireEvent.change(screen.getByLabelText('Note for players'), { target: { value: ' New prices ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(patches).toEqual([{ ownStringCents: 1500, note: 'New prices' }]));
  });

  it('says the old list is no longer shown, and clears it on request', async () => {
    const patches = respond({ services: [{ label: 'Labour + Strings', priceCents: 3000 }], ownStringCents: null, note: '' });
    wrap();
    expect(await screen.findByText(/Your old price list \(1 line\) is no longer shown to players/)).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Clear the old list' }));
    await waitFor(() => expect(patches).toEqual([{ services: [] }]));
  });

  it('a failed read is an error, never an empty card', async () => {
    respond({}, false);
    wrap();
    expect(await screen.findByText(/Couldn't load your prices/)).toBeDefined();
    expect(screen.queryByLabelText('Bring your own string')).toBeNull();
  });
});
