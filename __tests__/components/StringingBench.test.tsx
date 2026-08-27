// @vitest-environment jsdom
// @vitest-environment-options { "url": "http://localhost:3000/bpm" }
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import StringingPage from '../../components/admin/CommandCenter/StringingPage';
import StringingJobDetail from '../../components/admin/CommandCenter/StringingJobDetail';
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

/**
 * The bench page loads three things: jobs, the shop sign, and the offered
 * string list. A mock that answers only the first makes the OTHER cards render
 * their own error states, and then an assertion about "the" error on screen
 * finds two. Answer everything; assert on one.
 */
function respondJobs(jobs: StringingJob[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((url: string) =>
      Promise.resolve({
        ok: true,
        json: async () => {
          const u = String(url);
          if (u.includes('/shop')) return { open: false };
          if (u.includes('/strings')) return { strings: [] };
          return { jobs, view: 'bench' };
        },
      } as Response),
    ),
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

describe('the stringer sees their own number, on the screen that holds it', () => {
  it('renders the EXACT price on the job detail, not the player band', () => {
    // The price lives on the detail screen only. The bench row shows urgency
    // instead, because a bench is scanned for what is late — and keeping the
    // figure to one screen keeps the surface it can leak from small.
    wrap(<StringingJobDetail job={job} onBack={() => {}} onChanged={() => {}} />);

    expect(screen.getByText('$30.00')).toBeDefined();
    expect(screen.queryByText('$28–32')).toBeNull();
  });

  it('says when a job has no price rather than showing zero', () => {
    wrap(<StringingJobDetail job={{ ...job, priceCents: null }} onBack={() => {}} onChanged={() => {}} />);

    expect(screen.getByText('Not priced yet')).toBeDefined();
    expect(screen.queryByText('$0.00')).toBeNull();
  });

  it('never puts the exact price on the bench row', () => {
    respondJobs([job]);
    wrap(<StringingPage onBack={() => {}} />);
    expect(screen.queryByText('$30.00')).toBeNull();
  });
});

describe('the shop sign', () => {
  function respondShop(open: boolean | null) {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) =>
        Promise.resolve({
          ok: true,
          json: async () =>
            String(url).includes('/shop') ? { open } : { jobs: [job], view: 'bench' },
        } as Response),
      ),
    );
  }

  it('offers Close when the shop is open, and Open when it is closed', async () => {
    respondShop(true);
    const { unmount } = wrap(<StringingPage onBack={() => {}} />);
    expect(await screen.findByText('Open for stringing')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Close' })).toBeDefined();
    unmount();

    respondShop(false);
    wrap(<StringingPage onBack={() => {}} />);
    expect(await screen.findByText('Closed for now')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Open' })).toBeDefined();
  });

  it('says UNKNOWN rather than hanging a CLOSED sign it cannot verify', async () => {
    // Answering "closed" on a throttled read would put a CLOSED sign on a shop
    // that is open — the confident-wrong answer, which is the one that costs
    // someone a restring they could have had.
    respondShop(null);
    wrap(<StringingPage onBack={() => {}} />);
    expect(await screen.findByText("Can't tell right now")).toBeDefined();
    expect(screen.queryByText('Closed for now')).toBeNull();
    // And there is nothing to tap, because there is nothing to toggle FROM.
    expect(screen.getByRole('button', { name: 'Open' })).toHaveProperty('disabled', true);
  });

  it('still lists the bench while the shop is closed', async () => {
    // Closed is a sign in the window, not a lock on the door: jobs in flight
    // still need finishing.
    respondShop(false);
    wrap(<StringingPage onBack={() => {}} />);
    expect(await screen.findByText('Wei')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Add job' })).toBeDefined();
  });
});

describe('a failed load is not an empty bench', () => {
  it('shows an error, never the empty state', async () => {
    // Everything on the page fails here, so assert on the BENCH's own message
    // rather than on "an alert" — the strings card legitimately raises one too.
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    wrap(<StringingPage onBack={() => {}} />);

    expect(await screen.findByText(/Couldn't load the bench/i)).toBeDefined();
    expect(screen.queryByText('Nothing on the bench.')).toBeNull();
  });

  it('shows the empty state only on a real empty answer', async () => {
    respondJobs([]);
    wrap(<StringingPage onBack={() => {}} />);

    expect(await screen.findByText('Nothing on the bench.')).toBeDefined();
    expect(screen.queryByText(/Couldn't load the bench/i)).toBeNull();
  });
});

describe('values carry their units', () => {
  it('shows a visible $ on the price field, not just in a placeholder', async () => {
    // A placeholder disappears the moment you type — the unit vanishes exactly
    // when you are entering the number and most need to know what it means.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => [{ id: 'm1', name: 'Wei' }] } as Response),
    );
    const { container } = wrap(<StringingIntake onBack={() => {}} onCreated={() => {}} />);
    const price = await screen.findByLabelText('Your price');

    fireEvent.change(price, { target: { value: '30' } });
    // Still there with a value present, which is the whole point.
    expect(Array.from(container.querySelectorAll('span')).some((el) => el.textContent === '$')).toBe(
      true,
    );
  });

  it('labels the tension in pounds', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => [] } as Response),
    );
    wrap(<StringingIntake onBack={() => {}} onCreated={() => {}} />);
    // Two steppers, mains and crosses, each carrying its unit.
    expect(await screen.findAllByText('lb')).toHaveLength(2);
  });

  it('shows urgency on the bench row rather than a bare date', async () => {
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    respondJobs([{ ...job, readyBy: yesterday, status: 'received' }]);
    wrap(<StringingPage onBack={() => {}} />);
    expect(await screen.findByText('1 day late')).toBeDefined();
  });

  it('never marks a picked-up racket late, and says it only once', async () => {
    // The status chip already reads "Picked up". The due column showing it too
    // put the same words twice in one row — found by the test failing on
    // "found multiple elements", not by reading the code.
    respondJobs([{ ...job, readyBy: '2020-01-01', status: 'picked_up' }]);
    wrap(<StringingPage onBack={() => {}} />);
    expect(await screen.findByText('Picked up')).toBeDefined();
    expect(screen.queryByText(/late/i)).toBeNull();
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
