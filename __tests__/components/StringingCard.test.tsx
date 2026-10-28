// @vitest-environment jsdom
// @vitest-environment-options { "url": "http://localhost:3000/bpm" }
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import StringingCard from '../../components/stringing/StringingCard';
import enMessages from '../../messages/en.json';

/**
 * The Submit request register: the service card, then a card per racket
 * (docs/plans/stringing-canvas-redesign.md).
 *
 * Nothing short of a confirmed `open: true` offers the request button:
 * rendering it on an unknown answer would offer a button the server answers
 * with 409. A closed shop says "Closed"; an unknown one says it could not check.
 */
function wrap(hasIdentity = true) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <StringingCard hasIdentity={hasIdentity} />
    </NextIntlClientProvider>,
  );
}

/** Answers /shop with `open`, and /jobs with whatever is passed. */
function mockApi(open: boolean | null, jobs: unknown[] = [], lastStrungAt: string | null = null) {
  const fetchMock = vi.fn().mockImplementation((url: string) =>
      Promise.resolve({
        ok: true,
        json: async () =>
          String(url).includes('/shop') ? { open } : { jobs, view: 'player', lastStrungAt },
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

describe('closed is said plainly', () => {
  it('says Closed while the shop is closed', async () => {
    mockApi(false);
    wrap();
    expect(await screen.findByText('Closed')).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Submit a request' })).toBeNull();
  });

  // Unknown is not closed (loading cascade, phase 4). A failed or throttled
  // probe used to render "Coming soon" — a shop that could not be READ said it
  // was closed. It now says it could not check, with Retry. The safety half is
  // unchanged: no request button on a guess, because tapping it would 409.
  it('says it could not check, not Closed, when the shop answer is UNKNOWN', async () => {
    mockApi(null);
    wrap();
    expect(await screen.findByText(/Couldn.t check whether the stringing service is open/)).toBeDefined();
    expect(screen.queryByText('Closed')).toBeNull();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Submit a request' })).toBeNull();
  });

  it('says it could not check when the probe throws outright', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    wrap();
    expect(await screen.findByText(/Couldn.t check whether the stringing service is open/)).toBeDefined();
    expect(screen.queryByText('Closed')).toBeNull();
  });

  it('shows a skeleton, not Closed, while the shop has not answered', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    wrap();
    expect(screen.queryByText('Closed')).toBeNull();
  });
});

describe('once the admin opens the shop', () => {
  it('goes live and offers a request', async () => {
    mockApi(true);
    wrap();
    expect(await screen.findByRole('button', { name: 'Submit a request' })).toBeDefined();
    expect(screen.queryByText('Closed')).toBeNull();
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
    expect(screen.getByText(enMessages.home.stringing.needName)).toBeDefined();
  });

  it('shows a racket already with the stringer, in the player’s own words, with the exact quote', async () => {
    mockApi(true, [{ id: 'j1', jobNo: 'J-0001', stage: 'being_strung', stageIndex: 1, racketLabel: 'Astrox 99 Pro',
        stringLabel: 'BG80', tensionMains: 26, tensionCrosses: 28, method: 'Zach',
        quote: 30, amountDue: null, readyBy: null, paid: false, pendingEdit: null, createdAt: '', updatedAt: '' }]);
    wrap();
    // Its own card, open: no fold to tap (Grant: "Does not need collapseing").
    expect(await screen.findByText('Astrox 99 Pro')).toBeDefined();
    // The player's vocabulary, never "strung" — and the stringer's figure,
    // exactly (Grant: "dont hide"), never the old $28–32 band.
    expect(screen.getByText('Being strung')).toBeDefined();
    expect(screen.getByText('Quoted')).toBeDefined();
    expect(screen.getByText('$30')).toBeDefined();
    expect(screen.queryByText(/–/)).toBeNull();
    // The spec line names one tension for the usual +2 pair.
    expect(screen.getByText('J-0001 · BG80 · 26 lb')).toBeDefined();
  });

  it('says "Not priced yet" for a racket with no quote, never $0', async () => {
    mockApi(true, [{ ...{ id: 'j1', jobNo: 'J-0001', stage: 'being_strung', stageIndex: 1, racketLabel: 'Astrox 99 Pro',
        stringLabel: 'BG80', tensionMains: 26, tensionCrosses: 28, method: 'Zach',
        quote: 30, amountDue: null, readyBy: null, paid: false, pendingEdit: null, createdAt: '', updatedAt: '' }, stage: 'with_stringer', quote: null }]);
    wrap();
    expect(await screen.findByText('With the stringer')).toBeDefined();
    expect(screen.getByText('Not priced yet')).toBeDefined();
    expect(screen.queryByText('$0')).toBeNull();
  });

  it('shows no price at all while the racket is still in the bag', async () => {
    mockApi(true, [{ ...{ id: 'j1', jobNo: 'J-0001', stage: 'being_strung', stageIndex: 1, racketLabel: 'Astrox 99 Pro',
        stringLabel: 'BG80', tensionMains: 26, tensionCrosses: 28, method: 'Zach',
        quote: 30, amountDue: null, readyBy: null, paid: false, pendingEdit: null, createdAt: '', updatedAt: '' }, stage: 'awaiting_dropoff' }]);
    wrap();
    expect(await screen.findByText('Waiting for your racket')).toBeDefined();
    expect(screen.queryByText('Quoted')).toBeNull();
  });

  it('never folds: there is no collapse control, with or without a racket', async () => {
    mockApi(true, [{ id: 'j1', jobNo: 'J-0001', stage: 'being_strung', stageIndex: 1, racketLabel: 'Astrox 99 Pro',
        stringLabel: 'BG80', tensionMains: 26, tensionCrosses: 28, method: 'Zach',
        quote: 30, amountDue: null, readyBy: null, paid: false, pendingEdit: null, createdAt: '', updatedAt: '' }]);
    wrap();
    await screen.findByText('Astrox 99 Pro');
    expect(screen.queryByRole('button', { name: /Stringing service/i })).toBeNull();
    expect(document.querySelector('[aria-expanded]')).toBeNull();
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
    /* WAIT for the jobs call rather than assuming it has already happened.
       The button resolves off the SHOP fetch; the jobs fetch is a separate
       request, so reading mock.calls straight after was a race — it passed on
       a fast machine and failed in CI with `jobsCall` undefined. */
    await waitFor(() => {
      const calls = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls;
      const jobsCall = calls.map((c) => String(c[0])).find((u) => u.includes('/jobs'));
      expect(jobsCall).toContain('view=player');
    });
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
    expect(screen.getByText(enMessages.home.stringing.requestSubtitle)).toBeDefined();
  });
});

describe('the process strip', () => {
  it('does NOT draw a strip until there is a job', async () => {
    mockApi(true, []);
    wrap();
    await screen.findByRole('button', { name: 'Submit a request' });
    expect(document.querySelector('ol.bpm-steps')).toBeNull();
  });

  it('draws one strip per racket, in the canvas words', async () => {
    mockApi(true, [{ id: 'j1', jobNo: 'J-0001', stage: 'being_strung', stageIndex: 1, racketLabel: 'Astrox 99 Pro',
        stringLabel: 'BG80', tensionMains: 26, tensionCrosses: 28, method: 'Zach',
        quote: 30, amountDue: null, readyBy: null, paid: false, pendingEdit: null, createdAt: '', updatedAt: '' }, { ...{ id: 'j1', jobNo: 'J-0001', stage: 'being_strung', stageIndex: 1, racketLabel: 'Astrox 99 Pro',
        stringLabel: 'BG80', tensionMains: 26, tensionCrosses: 28, method: 'Zach',
        quote: 30, amountDue: null, readyBy: null, paid: false, pendingEdit: null, createdAt: '', updatedAt: '' }, id: 'j2', jobNo: 'J-0002', racketLabel: 'Thruster F' }]);
    wrap();
    await screen.findByText('Thruster F');
    const strips = document.querySelectorAll('ol.bpm-steps');
    expect(strips).toHaveLength(2);
    expect(strips[0].textContent).toBe('RequestDrop offStringingPick up');
  });

  it('drops the prose subtitle the strip replaced', async () => {
    mockApi(true, []);
    wrap();
    await screen.findByRole('button', { name: 'Submit a request' });
    expect(screen.queryByText(/Hand Grant your racket/i)).toBeNull();
  });

  it('is the tab\'s one real button, with nothing on this tab to compete with', async () => {
    // Grant: "This is not Request anymore. Its the next action." It was a
    // text row while the card sat on Home under the week's sign-up.
    mockApi(true, []);
    wrap();
    const cta = await screen.findByRole('button', { name: 'Submit a request' });
    expect(cta.className).toContain('cc-btn-primary');
    expect(cta.className).not.toContain('bpm-row-link');
  });
});

describe('prices live on the Strings tab (docs/plans/stringing-tabs.md)', () => {
  // The "View pricing" expander listed every string's price a second time,
  // right above the shelf that already showed them. The Strings tab carries
  // all of them now, and this card points there.
  it('has no pricing expander, and never reads the prices', async () => {
    const fetchMock = mockApi(true, []);
    wrap();
    await screen.findByRole('button', { name: 'Submit a request' });
    expect(screen.queryByRole('button', { name: /View pricing/i })).toBeNull();
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('/pricing'))).toBe(false);
  });

  it('offers a way to the Strings tab when it is in one', async () => {
    mockApi(true, []);
    const onShowStrings = vi.fn();
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <StringingCard hasIdentity onShowStrings={onShowStrings} />
      </NextIntlClientProvider>,
    );
    fireEvent.click(await screen.findByRole('button', { name: enMessages.home.stringing.seeStrings }));
    expect(onShowStrings).toHaveBeenCalled();
  });

  it('offers no such link when there is nowhere to go', async () => {
    mockApi(true, []);
    wrap();
    await screen.findByRole('button', { name: 'Submit a request' });
    expect(screen.queryByRole('button', { name: enMessages.home.stringing.seeStrings ?? 'Strings and prices' })).toBeNull();
  });
});

/** Empty/error state audit, 2026-09-14: refused, failed and loading each say so. */
describe('when the racket list is not there', () => {
  function answer(jobsStatus: number, pricingStatus = 200) {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      const u = String(url);
      if (u.includes('/shop')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ open: true }) } as Response);
      if (u.includes('/pricing')) return Promise.resolve({ ok: pricingStatus < 300, status: pricingStatus, json: async () => ({ services: [] }) } as Response);
      return Promise.resolve({ ok: jobsStatus < 300, status: jobsStatus, json: async () => ({ jobs: [] }) } as Response);
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  it('refused: says nothing (Balance above already asks to sign in), no alert, and no request button that would fail', async () => {
    answer(401);
    wrap();
    await waitFor(() =>
      expect((screen.getByRole('button', { name: /Submit a request/ }) as HTMLButtonElement).disabled).toBe(true),
    );
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Sign in' })).toBeNull();
  });

  it('failed: an alert with Try again that asks again', async () => {
    const fetchMock = answer(500);
    wrap();
    expect((await screen.findByRole('alert')).textContent).toBe("Couldn't load your rackets.");
    const before = fetchMock.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(before));
  });
});

describe('the restring reminder', () => {
  const weeksAgo = (n: number) => new Date(Date.now() - n * 7 * 24 * 60 * 60 * 1000 - 60 * 60 * 1000).toISOString();
  const REMINDER = /time for a restring/;

  it('speaks up two months after the shop last strung for them', async () => {
    mockApi(true, [], weeksAgo(9));
    wrap();
    expect(await screen.findByText('Strung 9 weeks ago. Time for a restring?')).toBeDefined();
  });

  it('stays quiet before two months', async () => {
    mockApi(true, [], weeksAgo(7));
    wrap();
    await screen.findByRole('button', { name: 'Submit a request' });
    expect(screen.queryByText(REMINDER)).toBeNull();
  });

  it('says nothing to someone the shop has never strung for', async () => {
    mockApi(true, [], null);
    wrap();
    await screen.findByRole('button', { name: 'Submit a request' });
    expect(screen.queryByText(REMINDER)).toBeNull();
  });

  it('stands down while a racket is with the stringer', async () => {
    mockApi(true, [
      {
        id: 'j1', jobNo: 'J-0001', stage: 'being_strung', stageIndex: 1,
        racketLabel: 'Astrox 99 Pro', stringLabel: 'BG80', tensionMains: 26, tensionCrosses: 26,
        method: '', quote: null, amountDue: null, readyBy: null, paid: false,
        pendingEdit: null, createdAt: '', updatedAt: '',
      },
    ], weeksAgo(20));
    wrap();
    await screen.findByRole('button', { name: 'Submit a request' });
    expect(screen.queryByText(REMINDER)).toBeNull();
  });
});

// Audit 2026-10-11, finding 01: a player with three rackets in saw ONE — the
// card rendered `jobs.find(open)`, and the cap error then told them to collect
// rackets they could not see.
describe('every open racket is listed', () => {
  const two = [
    {
      id: 'j2', jobNo: 'J-0002', stage: 'with_stringer', stageIndex: 0,
      racketLabel: 'Nanoflare 800 Pro', stringLabel: 'Exbolt 63', tensionMains: 27, tensionCrosses: 29,
      method: '', quote: null, amountDue: null, readyBy: null, paid: false,
      pendingEdit: null, createdAt: '2026-10-02T00:00:00Z', updatedAt: '2026-10-02T00:00:00Z',
    },
    {
      id: 'j1', jobNo: 'J-0001', stage: 'ready_for_you', stageIndex: 2,
      racketLabel: 'Astrox 88D Pro', stringLabel: 'BG80 white', tensionMains: 26, tensionCrosses: 28,
      method: '', quote: 30, amountDue: 30, readyBy: null, paid: false,
      pendingEdit: { proposedAt: '2026-10-03T00:00:00Z', priceFrom: null, priceTo: 30 },
      createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-03T00:00:00Z',
    },
  ];

  it('renders a card per open job, not only the first', async () => {
    mockApi(true, two);
    wrap();
    expect(await screen.findByText('Nanoflare 800 Pro')).toBeDefined();
    expect(screen.getByText('Astrox 88D Pro')).toBeDefined();
    expect(screen.getAllByRole('region')).toHaveLength(2);
  });

  it('puts the banner on the racket that has the news, even when it is not the newest', async () => {
    mockApi(true, [two[0], { ...two[1], pendingEdit: null }]);
    wrap();
    const ready = await screen.findByText('Your racket is ready');
    const card = ready.closest('section')!;
    expect(card.textContent).toContain('Astrox 88D Pro');
    expect(card.textContent).toContain('$30');
    expect(screen.getByRole('region', { name: 'Nanoflare 800 Pro' }).textContent).not.toContain('ready');
  });

  it('asks about a change on that racket, with the price diff and one button', async () => {
    mockApi(true, [two[0], { ...two[1], pendingEdit: { proposedAt: '2026-10-03T00:00:00Z', priceFrom: 34, priceTo: 38 } }]);
    wrap();
    const banner = await screen.findByText('The stringer suggested a change');
    const card = banner.closest('section')!;
    expect(card.textContent).toContain('Astrox 88D Pro');
    expect(card.textContent).toContain('$34');
    expect(card.textContent).toContain('$38');
    expect(screen.getAllByRole('button', { name: 'Review the change' })).toHaveLength(1);
  });

  it('opens the confirm sheet from the banner\'s button', async () => {
    mockApi(true, [{ ...two[1], pendingEdit: { proposedAt: '2026-10-03T00:00:00Z', priceFrom: 34, priceTo: 38 } }]);
    wrap();
    fireEvent.click(await screen.findByRole('button', { name: 'Review the change' }));
    expect(await screen.findByText('A change to confirm')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Keep original' })).toBeDefined();
  });

  it('shows no amount on a ready racket that is already paid — the quote is not a bill', async () => {
    // A racket paid before pickup (credit, an e-transfer) owes nothing; the
    // balance card says $0, so the banner must not say $30.
    mockApi(true, [{ ...two[1], pendingEdit: null, amountDue: null, paid: true, quote: 30 }]);
    wrap();
    const ready = await screen.findByText('Your racket is ready');
    expect(ready.closest('section')!.textContent).not.toContain('$30');
  });

  it('offers Cancel request only while the racket is still in the bag, asking first', async () => {
    const waiting = { ...two[0], id: 'jw', stage: 'awaiting_dropoff', quote: null };
    const fetchMock = mockApi(true, [waiting, { ...two[1], pendingEdit: null }]);
    wrap();
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel request' }));
    // Only one racket can be cancelled: the ready one has no such button.
    expect(screen.getByText('Cancel this request? Nothing is owed yet.')).toBeDefined();
    fireEvent.click(screen.getAllByRole('button', { name: 'Cancel request' })[0]);
    await waitFor(() => {
      const call = fetchMock.mock.calls.find((c) => String(c[0]).includes('/api/stringing/jobs/jw/cancel'));
      expect(call?.[1]?.method).toBe('POST');
    });
  });

  it('still shows the one racket when there is only one', async () => {
    mockApi(true, [two[0]]);
    wrap();
    expect(await screen.findByText('Nanoflare 800 Pro')).toBeDefined();
    expect(screen.queryByText('Astrox 88D Pro')).toBeNull();
  });
});
