// @vitest-environment jsdom
// @vitest-environment-options { "url": "http://localhost:3000/bpm" }
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import StringingPage from '../../components/admin/CommandCenter/StringingPage';
import StringingIntake from '../../components/admin/CommandCenter/StringingIntake';
import enMessages from '../../messages/en.json';
import type { StringingJob } from '../../lib/types';

/**
 * The bench screens. Two things are worth pinning here and the rest is layout.
 *
 * 1. The STRINGER sees the exact price. This screen is the one place it lives,
 *    and a well-meaning reuse of the player formatter would silently band it —
 *    leaving the stringer unable to read their own number.
 * 2. A failed load must not render as an empty bench. "No rackets to string"
 *    and "we couldn't ask" look identical and mean opposite things, and this is
 *    the screen where believing the wrong one wastes someone's evening.
 */
const job: StringingJob = {
  id: 'job-1',
  memberId: 'member-wei',
  jobNo: 'J-0042',
  memberName: 'Wei',
  stringerId: 'member-grant',
  stringerName: 'Grant',
  status: 'received',
  racketLabel: 'Astrox 99 Pro',
  stringLabel: 'BG80 · white',
  tensionMains: 26,
  tensionCrosses: 28,
  method: 'Zach · 2 strings, 4 knots',
  priceCents: 3000,
  readyBy: 'Sunday',
  acceptedAt: null,
  paidAt: null,
  sessionId: null,
  createdAt: '2026-08-27T00:00:00.000Z',
  updatedAt: '2026-08-27T00:00:00.000Z',
  history: [],
};

function wrap(node: React.ReactNode) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {node}
    </NextIntlClientProvider>,
  );
}

function respondJobs(jobs: StringingJob[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ ok: true, json: async () => ({ jobs, view: 'bench' }) } as Response),
  );
}

beforeEach(() => {
  vi.stubGlobal('navigator', { ...global.navigator, onLine: true });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the bench shows the stringer their own number', () => {
  it('renders the EXACT price, not the player band', async () => {
    respondJobs([job]);
    wrap(<StringingPage onBack={() => {}} />);

    expect(await screen.findByText('$30.00')).toBeDefined();
    // The band belongs on the other side of the wall.
    expect(screen.queryByText('$28–32')).toBeNull();
  });

  it('says when a job has no price rather than showing zero', async () => {
    respondJobs([{ ...job, priceCents: null }]);
    wrap(<StringingPage onBack={() => {}} />);

    expect(await screen.findByText('Not priced yet')).toBeDefined();
    expect(screen.queryByText('$0.00')).toBeNull();
  });
});

describe('a failed load is not an empty bench', () => {
  it('shows an error, never the empty state', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    wrap(<StringingPage onBack={() => {}} />);

    expect(await screen.findByRole('alert')).toBeDefined();
    expect(screen.queryByText('Nothing on the bench.')).toBeNull();
  });

  it('shows the empty state only on a real empty answer', async () => {
    respondJobs([]);
    wrap(<StringingPage onBack={() => {}} />);

    expect(await screen.findByText('Nothing on the bench.')).toBeDefined();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('intake shows the stringer what the player will read', () => {
  function openIntake() {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => [{ id: 'member-wei', name: 'Wei' }],
      } as Response),
    );
    wrap(<StringingIntake onBack={() => {}} onCreated={() => {}} />);
  }

  it('previews the BAND live as the price is typed', async () => {
    // The stringer should never have to guess what the other side reads. This
    // is the same rule as the API strip, made visible at the moment the number
    // is chosen rather than discovered afterwards.
    openIntake();
    fireEvent.change(await screen.findByLabelText('Your price'), { target: { value: '30' } });
    await waitFor(() => expect(screen.getByText('$28–32')).toBeDefined());
  });

  it('offers every BPM account, not just this week’s roster', async () => {
    // Walk-ups are the whole reason this screen exists — someone hands over a
    // racket on a night they are not booked. Filtering to signups would make
    // the common case the impossible one.
    openIntake();
    expect(await screen.findByText('Wei')).toBeDefined();
    expect(screen.getByText(/walk-ups included/i)).toBeDefined();
  });

  it('lets a job be saved with no price at all', async () => {
    // So a racket can be logged in ten seconds at a session and priced later,
    // instead of the form demanding a figure while someone stands waiting.
    openIntake();
    fireEvent.click(await screen.findByText('Wei'));
    fireEvent.change(screen.getByLabelText(/Racket, e.g./i), { target: { value: 'Astrox' } });
    fireEvent.change(screen.getByLabelText(/String, e.g./i), { target: { value: 'BG80' } });

    const save = screen.getByRole('button', { name: /Save & let Wei know/i });
    expect(save).toHaveProperty('disabled', false);
  });

  it('blocks a price that is not a number', async () => {
    openIntake();
    fireEvent.click(await screen.findByText('Wei'));
    fireEvent.change(screen.getByLabelText('Your price'), { target: { value: 'thirty' } });
    expect(screen.getByText(/doesn't look like a price/i)).toBeDefined();
  });
});
