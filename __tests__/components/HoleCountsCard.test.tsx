// @vitest-environment jsdom
// @vitest-environment-options { "url": "http://localhost:3000/bpm" }
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import HoleCountsCard from '../../components/admin/CommandCenter/HoleCountsCard';
import { resetCatalogCache } from '../../components/stats/useCatalog';
import enMessages from '../../messages/en.json';
import seed from '../../scripts/data/equipment-catalog.json';

/**
 * The bench's "String holes" card (docs/plans/grommet-holes.md, Phase 3):
 * search lists only rackets no maker or pattern answers for, a count saves
 * with one PUT, and a saved count can be removed.
 */
const rackets = (seed as { items: Array<{ category: string }> }).items.filter((i) => i.category === 'racket');

function respond(counts: Record<string, number>, ok = true) {
  const writes: Array<{ method: string; url: string; body?: unknown }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes('/api/equipment/catalog')) {
        return Promise.resolve({ ok: true, json: async () => ({ items: rackets }) } as Response);
      }
      if (init?.method === 'PUT' || init?.method === 'DELETE') {
        writes.push({ method: init.method, url, body: init.body ? JSON.parse(String(init.body)) : undefined });
        return Promise.resolve({ ok: true, json: async () => ({ ok: true }) } as Response);
      }
      return Promise.resolve({ ok, status: ok ? 200 : 503, json: async () => ({ counts }) } as Response);
    }),
  );
  return writes;
}

const wrap = () =>
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <HoleCountsCard />
    </NextIntlClientProvider>,
  );

beforeEach(() => {
  resetCatalogCache();
  vi.stubGlobal('navigator', { ...global.navigator, onLine: true });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('hole counts card', () => {
  it('searches only rackets with no sourced count, and saves a count', async () => {
    const writes = respond({});
    wrap();
    const search = await screen.findByLabelText('Add a count');
    // Yonex Astrox 100ZZ has its count from Yonex's pattern sheet: not offered.
    fireEvent.change(search, { target: { value: 'astrox 100zz' } });
    expect(await screen.findByText('No racket without a count matches that.')).toBeDefined();
    fireEvent.change(search, { target: { value: 'axforce 80' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Li-Ning AxForce 80' }));
    const input = screen.getByLabelText('Holes on the Li-Ning AxForce 80');
    fireEvent.change(input, { target: { value: '120' } });
    expect(screen.getByRole('alert').textContent).toContain('between 60 and 100');
    fireEvent.change(input, { target: { value: '76' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(writes).toEqual([{ method: 'PUT', url: expect.stringContaining('/api/stringing/holes'), body: { catalogId: 'racket-li-ning-axforce-80', holes: 76 } }]));
    expect(await screen.findByText('76 holes')).toBeDefined();
  });

  it('lists the counts and removes one', async () => {
    const writes = respond({ 'racket-li-ning-axforce-80': 72 });
    wrap();
    expect(await screen.findByText('72 holes')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Remove the count for AxForce 80' }));
    await waitFor(() => expect(writes[0]).toMatchObject({ method: 'DELETE', url: expect.stringContaining('catalogId=racket-li-ning-axforce-80') }));
    await waitFor(() => expect(screen.queryByText('72 holes')).toBeNull());
  });

  it('a failed read is an error, never an empty list', async () => {
    respond({}, false);
    wrap();
    expect(await screen.findByText(/Couldn't load your hole counts/)).toBeDefined();
  });
});
