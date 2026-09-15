// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import FrameDetailPage, { TensionBandChart } from '../../components/stats/FrameDetailPage';
import { resetCatalogCache } from '../../components/stats/useCatalog';
import { resetClubTensionCache } from '../../components/stats/useClubTension';
import enMessages from '../../messages/en.json';
import type { UseGear } from '../../components/stats/useGear';
import type { CatalogItem, PlayerGear } from '../../lib/types';

const AF79 = {
  id: 'racket-af79', category: 'racket', brand: 'Li-Ning', model: 'Air Force 79',
  attributes: { balance: 'Even', flex: 'Medium', tier: 'Mid-range', weight: '4U', weightMinG: 80, weightMaxG: 84, playStyle: 'All-round' },
} as unknown as CatalogItem;
const OTHER = { ...AF79, id: 'racket-other', model: 'Other Frame' } as CatalogItem;

function gearOf(doc: PlayerGear | null): UseGear {
  return { gear: doc, loaded: true, loadError: false, online: true, busy: false, rackets: doc?.items.filter((i) => i.category === 'racket') ?? [] } as unknown as UseGear;
}

const OWNED: PlayerGear = {
  id: 'g', memberId: 'm', updatedAt: '', activeRacketId: 'r1',
  items: [{ id: 'r1', catalogId: AF79.id, category: 'racket', label: 'AF79' }, { id: 's1', catalogId: 'bg', category: 'string', label: 'BG65', tensionLbs: 25 }],
  stringLog: [{ at: '2026-09-01', catalogId: 'bg', racketCatalogId: AF79.id, tensionLbs: 25, stringLabel: 'BG65' }],
};

function renderPage(doc: PlayerGear | null, frameId = AF79.id) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <FrameDetailPage activeName="Lin" gear={gearOf(doc)} frameId={frameId} onBack={() => {}} onOpenFrame={() => {}} onOpenFit={() => {}} onView3d={() => {}} />
    </NextIntlClientProvider>,
  );
}

describe('FrameDetailPage', () => {
  beforeEach(() => {
    resetCatalogCache();
    resetClubTensionCache();
    window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      const body = url.includes('/catalog') ? { items: [AF79, OTHER] }
        : url.includes('/club/tension') ? { band: null }
        : url.includes('/fit-verdict') ? { facts: { state: 'insufficient', answered: 2, frame: null, currentTensionLbs: null, tensionRange: null, sorenessMovedRange: false, goal: null, prospective: false, reasons: [] }, copy: null, checkInLevel: null }
        : {};
      return Promise.resolve({ ok: true, status: 200, json: async () => body } as Response);
    }) as unknown as typeof fetch);
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it('opens one row at a time', async () => {
    renderPage(OWNED);
    const tension = await screen.findByRole('button', { name: /Tension/ });
    const strings = screen.getByRole('button', { name: /Strings/ });
    fireEvent.click(tension);
    expect(tension.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(strings);
    expect(strings.getAttribute('aria-expanded')).toBe('true');
    expect(tension.getAttribute('aria-expanded')).toBe('false');
  });

  it('an owner sees the pill and a Strings row; a browser sees neither', async () => {
    renderPage(OWNED);
    await screen.findByText('In your bag');
    expect(screen.getByRole('button', { name: /Strings/ })).toBeTruthy();
    cleanup();
    renderPage(null);
    await screen.findByRole('button', { name: /Tension/ });
    expect(screen.queryByText('In your bag')).toBeNull();
    expect(screen.queryByRole('button', { name: /Strings/ })).toBeNull();
  });

  it('says the club band is not there yet rather than drawing one', async () => {
    renderPage(OWNED);
    await waitFor(() => expect(screen.getByText(/You're at 25 · not enough of the club plays it yet/)).toBeTruthy());
  });
});

describe('TensionBandChart', () => {
  afterEach(cleanup);
  it('places the band and your line on the fixed 20–30 lb scale', () => {
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <TensionBandChart band={{ sampleSize: 4, low: 24, high: 27, mean: 25.5 }} you={26} />
      </NextIntlClientProvider>,
    );
    const band = screen.getByTestId('club-band');
    expect(band.style.left).toBe('40%');
    expect(band.style.width).toBe('30%');
    expect(screen.getByTestId('your-line').style.left).toBe('60%');
  });

  it('draws no band below the club threshold', () => {
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <TensionBandChart band={null} you={null} />
      </NextIntlClientProvider>,
    );
    expect(screen.queryByTestId('club-band')).toBeNull();
    expect(screen.queryByTestId('your-line')).toBeNull();
  });
});
