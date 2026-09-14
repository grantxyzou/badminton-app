// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import SetupShareSheet from '../../components/stats/SetupShareSheet';
import enMessages from '../../messages/en.json';
import type { ShareCard } from '../../lib/shareCard';
import type { SetupShare } from '../../lib/gearSetup';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const SERVER_CARD: ShareCard = {
  name: 'Lin', initial: 'L', sinceYear: 2024, clubName: 'BPM',
  racket: { name: 'Air Force 79', brand: 'Li-Ning', weight: '4U', balance: 'Even' },
  restrings: { count: 4, since: '2025-03-10T00:00:00Z' }, tensionVsClub: 2,
  string: 'Yonex BG65 Ti', tensionLbs: 26, grip: 'G4', clubCount: 4,
};

function serve(card: ShareCard | null) {
  global.fetch = vi.fn().mockImplementation((url: string) => {
    if (String(url).includes('/api/equipment/share-card')) {
      return card
        ? Promise.resolve({ ok: true, json: () => Promise.resolve({ card }) })
        : Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  }) as unknown as typeof fetch;
}

function renderSheet(share: SetupShare = { name: 'Lin', racket: 'Li-Ning Air Force 79', string: 'Yonex BG65 Ti', tensionLbs: 26 }) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <SetupShareSheet open onClose={vi.fn()} share={share} />
    </NextIntlClientProvider>,
  );
}

describe('SetupShareSheet', () => {
  let writeText: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  });

  it('answers "what are you playing?" with the server\'s facts, and Copy as text says the same ones', async () => {
    serve(SERVER_CARD);
    renderSheet();
    expect(screen.getAllByText('Answer “what are you playing?”').length).toBeGreaterThan(0);
    expect(screen.getByText(/Your level, results and kudos stay off/)).toBeTruthy();
    const copy = await screen.findByRole('button', { name: 'Copy as text' });
    await waitFor(() => expect((copy as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(copy);
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect((writeText.mock.calls[0] as string[])[0].split('\n')).toEqual([
      "What Lin's playing",
      'At BPM since 2024',
      'Racket: Air Force 79 (Li-Ning · 4U · even)',
      'Strings: Yonex BG65 Ti',
      'Tension: 26 lb',
      'Grip: G4',
      '4 restrings since March 2025',
      "+2 lb on the club's average",
      'At BPM: 1 of 4',
      'via %APP%',
    ]);
  });

  it('when the facts cannot be read, it still shares the gear — and invents nothing', async () => {
    serve(null);
    renderSheet();
    const copy = await screen.findByRole('button', { name: 'Copy as text' });
    await waitFor(() => expect((copy as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(copy);
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect((writeText.mock.calls[0] as string[])[0]).toBe(
      "What Lin's playing\nRacket: Li-Ning Air Force 79\nStrings: Yonex BG65 Ti\nTension: 26 lb\nvia %APP%",
    );
  });

  it('a refused clipboard is rendered, not swallowed', async () => {
    serve(null);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn(async () => { throw new Error('denied'); }) }, configurable: true });
    renderSheet({ name: 'Lin', racket: 'A', string: null, tensionLbs: null });
    const copy = await screen.findByRole('button', { name: 'Copy as text' });
    await waitFor(() => expect((copy as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(copy);
    expect(await screen.findByRole('alert')).toBeTruthy();
  });
});
