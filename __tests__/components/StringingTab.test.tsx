// @vitest-environment jsdom
// @vitest-environment-options { "url": "http://localhost:3000/bpm" }
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import StringingTab from '../../components/StringingTab';
import { resetCatalogCache } from '@/components/stats/useCatalog';
import enMessages from '../../messages/en.json';

/**
 * The Stringing tab's registers (docs/plans/stringing-tabs.md): Racket and
 * Strings for everyone, and Bench for the people who string. Grant, 2026-10-12:
 * "can you add tabs to the stringing page like the stats page?"
 */
const R = enMessages.home.stringing.registers;

const benchJob = {
  id: 'j1', memberId: 'm1', jobNo: 'J-0042', memberName: 'Wei', stringerId: 'g', stringerName: 'Grant',
  status: 'received', racketLabel: 'Astrox 99 Pro', stringLabel: 'BG80', tensionMains: 26, tensionCrosses: 28,
  priceCents: 3000, readyBy: null, paidAt: null, createdAt: '', updatedAt: '', history: [],
};

function stubFetch(opts: { canString?: boolean } = {}) {
  const urls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((url: string) => {
      const u = String(url);
      urls.push(u);
      let body: unknown = {};
      if (u.includes('/shop')) body = { open: true };
      else if (u.includes('view=stringer')) body = { jobs: [], view: 'stringer', canString: opts.canString ?? false };
      else if (u.includes('view=player')) body = { jobs: [], view: 'player', lastStrungAt: null };
      else if (u.includes('/stringing/jobs')) body = { jobs: [benchJob], view: 'bench' };
      else if (u.includes('/stringing/strings')) body = { strings: ['BG80'], links: {}, prices: { BG80: 2800 } };
      else if (u.includes('/stringing/pricing')) body = { services: [], ownStringCents: 1800, note: '' };
      else if (u.includes('/stringing/stock')) body = { lines: [], unmatched: [], purchases: [], aliases: {}, totals: { purchasedCostCents: 0, usedSets: 0, usedCostCents: 0, remainingValueCents: 0 } };
      else if (u.includes('/catalog')) body = { items: [] };
      return Promise.resolve({ ok: true, status: 200, json: async () => body } as Response);
    }),
  );
  return urls;
}

function wrap(node: React.ReactNode) {
  return render(<NextIntlClientProvider locale="en" messages={enMessages}>{node}</NextIntlClientProvider>);
}

function signIn() {
  localStorage.setItem('badminton_identity', JSON.stringify({ name: 'Zach', token: null, sessionId: 'session-2026-10-15' }));
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_FLAG_STRINGING = 'true';
  vi.stubGlobal('navigator', { ...global.navigator, onLine: true });
  resetCatalogCache();
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete process.env.NEXT_PUBLIC_FLAG_STRINGING;
});

describe('everyone gets Racket and Strings', () => {
  it('opens on Racket, and a player never asks for the bench', async () => {
    const urls = stubFetch();
    wrap(<StringingTab />);
    const racket = await screen.findByRole('button', { name: R.racket });
    expect(racket.getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('button', { name: R.strings })).toBeDefined();
    expect(screen.queryByRole('button', { name: R.bench })).toBeNull();
    expect(await screen.findByRole('button', { name: 'Submit a request' })).toBeDefined();
    expect(urls.some((u) => u.includes('/stringing/jobs') && !u.includes('view='))).toBe(false);
  });

  it('holds the service card behind its skeleton until the player\'s rackets have answered', async () => {
    // The card used to reveal as soon as the shop answered, then grow when the
    // rackets landed: banners, the step strip and the rows popped in after it.
    signIn();
    let answerJobs: (v: Response) => void = () => {};
    stubFetch();
    const inner = globalThis.fetch as (url: string) => Promise<Response>;
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
      if (String(url).includes('view=player')) return new Promise<Response>((resolve) => { answerJobs = resolve; });
      return inner(url);
    }));
    wrap(<StringingTab />);
    await waitFor(() => expect(screen.getByRole('button', { name: R.racket }).getAttribute('aria-current')).toBe('page'));
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole('button', { name: 'Submit a request' })).toBeNull();
    answerJobs({ ok: true, status: 200, json: async () => ({ jobs: [], view: 'player', lastStrungAt: null }) } as Response);
    expect(await screen.findByRole('button', { name: 'Submit a request' })).toBeDefined();
  });

  it('shows the shelf, with every price, on Strings', async () => {
    stubFetch();
    wrap(<StringingTab />);
    fireEvent.click(await screen.findByRole('button', { name: R.strings }));
    expect(await screen.findByText('Strings in stock')).toBeDefined();
    expect(await screen.findByText('Bring your own string')).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Submit a request' })).toBeNull();
  });

  it('takes the service card’s "See pricing details" link to the Pricing details register', async () => {
    stubFetch();
    const onViewChange = vi.fn();
    wrap(<StringingTab view="racket" onViewChange={onViewChange} />);
    fireEvent.click(await screen.findByRole('button', { name: enMessages.home.stringing.seeStrings }));
    expect(onViewChange).toHaveBeenCalledWith('strings');
  });

  it('follows the register it is given (HomeShell holds it, above the refresh key)', async () => {
    stubFetch();
    wrap(<StringingTab view="strings" onViewChange={() => {}} />);
    expect((await screen.findByRole('button', { name: R.strings })).getAttribute('aria-current')).toBe('page');
    expect(await screen.findByText('Strings in stock')).toBeDefined();
  });
});

describe('the Bench, for the people who string', () => {
  it('is offered to an admin and shows the bench in place, with no Back of its own', async () => {
    stubFetch();
    wrap(<StringingTab isAdmin />);
    fireEvent.click(await screen.findByRole('button', { name: R.bench }));
    expect(await screen.findByText('J-0042')).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
    expect(screen.getByRole('heading', { name: enMessages.nav.stringing })).toBeDefined();
  });

  it('steps aside for a bench sub-screen, and comes back on Back', async () => {
    stubFetch();
    wrap(<StringingTab isAdmin />);
    fireEvent.click(await screen.findByRole('button', { name: R.bench }));
    fireEvent.click(await screen.findByRole('button', { name: 'Strings, stock & prices' }));
    await screen.findByText('Other prices');
    await waitFor(() => expect(screen.queryByRole('button', { name: R.racket })).toBeNull());
    expect(screen.queryByRole('heading', { name: enMessages.nav.stringing, level: 1 })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(await screen.findByRole('button', { name: R.racket })).toBeDefined();
    expect(await screen.findByText('J-0042')).toBeDefined();
  });

  it('is offered to a stringer who is not an admin, with their queue', async () => {
    signIn();
    stubFetch({ canString: true });
    wrap(<StringingTab />);
    fireEvent.click(await screen.findByRole('button', { name: R.bench }));
    expect(await screen.findByText(enMessages.home.stringing.stringerEmpty)).toBeDefined();
  });

  it('brings a stringer back to their Bench without painting Racket first', async () => {
    // Identity is read after mount, so on the first render the tab could not
    // yet know whether to wait for the stringer answer (local review).
    signIn();
    const urls = stubFetch({ canString: true });
    wrap(<StringingTab view="bench" onViewChange={() => {}} />);
    expect(await screen.findByText(enMessages.home.stringing.stringerEmpty)).toBeDefined();
    expect(urls.some((u) => u.includes('/shop'))).toBe(false);
  });

  it('is not offered to a signed-in member who does not string', async () => {
    signIn();
    const urls = stubFetch({ canString: false });
    wrap(<StringingTab />);
    await screen.findByRole('button', { name: R.racket });
    await waitFor(() => expect(urls.some((u) => u.includes('view=stringer'))).toBe(true));
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByRole('button', { name: R.bench })).toBeNull();
  });
});
