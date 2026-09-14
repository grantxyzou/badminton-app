// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
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
    expect(screen.getByText("Where you'd go next")).toBeTruthy();
    expect(screen.getByText('A step up in power from your Air Force 79 · ~$309')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Astrox 88S Pro/ }));
    expect(onOpen).toHaveBeenCalled();
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
