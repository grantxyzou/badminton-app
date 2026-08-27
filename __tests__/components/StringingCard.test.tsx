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
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((url: string) =>
      Promise.resolve({
        ok: true,
        json: async () =>
          String(url).includes('/shop') ? { open } : { jobs, view: 'player' },
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

describe('Coming soon is the default', () => {
  it('stays Coming soon while the shop is closed', async () => {
    mockApi(false);
    wrap();
    expect(await screen.findByText('Coming soon')).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Request a restring' })).toBeNull();
  });

  it('stays Coming soon when the shop answer is UNKNOWN', async () => {
    // A throttled or failed probe. Offering the button here would send someone
    // into a 409 — the confident answer is the harmful one.
    mockApi(null);
    wrap();
    expect(await screen.findByText('Coming soon')).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Request a restring' })).toBeNull();
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
    expect(await screen.findByRole('button', { name: 'Request a restring' })).toBeDefined();
    expect(screen.queryByText('Coming soon')).toBeNull();
  });

  it('asks a signed-out visitor for a name instead of failing later', async () => {
    // A request has to belong to somebody. Better to say so on the card than
    // to open a sheet that 401s on submit.
    mockApi(true);
    wrap(false);
    await screen.findByRole('button', { name: 'Request a restring' });
    expect(screen.getByRole('button', { name: 'Request a restring' })).toHaveProperty(
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
    expect(await screen.findByText('Astrox 99 Pro')).toBeDefined();
    // The player's vocabulary and a BAND — never "strung", never an exact figure.
    expect(screen.getByText(/Being strung/)).toBeDefined();
    expect(screen.getByText(/\$28–32/)).toBeDefined();
  });

  it('survives a job with no stage rather than taking Home down', async () => {
    // next-intl THROWS on a missing key — it does not fall back — so an
    // unexpected row shape does not degrade, it crashes the whole tab. Which
    // is exactly what happened: `t('stage.undefined')`.
    mockApi(true, [{ id: 'j1', jobNo: 'J-0001', racketLabel: 'Mystery' }]);
    wrap();
    // The card still renders its normal live state; the malformed row is
    // skipped rather than rendered.
    expect(await screen.findByRole('button', { name: 'Request a restring' })).toBeDefined();
    expect(screen.queryByText('Mystery')).toBeNull();
  });

  it('asks for the player view explicitly, so an admin does not get the bench', async () => {
    mockApi(true);
    wrap();
    await screen.findByRole('button', { name: 'Request a restring' });
    const calls = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    const jobsCall = calls.map((c) => String(c[0])).find((u) => u.includes('/jobs'));
    expect(jobsCall).toContain('view=player');
  });

  it('opens the request sheet, and the sheet asks for no price at all', async () => {
    mockApi(true);
    wrap();
    fireEvent.click(await screen.findByRole('button', { name: 'Request a restring' }));

    await waitFor(() => expect(screen.getByLabelText('Which racket?')).toBeDefined());
    // A player proposing a price would invite a negotiation the app cannot
    // hold. No field, and no longer any promise about one either — the sheet
    // is an intake form, not a quote.
    expect(screen.queryByLabelText(/price/i)).toBeNull();
    expect(screen.queryByText(/confirms the price/i)).toBeNull();
    expect(screen.getByText('Intake form')).toBeDefined();
  });
});
