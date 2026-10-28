// @vitest-environment jsdom
// @vitest-environment-options { "url": "http://localhost:3000/bpm" }
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import ConfirmChangeSheet from '../../components/stringing/ConfirmChangeSheet';
import enMessages from '../../messages/en.json';
import type { PlayerStringingJob } from '../../lib/types';

/**
 * "A change to confirm" (docs/plans/stringing-canvas-redesign.md, Decisions 2-4):
 * exact dollars, whole when whole; Confirm / Cancel this request; and a stale
 * sheet (a 409) that stops offering answers and re-reads the card behind it.
 */
const job: PlayerStringingJob = {
  id: 'j2', jobNo: 'J-0002', stage: 'with_stringer', stageIndex: 1,
  racketLabel: 'Nanoflare 800 Pro', stringLabel: 'Aerobite', tensionMains: 27, tensionCrosses: 29,
  method: '', quote: 34, amountDue: null, readyBy: null, paid: false,
  pendingEdit: { proposedAt: '2026-10-27T00:00:00Z', stringFrom: 'Aerobite', stringTo: 'Exbolt 63', priceFrom: 34, priceTo: 38.5 },
  createdAt: '', updatedAt: '',
};

function wrap(onAnswered = vi.fn(), onClose = vi.fn()) {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <ConfirmChangeSheet job={job} open onClose={onClose} onAnswered={onAnswered} />
    </NextIntlClientProvider>,
  );
  return { onAnswered, onClose };
}

beforeEach(() => {
  vi.stubGlobal('navigator', { ...global.navigator, onLine: true });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ConfirmChangeSheet', () => {
  it('shows the diff in exact dollars: whole when whole, cents when not, never rounded', () => {
    vi.stubGlobal('fetch', vi.fn());
    wrap();
    expect(screen.getByText('$34')).toBeDefined();
    expect(screen.getByText('$38.50')).toBeDefined();
    expect(screen.queryByText('$34.00')).toBeNull();
    expect(screen.queryByText('$39')).toBeNull();
  });

  it('answers with Confirm and Cancel this request', () => {
    vi.stubGlobal('fetch', vi.fn());
    wrap();
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Cancel this request' })).toBeDefined();
  });

  it('Cancel this request DECLINES the change; it does not cancel the restring', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) } as Response);
    vi.stubGlobal('fetch', fetchMock);
    const { onAnswered } = wrap();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel this request' }));
    await waitFor(() => expect(onAnswered).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/api/stringing/jobs/j2/accept');
    expect(JSON.parse(init.body)).toEqual({ decision: 'decline' });
  });

  it('a stale sheet (409) re-reads the card, and offers nothing left to answer', async () => {
    // Grant: "Why doesnt the button on previous screen update?"
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 409, json: async () => ({}) } as Response));
    const { onAnswered } = wrap();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(await screen.findByText(enMessages.home.stringing.confirm.gone)).toBeDefined();
    expect(onAnswered).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Confirm' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Cancel this request' })).toBeNull();
    expect(screen.queryByText('$38.50')).toBeNull();
  });
});
