// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import NextRacketCard from '../../components/stats/NextRacketCard';
import type { UseGear } from '../../components/stats/useGear';
import type { UseGearPicks } from '../../components/stats/useGearPicks';
import type { CatalogItem, GearItem, PlayerGear } from '../../lib/types';
import enMessages from '../../messages/en.json';

const RACKET: GearItem = { id: 'r1', catalogId: 'rk-af79', category: 'racket', label: 'Li-Ning Air Force 79' };
const NEXT: CatalogItem = { id: 'rk-88s', category: 'racket', brand: 'Yonex', model: 'Astrox 88S Pro', skillRange: [2, 4], msrp: 309 };

function gearWith(items: GearItem[], overrides: Partial<UseGear> = {}): UseGear {
  const d = { id: 'g', memberId: 'm', items, activeRacketId: items[0]?.id, updatedAt: '' } as PlayerGear;
  return { gear: d, loaded: true, loadError: false, forbidden: false, ...overrides } as UseGear;
}

function picks(racket: UseGearPicks['view']['racket'], parkReason?: 'needsFit' | 'no_catalog'): UseGearPicks {
  const parked = { status: 'parked' as const, pick: null };
  return {
    view: { racket, string: parked, shoe: parked, shuttle: parked, bag: parked, grip: parked },
    refused: false, parkReasons: parkReason ? { racket: parkReason } : {}, retry: vi.fn(), isOwned: () => false, railStatus: (s) => s, refresh: vi.fn(),
  };
}

function renderCard(gear: UseGear, p: UseGearPicks, handlers: { onOpen?: () => void; onOpenFit?: () => void } = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <NextRacketCard gear={gear} picks={p} onOpen={handlers.onOpen ?? vi.fn()} onOpenFit={handlers.onOpenFit ?? vi.fn()} />
    </NextIntlClientProvider>,
  );
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('NextRacketCard', () => {
  const ready = { status: 'ready' as const, pick: { item: NEXT, reasons: ['A step up in power from your Air Force 79.'] } };

  it('says nothing before there is a racket in play — the add sheet already suggests one', () => {
    const { container } = renderCard(gearWith([]), picks(ready));
    expect(container.textContent).toBe('');
  });

  it('a ready pick: the model, the engine headline and the price, and a tap opens its detail', () => {
    const onOpen = vi.fn();
    renderCard(gearWith([RACKET]), picks(ready), { onOpen });
    expect(screen.getByText('Racket to try next')).toBeTruthy();
    expect(screen.getByText('A step up in power from your Air Force 79.')).toBeTruthy();
    // The price is its own row, linking to the maker (Stats canvas, 2026-10-19).
    const site = screen.getByRole('link', { name: /Yonex site/ });
    expect(site.getAttribute('href')).toBe('https://www.yonex.com/');
    expect(site.getAttribute('target')).toBe('_blank');
    expect(site.textContent).toContain('~$309');
    expect(screen.queryByText(/not a verdict/)).toBeNull();
    // The price row sits in the text column, beside the frame, not under it;
    // and the name is the door, with the chevron on it (Stats canvas, 2026-10-19).
    const body = site.parentElement!;
    expect(body.className).toContain('setup-next-body');
    expect(within(body).getByRole('button', { name: /Astrox 88S Pro/ }).textContent).toContain('chevron_right');
    fireEvent.click(screen.getByRole('button', { name: /Astrox 88S Pro/ }));
    expect(onOpen).toHaveBeenCalled();
  });

  it('a brand with no checked site shows its price with no link', () => {
    const lining = { status: 'ready' as const, pick: { item: { ...NEXT, brand: 'Li-Ning', model: 'Axforce 80' }, reasons: ['Lighter.'] } };
    renderCard(gearWith([RACKET]), picks(lining));
    expect(screen.getByText('~$309')).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('parked on the fit questions is a door to them', () => {
    const onOpenFit = vi.fn();
    renderCard(gearWith([RACKET]), picks({ status: 'parked', pick: null }, 'needsFit'), { onOpenFit });
    fireEvent.click(screen.getByRole('button', { name: /Answer the fit questions/ }));
    expect(onOpenFit).toHaveBeenCalled();
  });

  it('parked with no door says nothing', () => {
    const { container } = renderCard(gearWith([RACKET]), picks({ status: 'parked', pick: null }, 'no_catalog'));
    expect(container.textContent).toBe('');
  });

  it('a failed pick is a failure with Try again, never silence', () => {
    const p = picks({ status: 'error', pick: null });
    renderCard(gearWith([RACKET]), p);
    expect(screen.getByRole('alert')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(p.retry).toHaveBeenCalledWith('racket', 'error');
  });

  it('an unread bag shows nothing here — the Set-up card carries that failure', () => {
    const { container } = renderCard(gearWith([RACKET], { loadError: true }), picks(ready));
    expect(container.textContent).toBe('');
  });
});
