// @vitest-environment jsdom
// @vitest-environment-options { "url": "http://localhost:3000/bpm" }
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import StringingCard from '../../components/stringing/StringingCard';
import enMessages from '../../messages/en.json';

/**
 * The Home card. "Coming soon" is the DEFAULT, not the fallback for one case.
 *
 * It stays that way for a closed shop, for a failed probe, and for a throttled
 * one — anything short of a confirmed `open: true`. Rendering the live card on
 * an unknown answer would offer a button that the server answers with 409, so
 * the modest version is the honest one whenever we cannot tell.
 */
function wrap(hasIdentity = true) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <StringingCard hasIdentity={hasIdentity} />
    </NextIntlClientProvider>,
  );
}

/** Answers /shop with `open`, and /jobs with whatever is passed. */
function mockApi(open: boolean | null, jobs: unknown[] = []) {
  const fetchMock = vi.fn().mockImplementation((url: string) =>
      Promise.resolve({
        ok: true,
        json: async () =>
          String(url).includes('/shop') ? { open } : { jobs, view: 'player' },
      } as Response),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.stubGlobal('navigator', { ...global.navigator, onLine: true });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Coming soon is the default', () => {
  it('stays Coming soon while the shop is closed', async () => {
    mockApi(false);
    wrap();
    expect(await screen.findByText('Coming soon')).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Submit a request' })).toBeNull();
  });

  it('stays Coming soon when the shop answer is UNKNOWN', async () => {
    // A throttled or failed probe. Offering the button here would send someone
    // into a 409 — the confident answer is the harmful one.
    mockApi(null);
    wrap();
    expect(await screen.findByText('Coming soon')).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Submit a request' })).toBeNull();
  });

  it('stays Coming soon when the probe throws outright', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    wrap();
    expect(await screen.findByText('Coming soon')).toBeDefined();
  });
});

describe('once the admin opens the shop', () => {
  it('goes live and offers a request', async () => {
    mockApi(true);
    wrap();
    expect(await screen.findByRole('button', { name: 'Submit a request' })).toBeDefined();
    expect(screen.queryByText('Coming soon')).toBeNull();
  });

  it('asks a signed-out visitor for a name instead of failing later', async () => {
    // A request has to belong to somebody. Better to say so on the card than
    // to open a sheet that 401s on submit.
    mockApi(true);
    wrap(false);
    await screen.findByRole('button', { name: 'Submit a request' });
    expect(screen.getByRole('button', { name: 'Submit a request' })).toHaveProperty(
      'disabled',
      true,
    );
    expect(screen.getByText(/Add your name above first/i)).toBeDefined();
  });

  it('shows a racket already with the stringer, in the player’s own words', async () => {
    mockApi(true, [
      {
        id: 'j1',
        jobNo: 'J-0001',
        stage: 'being_strung',
        stageIndex: 1,
        racketLabel: 'Astrox 99 Pro',
        stringLabel: 'BG80',
        tensionMains: 26,
        tensionCrosses: 28,
        method: 'Zach',
        priceRange: '$28–32',
        readyBy: null,
        paid: false,
        createdAt: '',
        updatedAt: '',
      },
    ]);
    wrap();
    // Behind the collapse now: with a racket in, the card opens showing the
    // RAIL, and the racket is what expanding reveals.
    fireEvent.click(await screen.findByRole('button', { name: /Stringing service/i }));

    expect(await screen.findByText('Astrox 99 Pro')).toBeDefined();
    // The player's vocabulary and a BAND — never "strung", never an exact figure.
    expect(screen.getByText(/Being strung/)).toBeDefined();
    expect(screen.getByText(/\$28–32/)).toBeDefined();
  });

  it('does NOT offer a collapse when there is no racket', async () => {
    // With nothing in, the card is two rows and a chevron would offer to hide
    // "Submit a request" — the only reason the card is there.
    mockApi(true, []);
    wrap();
    expect(await screen.findByRole('button', { name: 'Submit a request' })).toBeDefined();
    expect(screen.queryByRole('button', { name: /Stringing service/i })).toBeNull();
  });

  it('collapses to the RAIL when a racket is in, and expands to the racket', async () => {
    mockApi(true, [
      { id: 'j1', jobNo: 'J-1', stage: 'being_strung', stageIndex: 1, racketLabel: 'Astrox 99 Pro',
        stringLabel: 'BG80', tensionMains: 26, tensionCrosses: 28, method: 'Zach',
        priceRange: '$28-32', amountDue: null, readyBy: null, paid: false, createdAt: '', updatedAt: '' },
    ]);
    wrap();
    // Collapsed: the rail is the glance answer, and it is all there is.
    expect(await screen.findByText('Track progress')).toBeDefined();
    expect(screen.queryByText('Astrox 99 Pro')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Submit a request' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Stringing service/i }));

    // Expanded: the detail, and the ways in.
    expect(await screen.findByText('Astrox 99 Pro')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Submit a request' })).toBeDefined();
    // The rail stays — it is the spine of the card, not a collapsed summary
    // that gets swapped out for the detail.
    expect(screen.getByText('Track progress')).toBeDefined();
  });

  it('survives a job with no stage rather than taking Home down', async () => {
    // next-intl THROWS on a missing key — it does not fall back — so an
    // unexpected row shape does not degrade, it crashes the whole tab. Which
    // is exactly what happened: `t('stage.undefined')`.
    mockApi(true, [{ id: 'j1', jobNo: 'J-0001', racketLabel: 'Mystery' }]);
    wrap();
    // The card still renders its normal live state; the malformed row is
    // skipped rather than rendered.
    expect(await screen.findByRole('button', { name: 'Submit a request' })).toBeDefined();
    expect(screen.queryByText('Mystery')).toBeNull();
  });

  it('asks for the player view explicitly, so an admin does not get the bench', async () => {
    mockApi(true);
    wrap();
    await screen.findByRole('button', { name: 'Submit a request' });
    const calls = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    const jobsCall = calls.map((c) => String(c[0])).find((u) => u.includes('/jobs'));
    expect(jobsCall).toContain('view=player');
  });

  it('opens the request sheet, and the sheet asks for no price at all', async () => {
    mockApi(true);
    wrap();
    fireEvent.click(await screen.findByRole('button', { name: 'Submit a request' }));

    await waitFor(() => expect(screen.getByLabelText('Which racket?')).toBeDefined());
    // A player proposing a price would invite a negotiation the app cannot
    // hold. No field, and no longer any promise about one either — the sheet
    // is an intake form, not a quote.
    expect(screen.queryByLabelText(/price/i)).toBeNull();
    expect(screen.queryByText(/confirms the price/i)).toBeNull();
    expect(screen.getByText('Intake form')).toBeDefined();
  });
});

describe('the process strip', () => {
  it('does NOT draw the rail until there is a job', async () => {
    // Four steps and ~90px of vertical space describing a process nobody has
    // started — an explanation charged against the height of a card with
    // nothing to report. The card still offers the way in; it just does not
    // pay for a progress display yet.
    mockApi(true, []);
    wrap();
    await screen.findByRole('button', { name: 'Submit a request' });
    expect(screen.queryByText('Drop off your racket')).toBeNull();
    expect(screen.queryByText('Track progress')).toBeNull();
  });

  it('draws the rail the moment a racket is actually in', async () => {
    mockApi(true, [
      { id: 'j1', jobNo: 'J-1', stage: 'being_strung', stageIndex: 1, racketLabel: 'Astrox',
        stringLabel: 'BG80', tensionMains: 26, tensionCrosses: 28, method: 'Zach',
        priceRange: '$28-32', amountDue: null, readyBy: null, paid: false, createdAt: '', updatedAt: '' },
    ]);
    wrap();
    const strip = (await screen.findByText('Drop off your racket')).closest('ol')!;
    expect(strip).not.toBeNull();
    expect(strip.textContent).toContain('Track progress');
  });

  it('drops the prose subtitle the strip replaced', async () => {
    mockApi(true, []);
    wrap();
    await screen.findByRole('button', { name: 'Submit a request' });
    expect(screen.queryByText(/Hand Grant your racket/i)).toBeNull();
  });

  it('is a text ROW, not a button that competes with sign-up', async () => {
    // As a filled block this outweighed "I'm in this week" — the week's actual
    // decision — from inside the group below it. Home gets exactly one primary.
    mockApi(true, []);
    wrap();
    const cta = await screen.findByRole('button', { name: 'Submit a request' });
    expect(cta.className).toContain('bpm-row-link');
    expect(cta.className).not.toContain('cc-btn-primary');
    expect(cta.className).not.toContain('cc-btn-secondary');
  });
});

describe('view pricing', () => {
  it('is collapsed until asked for, and fetches nothing until then', async () => {
    const fetchMock = mockApi(true, []);
    wrap();
    await screen.findByRole('button', { name: 'Submit a request' });
    // A rate card nobody asked to see is not worth a request on every render.
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('/pricing'))).toBe(false);
  });

  it('lists the posted rates once expanded', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) =>
        Promise.resolve({
          ok: true,
          json: async () => {
            const u = String(url);
            if (u.includes('/shop')) return { open: true };
            if (u.includes('/pricing'))
              return {
                services: [
                  { label: 'Labour', priceCents: 1500 },
                  { label: 'Labour + string', priceCents: 3000 },
                  { label: 'Special requests', priceCents: null },
                ],
              };
            return { jobs: [], view: 'player' };
          },
        } as Response),
      ),
    );
    wrap();
    fireEvent.click(await screen.findByRole('button', { name: /View pricing/i }));

    expect(await screen.findByText('Labour + string')).toBeDefined();
    expect(screen.getByText('$30')).toBeDefined();
    // A null price reads "Ask", never $0.00 — those mean different things.
    expect(screen.getByText('Ask')).toBeDefined();
    expect(screen.queryByText('$0.00')).toBeNull();
  });
});
