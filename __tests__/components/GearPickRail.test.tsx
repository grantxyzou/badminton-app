// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, act } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import GearPickRail, { REC_REFETCH_DEBOUNCE_MS } from '../../components/stats/GearPickRail';
import GearPickSheet from '../../components/stats/GearPickSheet';
import type { UseGear } from '../../components/stats/useGear';
import enMessages from '../../messages/en.json';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const ITEM = {
  id: 'r1',
  category: 'racket' as const,
  brand: 'Yonex',
  model: 'Astrox 99 Pro',
  skillRange: [3, 6] as [number, number],
  attributes: { weight: '4U', balance: 'head-heavy' },
};

function fakeGear(overrides: Partial<UseGear> = {}): UseGear {
  return {
    gear: null,
    rackets: [],
    active: null,
    loaded: true,
    loadError: false,
    busy: false,
    online: true,
    reload: vi.fn(),
    add: vi.fn(async () => ({ ok: true as const })),
    addCustom: vi.fn(async () => ({ ok: true as const })),
    activate: vi.fn(async () => ({ ok: true as const })),
    remove: vi.fn(async () => ({ ok: true as const })),
    setPrefs: vi.fn(async () => ({ ok: true as const })),
    setTension: vi.fn(async () => ({ ok: true as const })),
    ...overrides,
  };
}

function renderRail(gear: UseGear = fakeGear()) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <GearPickRail activeName="Lin" gear={gear} />
    </NextIntlClientProvider>,
  );
}

/** Answers every /api/recommend call with one body. */
function mockRecommend(body: unknown) {
  global.fetch = vi.fn(() =>
    Promise.resolve({ ok: true, json: () => Promise.resolve(body) }),
  ) as unknown as typeof fetch;
}

describe('GearPickRail — a throttled response is not a product state', () => {
  // /api/recommend's rate-limit branch returns a bare {item: null, reason: null}
  // with a 200 and NO `unavailable` field. Rendering that as the parked
  // "Coming soon" card would tell a throttled member that a live category is
  // unbuilt. Unknown must render as unknown.
  it('renders the error state for a 200 with neither item nor unavailable', async () => {
    mockRecommend({ item: null, reason: null });
    renderRail();
    const alerts = await screen.findAllByRole('alert');
    expect(alerts.length).toBeGreaterThan(0);
    expect(screen.queryByText('Why this?')).toBeNull();
  });

  it('still renders the parked card for needsCheckIn — that is an honest empty', async () => {
    mockRecommend({ item: null, reason: null, needsCheckIn: true });
    renderRail();
    expect(await screen.findAllByText('Coming soon')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('renders the parked card for an unavailable category', async () => {
    mockRecommend({ item: null, reason: null, unavailable: 'no_engine' });
    renderRail();
    expect(await screen.findAllByText('Coming soon')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('GearPickRail — the card opens the detail sheet', () => {
  it('tapping a ready card opens GearPickSheet with its reasons and the add action', async () => {
    mockRecommend({
      item: ITEM,
      reason: 'Suits your smash.',
      reasons: ['Suits your smash.', 'Four people at the club play it.'],
      warnings: ['Heavier than most 4U frames.'],
    });
    renderRail();

    const card = await screen.findByLabelText('Racket — Why this?');
    fireEvent.click(card);

    expect(await screen.findByText('Add to my equipment')).toBeTruthy();
    // The headline reason reads as plain language; the rest sit under WHY THIS.
    expect(screen.getByText('Four people at the club play it.')).toBeTruthy();
    // A warning is never collapsed away.
    expect(screen.getByText('Heavier than most 4U frames.')).toBeTruthy();
  });

  it('adding goes through the shared gear owner, not a fetch of its own', async () => {
    mockRecommend({ item: ITEM, reason: null, reasons: ['Suits your smash.'] });
    const gear = fakeGear();
    renderRail(gear);

    fireEvent.click(await screen.findByLabelText('Racket — Why this?'));
    fireEvent.click(await screen.findByText('Add to my equipment'));

    expect(gear.add).toHaveBeenCalledWith(expect.objectContaining({ id: 'r1' }));
  });

  // RacketRecCard's disclosure tap was the ONLY writer of the Value-Hub
  // Slice-0 kill-criterion, and deleting it without replacing the beacon would
  // flatline the metric — which the append-only `events` container cannot
  // distinguish afterwards from real disengagement.
  it('records the Slice-0 engagement beacon when a card opens', async () => {
    mockRecommend({ item: ITEM, reason: null, reasons: [] });
    renderRail();

    fireEvent.click(await screen.findByLabelText('Racket — Why this?'));

    await waitFor(() => {
      const posted = (global.fetch as ReturnType<typeof vi.fn>).mock.calls
        .map((c) => String(c[0]))
        .filter((u) => u.includes('/api/events'));
      expect(posted.length).toBe(1);
    });
  });

  it('asks /api/recommend once per sourced category, not once per rail slot', async () => {
    mockRecommend({ item: ITEM, reason: null, reasons: [] });
    renderRail();

    await screen.findByLabelText('Racket — Why this?');
    const asked = (global.fetch as ReturnType<typeof vi.fn>).mock.calls
      .map((c) => String(c[0]))
      .filter((u) => u.includes('/api/recommend'));
    expect(asked.length).toBe(2);
  });
});

describe('GearPickRail — a preference change must not strand a category', () => {
  /**
   * The refresh skip-list is a burn-rate saving against /api/recommend's
   * 10/min/IP limit, and it must skip PARKED only. Skipping `loading` too
   * strands the category permanently: the previous effect run's cleanup has
   * already set `live = false`, discarding the response that was going to
   * settle it, so it sits on CardSkeleton forever — a fifth state, and not one
   * of the four honest ones. Reachable in one gesture: racket resolves fast,
   * the member opens the sheet and taps a budget band while `string` is still
   * in flight.
   */
  it('re-asks a still-in-flight category on a preference change', async () => {
    let stringAsks = 0;
    global.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('category=string')) {
        stringAsks += 1;
        // The first ask is held open forever — it is the one the refresh's
        // cleanup discards.
        if (stringAsks === 1) return new Promise<Response>(() => {});
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ item: null, unavailable: 'no_engine' }) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ item: ITEM, reasons: [] }) });
    }) as unknown as typeof fetch;

    const ui = (gear: UseGear) => (
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <GearPickRail activeName="Lin" gear={gear} />
      </NextIntlClientProvider>
    );

    const { rerender } = render(ui(fakeGear()));
    await screen.findByLabelText('Racket — Why this?');
    expect(stringAsks).toBe(1);

    // The member changes their budget: same shape as tapping a band in the
    // sheet — the gear doc changes, so the rail's recKey changes.
    rerender(ui(fakeGear({ gear: { id: 'g', memberId: 'm', updatedAt: '2026-01-01', items: [], budgetMaxCad: 200 } })));

    // Strings settles into its parked card instead of shimmering forever.
    expect(await screen.findByText(enMessages.stats.gear.railStringsSoon)).toBeTruthy();
    expect(stringAsks).toBe(2);
  });

  it('does NOT re-ask a category that already answered parked', async () => {
    const asks: string[] = [];
    global.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      asks.push(url);
      if (url.includes('category=string')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ item: null, unavailable: 'no_engine' }) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ item: ITEM, reasons: [] }) });
    }) as unknown as typeof fetch;

    const ui = (gear: UseGear) => (
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <GearPickRail activeName="Lin" gear={gear} />
      </NextIntlClientProvider>
    );

    const { rerender } = render(ui(fakeGear()));
    await screen.findByText(enMessages.stats.gear.railStringsSoon);

    rerender(ui(fakeGear({ gear: { id: 'g', memberId: 'm', updatedAt: '2026-01-01', items: [], budgetMaxCad: 200 } })));

    await waitFor(() => expect(asks.filter((u) => u.includes('category=racket')).length).toBe(2));
    expect(asks.filter((u) => u.includes('category=string')).length).toBe(1);
  });
});

describe('GearPickSheet — a pick that went away is an error, not a vanishing sheet', () => {
  // The controls inside the sheet change the gear doc, which refetches the
  // pick. If that comes back empty (a throttled response is the easy way in),
  // unmounting the sheet would drop the member mid-interaction with no
  // explanation. It stays and says so instead.
  it('renders an error state when open with no resolved pick', () => {
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <GearPickSheet open onClose={vi.fn()} category="racket" pick={null} owned={false} gear={fakeGear()} />
      </NextIntlClientProvider>,
    );
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.queryByText('Add to my equipment')).toBeNull();
  });
});

describe('GearPickRail — the fit answers re-ask the racket, and strings only when the frame can move', () => {
  const ui = (gear: UseGear) => (
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <GearPickRail activeName="Lin" gear={gear} />
    </NextIntlClientProvider>
  );
  const owned = { id: 'i1', catalogId: 'r-owned', category: 'racket' as const, label: 'Yonex Astrox 88D Pro' };
  const doc = (extra: object) => ({ id: 'g', memberId: 'm', updatedAt: '2026-01-01', items: [], ...extra });

  function countAsks() {
    const asks: string[] = [];
    global.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      asks.push(url);
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ item: ITEM, reasons: [] }) });
    }) as unknown as typeof fetch;
    return asks;
  }
  const racketAsks = (asks: string[]) => asks.filter((u) => u.includes('category=racket')).length;
  const stringAsks = (asks: string[]) => asks.filter((u) => u.includes('category=string')).length;

  /** Mount on real timers (the first pass is immediate), then switch to fake
   *  ones so the debounce is driven by the exported constant rather than by
   *  a sleep that would pass for the wrong reason if the constant moved. */
  async function mounted(gear: UseGear) {
    const r = render(ui(gear));
    await screen.findByLabelText('Racket — Why this?');
    vi.useFakeTimers();
    return r;
  }
  const elapse = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

  afterEach(() => { vi.useRealTimers(); });

  it('a fit-only change re-asks the racket but NOT the string when the member owns a racket', async () => {
    const asks = countAsks();
    const { rerender } = await mounted(fakeGear({ gear: doc({ items: [owned] }), rackets: [owned] }));
    expect(asks).toHaveLength(2);

    rerender(ui(fakeGear({ gear: doc({ items: [owned], fitGoal: 'more_power' }), rackets: [owned] })));
    await elapse(REC_REFETCH_DEBOUNCE_MS);
    expect(racketAsks(asks)).toBe(2);
    expect(stringAsks(asks)).toBe(1);
  });

  it('a fit-only change re-asks BOTH when the member owns no racket — the string pairs against the recommended frame', async () => {
    const asks = countAsks();
    const { rerender } = await mounted(fakeGear({ gear: doc({}) }));

    rerender(ui(fakeGear({ gear: doc({ fitSwing: 'fast' }) })));
    await elapse(REC_REFETCH_DEBOUNCE_MS);
    expect(racketAsks(asks)).toBe(2);
    expect(stringAsks(asks)).toBe(2);
  });

  it('a burst of fit changes collapses into one refetch pass', async () => {
    const asks = countAsks();
    const { rerender } = await mounted(fakeGear({ gear: doc({ items: [owned] }), rackets: [owned] }));

    rerender(ui(fakeGear({ gear: doc({ items: [owned], fitGoal: 'faster' }), rackets: [owned] })));
    await elapse(REC_REFETCH_DEBOUNCE_MS / 2);
    rerender(ui(fakeGear({ gear: doc({ items: [owned], fitGoal: 'faster', fitSwing: 'fast' }), rackets: [owned] })));
    await elapse(REC_REFETCH_DEBOUNCE_MS / 2);
    rerender(ui(fakeGear({ gear: doc({ items: [owned], fitGoal: 'faster', fitSwing: 'fast', fitGrip: 'G5' }), rackets: [owned] })));
    expect(racketAsks(asks)).toBe(1);
    await elapse(REC_REFETCH_DEBOUNCE_MS);
    expect(racketAsks(asks)).toBe(2);
    await elapse(REC_REFETCH_DEBOUNCE_MS * 2);
    expect(racketAsks(asks)).toBe(2);
  });

  it('a format or budget tap is NOT debounced — the pick under the open sheet must not sit stale', async () => {
    const asks = countAsks();
    const { rerender } = await mounted(fakeGear({ gear: doc({}) }));

    rerender(ui(fakeGear({ gear: doc({ budgetMaxCad: 200 }) })));
    await act(async () => {});
    expect(racketAsks(asks)).toBe(2);
  });

  it('adding a racket does NOT re-ask — the rail is keyed on preferences, never on the bag', async () => {
    // The regression this pins: keying the effect on "owns a racket" made
    // adding the recommended racket re-score with that racket now excluded,
    // swapping the pick out from under the YOU OWN THIS flip.
    const asks = countAsks();
    const { rerender } = await mounted(fakeGear({ gear: doc({}) }));
    expect(asks).toHaveLength(2);

    rerender(ui(fakeGear({ gear: doc({ items: [owned] }), rackets: [owned] })));
    await elapse(REC_REFETCH_DEBOUNCE_MS * 2);
    expect(asks).toHaveLength(2);
  });

  it('a fit-only change still re-asks a string that is LOADING — never strands it on the skeleton', async () => {
    let stringAsks = 0;
    global.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('category=string')) {
        stringAsks += 1;
        if (stringAsks === 1) return new Promise<Response>(() => {});
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ item: null, unavailable: 'no_engine' }) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ item: ITEM, reasons: [] }) });
    }) as unknown as typeof fetch;
    const { rerender } = await mounted(fakeGear({ gear: doc({ items: [owned] }), rackets: [owned] }));
    expect(stringAsks).toBe(1);
    rerender(ui(fakeGear({ gear: doc({ items: [owned], fitGoal: 'more_power' }), rackets: [owned] })));
    await elapse(REC_REFETCH_DEBOUNCE_MS);
    expect(stringAsks).toBe(2);
  });

  it('a fit-only change re-asks an ERRORED string — its only retry path short of a reload', async () => {
    let stringAsks = 0;
    global.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('category=string')) {
        stringAsks += 1;
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ item: null, reason: null }) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ item: ITEM, reasons: [] }) });
    }) as unknown as typeof fetch;
    const { rerender } = await mounted(fakeGear({ gear: doc({ items: [owned] }), rackets: [owned] }));
    rerender(ui(fakeGear({ gear: doc({ items: [owned], fitSwing: 'fast' }), rackets: [owned] })));
    await elapse(REC_REFETCH_DEBOUNCE_MS);
    expect(stringAsks).toBe(2);
  });

  it('a free-text racket does NOT fix the frame — the server pairs against the recommended one, so strings re-ask', async () => {
    const asks = countAsks();
    const typed = { id: 'i2', catalogId: null, category: 'racket' as const, label: 'Astrox 88D Pro' };
    const { rerender } = await mounted(fakeGear({ gear: doc({ items: [typed] }), rackets: [typed] }));
    rerender(ui(fakeGear({ gear: doc({ items: [typed], fitGoal: 'faster' }), rackets: [typed] })));
    await elapse(REC_REFETCH_DEBOUNCE_MS);
    expect(stringAsks(asks)).toBe(2);
  });

  it('a string-budget change re-asks at once — it is a preference the pairing engine reads', async () => {
    const asks = countAsks();
    const { rerender } = await mounted(fakeGear({ gear: doc({ items: [owned] }), rackets: [owned] }));
    rerender(ui(fakeGear({ gear: doc({ items: [owned], stringBudgetMaxCad: 25 }), rackets: [owned] })));
    await act(async () => {});
    expect(stringAsks(asks)).toBe(2);
  });

  it('the pick sheet\'s Fit link closes it through close(), so nothing leaks into the next opening', async () => {
    countAsks();
    process.env.NEXT_PUBLIC_FLAG_GEAR_RECOMMENDER = 'true';
    const onOpenFit = vi.fn();
    try {
      render(
        <NextIntlClientProvider locale="en" messages={enMessages}>
          <GearPickRail activeName="Lin" gear={fakeGear({ gear: doc({}) })} onOpenFit={onOpenFit} />
        </NextIntlClientProvider>,
      );
      fireEvent.click(await screen.findByLabelText('Racket — Why this?'));
      // Expand the prefs block, then leave through Fit.
      fireEvent.click(await screen.findByRole('button', { name: 'Change' }));
      expect(await screen.findByRole('tab', { name: 'Doubles' })).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Fit' }));
      expect(onOpenFit).toHaveBeenCalledTimes(1);
      await waitFor(() => expect(screen.queryByText(enMessages.stats.gear.pickSheetAdd)).toBeNull());
      // Reopen: the block is folded again.
      fireEvent.click(await screen.findByLabelText('Racket — Why this?'));
      await screen.findByRole('button', { name: 'Change' });
      expect(screen.queryByRole('tab', { name: 'Doubles' })).toBeNull();
    } finally {
      delete process.env.NEXT_PUBLIC_FLAG_GEAR_RECOMMENDER;
    }
  });

  it('renders no Fit link when the rail has nowhere to send it', async () => {
    countAsks();
    process.env.NEXT_PUBLIC_FLAG_GEAR_RECOMMENDER = 'true';
    try {
      render(ui(fakeGear({ gear: doc({}) })));
      fireEvent.click(await screen.findByLabelText('Racket — Why this?'));
      await screen.findByRole('button', { name: 'Change' });
      expect(screen.queryByRole('button', { name: 'Fit' })).toBeNull();
    } finally {
      delete process.env.NEXT_PUBLIC_FLAG_GEAR_RECOMMENDER;
    }
  });
});
