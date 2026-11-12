// @vitest-environment jsdom
// @vitest-environment-options { "url": "http://localhost:3000/bpm" }
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import ConfirmChangePage from '../../components/stringing/ConfirmChangePage';
import enMessages from '../../messages/en.json';
import type { PlayerStringingJob, PlayerPendingEdit } from '../../lib/types';

/**
 * "A change to confirm" as its own page (Grant, design canvas, 2026-11-12):
 * the stringer's why when there is one, each change its own amber row in
 * exact dollars, and Keep mine / Accept change INSIDE the card. It replaced
 * `ConfirmChangeSheet` and keeps its rules (docs/plans/stringing-canvas-redesign.md,
 * Decisions 2-4): Keep mine declines, a 409 is "Nothing left to answer" and
 * re-reads the card behind, a failed send stays on the page.
 */
const edit: PlayerPendingEdit = {
  proposedAt: '2026-10-27T00:00:00Z',
  stringFrom: 'BG80', stringTo: 'Aerobite',
  tensionFrom: '26/28', tensionTo: '27/29',
  priceFrom: 34, priceTo: 38.5,
};
const job = (pe: PlayerPendingEdit = edit): PlayerStringingJob => ({
  id: 'j2', jobNo: 'J-0002', stage: 'with_stringer', stageIndex: 1,
  racketLabel: 'Nanoflare 800 Pro', stringLabel: 'BG80', tensionMains: 26, tensionCrosses: 28,
  method: '', quote: 34, amountDue: null, readyBy: null, paid: false,
  pendingEdit: pe, createdAt: '', updatedAt: '',
});

function wrap(j = job(), onAnswered = vi.fn(), onBack = vi.fn()) {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <ConfirmChangePage job={j} onBack={onBack} onAnswered={onAnswered} />
    </NextIntlClientProvider>,
  );
  return { onAnswered, onBack };
}

const ok = () => vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) } as Response);

beforeEach(() => {
  vi.stubGlobal('navigator', { ...global.navigator, onLine: true });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ConfirmChangePage', () => {
  it('is a page: the Stringing eyebrow, the title and a way back', () => {
    vi.stubGlobal('fetch', vi.fn());
    const { onBack } = wrap();
    expect(screen.getByRole('heading', { name: 'A change to confirm' })).toBeDefined();
    expect(screen.getByText('Stringing')).toBeDefined();
    expect(screen.getByText('J-0002 · With the stringer')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(onBack).toHaveBeenCalled();
  });

  it('shows the stringer\'s why when there is one', () => {
    vi.stubGlobal('fetch', vi.fn());
    wrap(job({ ...edit, reason: 'BG80 is out until next week.' }));
    expect(screen.getByText('Why, from your stringer')).toBeDefined();
    expect(screen.getByText('BG80 is out until next week.').className).toContain('change-note');
  });

  it('shows nothing in its place when there is none', () => {
    vi.stubGlobal('fetch', vi.fn());
    wrap();
    expect(screen.queryByText('Why, from your stringer')).toBeNull();
    expect(document.querySelector('.change-note')).toBeNull();
  });

  it('lists each change as its own amber row, old struck through, exact dollars', () => {
    vi.stubGlobal('fetch', vi.fn());
    wrap();
    const rows = document.querySelectorAll('li.change-row');
    expect(rows).toHaveLength(3);
    const [str, tension, price] = Array.from(rows) as HTMLElement[];
    expect(within(str).getByText('String')).toBeDefined();
    expect((within(str).getByText('BG80') as HTMLElement).style.textDecoration).toBe('line-through');
    expect(within(str).getByText('Aerobite')).toBeDefined();
    expect(within(tension).getByText('26 lb')).toBeDefined();
    expect(within(tension).getByText('27 lb')).toBeDefined();
    // Whole when whole, cents when not, never rounded.
    expect(within(price).getByText('$34')).toBeDefined();
    expect(within(price).getByText('$38.50')).toBeDefined();
    expect(screen.queryByText('$34.00')).toBeNull();
  });

  it('puts both answers INSIDE the card, Accept as the filled primary', () => {
    vi.stubGlobal('fetch', vi.fn());
    wrap();
    const card = screen.getByRole('region', { name: 'A change to confirm' });
    const accept = within(card).getByRole('button', { name: 'Accept change' });
    expect(accept.className).toContain('btn-primary');
    expect(within(card).getByRole('button', { name: 'Keep mine' })).toBeDefined();
    expect(within(card).getByText(enMessages.home.stringing.confirm.note)).toBeDefined();
  });

  it('Accept change accepts, then re-reads the card and goes back', async () => {
    const fetchMock = ok();
    vi.stubGlobal('fetch', fetchMock);
    const { onAnswered, onBack } = wrap();
    fireEvent.click(screen.getByRole('button', { name: 'Accept change' }));
    await waitFor(() => expect(onBack).toHaveBeenCalled());
    expect(onAnswered).toHaveBeenCalled();
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/api/stringing/jobs/j2/accept');
    expect(JSON.parse(init.body)).toEqual({ decision: 'accept' });
  });

  it('Keep mine DECLINES the change; the job stands as it was', async () => {
    const fetchMock = ok();
    vi.stubGlobal('fetch', fetchMock);
    const { onAnswered } = wrap();
    fireEvent.click(screen.getByRole('button', { name: 'Keep mine' }));
    await waitFor(() => expect(onAnswered).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/api/stringing/jobs/j2/accept');
    expect(JSON.parse(init.body)).toEqual({ decision: 'decline' });
  });

  it('a stale page (409) re-reads the card, and shows only "Nothing left to answer"', async () => {
    // Grant: "Why doesnt the button on previous screen update?"; and his final
    // frame (2026-11-12): no card at all, the page-level state with Close.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 409, json: async () => ({}) } as Response));
    const { onAnswered, onBack } = wrap(job({ ...edit, reason: 'BG80 is out.' }));
    fireEvent.click(screen.getByRole('button', { name: 'Accept change' }));
    expect(await screen.findByText(enMessages.home.stringing.confirm.goneTitle)).toBeDefined();
    expect(screen.getByText(enMessages.home.stringing.confirm.gone)).toBeDefined();
    expect(onAnswered).toHaveBeenCalledTimes(1);
    expect(onBack).not.toHaveBeenCalled();
    // The same header stays.
    expect(screen.getByRole('heading', { name: 'A change to confirm' })).toBeDefined();
    // No card, no racket, no change, no answers.
    expect(document.querySelector('.glass-card')).toBeNull();
    expect(screen.queryByRole('region', { name: 'A change to confirm' })).toBeNull();
    expect(screen.queryByText('Nanoflare 800 Pro')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Accept change' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Keep mine' })).toBeNull();
    expect(screen.queryByText('$38.50')).toBeNull();
    expect(screen.queryByText('BG80 is out.')).toBeNull();
    expect(screen.queryByText(enMessages.home.stringing.confirm.note)).toBeNull();
    // One way out: Close, which goes back.
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('a failed send stays on the page saying so', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({}) } as Response));
    const { onBack } = wrap();
    fireEvent.click(screen.getByRole('button', { name: 'Accept change' }));
    expect(await screen.findByRole('alert')).toBeDefined();
    expect(onBack).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Accept change' })).toBeDefined();
  });
});
