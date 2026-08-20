// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import GearRail from '../../components/stats/GearRail';
import enMessages from '../../messages/en.json';

function jsonResponse(body: unknown, ok = true) {
  return Promise.resolve({ ok, status: ok ? 200 : 500, json: async () => body } as Response);
}

function mockFetch(opts: { stringItems?: unknown[]; catalogOk?: boolean; gearItems?: unknown[] } = {}) {
  const { stringItems = [], catalogOk = true, gearItems = [] } = opts;
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/equipment/catalog')) {
        if (!catalogOk) return jsonResponse({ error: 'load_failed' }, false);
        return jsonResponse({ items: stringItems });
      }
      if (url.includes('/api/equipment/gear')) return jsonResponse({ gear: { items: gearItems } });
      return jsonResponse({});
    }) as unknown as typeof fetch,
  );
}

function renderRail(name: string | null = 'Lin') {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <GearRail activeName={name} />
    </NextIntlClientProvider>,
  );
}

describe('GearRail', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('does NOT include a racket card — RacketRow already owns that surface', async () => {
    mockFetch();
    renderRail();
    await waitFor(() => expect(screen.getByText('Strings')).toBeTruthy());
    expect(screen.queryByText('Racket')).toBeNull();
  });

  it('shows the three non-racket categories', async () => {
    mockFetch();
    renderRail();
    await waitFor(() => expect(screen.getByText('Strings')).toBeTruthy());
    expect(screen.getByText('Shoes')).toBeTruthy();
    expect(screen.getByText('Shuttles')).toBeTruthy();
  });

  it('parks every category while the catalog has no rows', async () => {
    mockFetch({ stringItems: [] });
    renderRail();
    await waitFor(() => expect(screen.getAllByText('Coming soon').length).toBe(3));
  });

  it('says what each parked category will DO, not just that it is missing', async () => {
    mockFetch();
    renderRail();
    await waitFor(() => expect(screen.getByText(/Tension and string picks/)).toBeTruthy());
    expect(screen.getByText(/Court shoes matched to your footwork/)).toBeTruthy();
    expect(screen.getByText(/Which shuttle suits your hall/)).toBeTruthy();
  });

  // ── Strings goes live on data alone ─────────────────────────────────────
  it('un-parks Strings as soon as the catalog has string rows', async () => {
    mockFetch({ stringItems: [{ id: 's1', category: 'string', brand: 'Yonex', model: 'BG65' }] });
    renderRail();
    // Landing the data is the only step — no flag, no code change.
    await waitFor(() => expect(screen.getAllByText('Coming soon').length).toBe(2));
  });

  it('leaves shoes and shuttles parked even when strings goes live', async () => {
    mockFetch({ stringItems: [{ id: 's1', category: 'string' }] });
    renderRail();
    await waitFor(() => expect(screen.getAllByText('Coming soon').length).toBe(2));
    expect(screen.getByText('Shoes')).toBeTruthy();
    expect(screen.getByText('Shuttles')).toBeTruthy();
  });

  it('stays parked when the catalog probe FAILS — the safe direction', async () => {
    // A "coming soon" card is never wrong; a live card with nothing behind it
    // is. So a failed probe must not un-park anything.
    mockFetch({ catalogOk: false });
    renderRail();
    await waitFor(() => expect(screen.getAllByText('Coming soon').length).toBe(3));
  });

  // ── Owned gear ──────────────────────────────────────────────────────────
  it('names what the member already has in that category', async () => {
    mockFetch({ gearItems: [{ id: 'g1', category: 'string', label: 'Yonex BG65' }] });
    renderRail();
    await waitFor(() => expect(screen.getByText('Yours · Yonex BG65')).toBeTruthy());
  });

  it('says none on file when a category is empty', async () => {
    mockFetch();
    renderRail();
    await waitFor(() => expect(screen.getAllByText('Yours · none on file').length).toBe(3));
  });

  it('ignores retired gear', async () => {
    mockFetch({ gearItems: [{ id: 'g1', category: 'string', label: 'Old', retiredAt: '2026-01-01' }] });
    renderRail();
    await waitFor(() => expect(screen.getAllByText('Yours · none on file').length).toBe(3));
  });

  it('still renders the rail for a signed-out visitor', async () => {
    mockFetch();
    renderRail(null);
    await waitFor(() => expect(screen.getByText('Strings')).toBeTruthy());
  });
});
