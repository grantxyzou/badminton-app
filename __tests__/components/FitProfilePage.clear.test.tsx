// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import FitProfilePage from '../../components/stats/FitProfilePage';
import enMessages from '../../messages/en.json';
import type { UseGear, GearPrefs } from '../../components/stats/useGear';
import type { UseGearPicks } from '../../components/stats/useGearPicks';
import type { PlayerGear } from '../../lib/types';

/**
 * The privacy policy promises every racket-fit answer can be cleared. The fit
 * SHEET kept that promise with a Clear per answer until it was deleted with
 * NEXT_PUBLIC_FLAG_GEAR_PAGES (2026-10-19); the page keeps it with one
 * "Clear my fit answers" that confirms, then blanks every answer in one write.
 */

function gearOf(doc: PlayerGear | null, setPrefs: (p: GearPrefs) => Promise<{ ok: true }>): UseGear {
  return {
    gear: doc, loaded: true, loadError: false, online: true, busy: false,
    rackets: doc?.items.filter((i) => i.category === 'racket') ?? [],
    setPrefs,
  } as unknown as UseGear;
}

const PICKS = { view: { racket: { status: 'loading', pick: null } }, refresh: vi.fn() } as unknown as UseGearPicks;

const base: PlayerGear = { id: 'g', memberId: 'm', updatedAt: '', items: [] };

function renderPage(doc: PlayerGear, setPrefs = vi.fn(async (_p: GearPrefs) => ({ ok: true as const }))) {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <FitProfilePage activeName="Lin" gear={gearOf(doc, setPrefs)} picks={PICKS} onBack={() => {}} />
    </NextIntlClientProvider>,
  );
  return setPrefs;
}

describe('FitProfilePage — the questions as the Stats canvas put them (2026-10-19)', () => {
  beforeEach(() => {
    window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: true, status: 200,
      json: async () => ({ facts: { state: 'insufficient', answered: 0, frame: null, currentTensionLbs: null, tensionRange: null, sorenessMovedRange: false, goal: null, prospective: false, reasons: [] }, copy: null, checkInLevel: null }),
    } as Response)) as unknown as typeof fetch);
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it('asks how hard you hit, by where your clear lands, and still stores slow / medium / fast', async () => {
    const setPrefs = renderPage(base);
    expect(await screen.findByText('How hard do you hit?')).toBeTruthy();
    expect(screen.getByText('Picture a clear from the back of the court.')).toBeTruthy();
    const group = screen.getByRole('radiogroup', { name: 'How hard do you hit?' });
    const options = within(group).getAllByRole('radio').map((r) => r.textContent);
    expect(options).toEqual(['YouNetBackGentleLands mid-court', 'YouNetBackMediumReaches the back', 'YouNetBackHardGoes deep, easily']);
    fireEvent.click(within(group).getByRole('radio', { name: /Gentle/ }));
    // The wording changed; the value the engines read did not.
    await waitFor(() => expect(setPrefs).toHaveBeenCalledWith({ fitSwing: 'slow' }));
    fireEvent.click(within(group).getByRole('radio', { name: /Hard/ }));
    await waitFor(() => expect(setPrefs).toHaveBeenCalledWith({ fitSwing: 'fast' }));
  });

  it('marks G5 as the standard grip, no longer asks about overgrips, and counts answers', async () => {
    renderPage({ ...base, fitGrip: 'G5', fitSwing: 'medium' } as PlayerGear);
    expect(await screen.findByText('Standard')).toBeTruthy();
    const g5 = screen.getByRole('radio', { name: /G5/ });
    expect(g5.textContent).toContain('Standard');
    expect(screen.getByRole('radio', { name: /G4/ }).textContent).not.toContain('Standard');
    // Asked, stored and read by nothing: the question left (2026-10-20).
    expect(screen.queryByText(/overgrip/i)).toBeNull();
    // Two of five answered (grip, swing): the count says so in words.
    expect(screen.getByText('2 of 5 answered')).toBeTruthy();
    expect(screen.queryByText(/Circles are the handle/)).toBeNull();
  });
});

describe('FitProfilePage — clearing every fit answer', () => {
  beforeEach(() => {
    window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: true, status: 200,
      json: async () => ({ facts: { state: 'insufficient', answered: 0, frame: null, currentTensionLbs: null, tensionRange: null, sorenessMovedRange: false, goal: null, prospective: false, reasons: [] }, copy: null, checkInLevel: null }),
    } as Response)) as unknown as typeof fetch);
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it('offers nothing to clear when nothing is stored', async () => {
    renderPage(base);
    await screen.findByText(enMessages.stats.gear.fitPage.goal);
    expect(screen.queryByRole('button', { name: 'Clear my fit answers' })).toBeNull();
  });

  it('asks once, then blanks every answer in ONE write, the sore-arm answers included', async () => {
    const setPrefs = renderPage({ ...base, fitGoal: 'more_power', fitSwing: 'fast', fitSoreness: 'elbow', fitArmComfort: 'sometimes_sore' } as PlayerGear);
    fireEvent.click(await screen.findByRole('button', { name: 'Clear my fit answers' }));
    expect(setPrefs).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Clear them' }));
    await waitFor(() => expect(setPrefs).toHaveBeenCalledTimes(1));
    expect(setPrefs).toHaveBeenCalledWith({
      fitGoal: null, fitSwing: null, fitGrip: null, fitPlayStyle: null, fitSoreness: null,
      fitLevelOverride: null, fitOvergrips: null, fitArmComfort: null,
    });
  });

  it('"Keep them" writes nothing', async () => {
    const setPrefs = renderPage({ ...base, fitGrip: 'G5' } as PlayerGear);
    fireEvent.click(await screen.findByRole('button', { name: 'Clear my fit answers' }));
    fireEvent.click(screen.getByRole('button', { name: 'Keep them' }));
    expect(setPrefs).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Clear my fit answers' })).toBeTruthy();
  });

  it('an older arm answer alone, which this page never asks, still offers the clear', async () => {
    renderPage({ ...base, fitArmComfort: 'sometimes_sore' } as PlayerGear);
    expect(await screen.findByRole('button', { name: 'Clear my fit answers' })).toBeTruthy();
  });
});
