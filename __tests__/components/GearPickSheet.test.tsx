// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import GearPickSheet from '../../components/stats/GearPickSheet';
import { useGear, type UseGear } from '../../components/stats/useGear';
import enMessages from '../../messages/en.json';
import type { PlayerGear } from '../../lib/types';

/**
 * Format and budget now sit behind the summary line's Change link. They are
 * set once or twice a year, so two labelled segment controls standing open
 * competed with the answer the sheet exists to give. Anything asserting on
 * them opens them first.
 *
 * The one case that does NOT need this is a failed gear read: the preferences
 * are then unknown, there is no honest summary sentence to write, and the
 * controls render already-expanded so they stay reachable.
 */
async function openPrefs() {
  fireEvent.click(await screen.findByRole('button', { name: 'Change' }));
}

/** The spec table is behind a disclosure that names its own row count. */
async function openSpecs() {
  fireEvent.click(await screen.findByRole('button', { name: /Full specs/ }));
}

/**
 * The format and budget segment controls moved here from the deleted
 * `RacketRow`, which pinned them with five tests
 * (`__tests__/components/RacketRow.test.tsx:289, 311, 325, 359, 384`). Those
 * went with the file. This is the equivalent coverage against their new home —
 * without it the controls work only by inspection, and nothing would fail if
 * they stopped.
 *
 * They are driven through the REAL `useGear` hook rather than a stub, because
 * half of what these tests are pinning is that the controls write through the
 * single owner (the shape of the PATCH it emits) rather than a PUT of their
 * own — which is exactly what `StringTensionCard` used to do wrong.
 */

const ITEM = {
  id: 'r1',
  category: 'racket' as const,
  brand: 'Yonex',
  model: 'Astrox 99 Pro',
  skillRange: [3, 6] as [number, number],
  attributes: { weight: '4U', balance: 'head-heavy' },
};

function gearDoc(extra: Partial<PlayerGear> = {}): PlayerGear {
  return { id: 'gear-1', memberId: 'm1', items: [], ...extra } as PlayerGear;
}

/** Records every request so a test can assert on the PATCH body. */
let calls: Array<{ url: string; init?: RequestInit }>;

function mockGear(doc: PlayerGear, patched?: PlayerGear) {
  calls = [];
  vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    const method = (init?.method ?? 'GET').toUpperCase();
    if (url.includes('/api/equipment/gear')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ gear: method === 'PATCH' ? (patched ?? doc) : doc }),
      } as Response);
    }
    return Promise.reject(new Error(`Unmocked fetch: ${url}`));
  }) as unknown as typeof fetch);
}

/** Mounts the real hook and hands the sheet the object it returns. */
function Harness({ pick = true }: { pick?: boolean }) {
  const gear: UseGear = useGear('Lin');
  return (
    <GearPickSheet
      open
      onClose={vi.fn()}
      category="racket"
      pick={pick ? { item: ITEM, reasons: ['Suits your smash.'] } : null}
      owned={false}
      gear={gear}
    />
  );
}

function renderSheet(props: { pick?: boolean } = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <Harness {...props} />
    </NextIntlClientProvider>,
  );
}

describe('GearPickSheet — the relocated format and budget controls', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_FLAG_GEAR_RECOMMENDER = 'true';
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete process.env.NEXT_PUBLIC_FLAG_GEAR_RECOMMENDER;
  });

  it('shows the saved format and budget as the active segment', async () => {
    mockGear(gearDoc({ playFormat: 'doubles', budgetMaxCad: 200 }));
    renderSheet();

    // The summary line says it before you open anything.
    expect(await screen.findByText('For doubles · under $200')).toBeTruthy();
    await openPrefs();

    const doubles = await screen.findByRole('tab', { name: 'Doubles' });
    await waitFor(() => expect(doubles.getAttribute('aria-selected')).toBe('true'));
    expect(screen.getByRole('tab', { name: 'Singles' }).getAttribute('aria-selected')).toBe('false');
    expect(screen.getByRole('tab', { name: '$100–200' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tab', { name: 'No limit' }).getAttribute('aria-selected')).toBe('false');
  });

  // No saved preference yet: format defaults to 'both' and budget to no limit,
  // matching the `?? 'both'` / `?? null` fallbacks — not a blank or unselected
  // control.
  it('defaults to Both and No limit when no preference is saved yet', async () => {
    mockGear(gearDoc());
    renderSheet();
    await openPrefs();

    const both = await screen.findByRole('tab', { name: 'Both' });
    expect(both.getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tab', { name: 'No limit' }).getAttribute('aria-selected')).toBe('true');
  });

  it('tapping a format tab PATCHes the preference through the shared owner', async () => {
    mockGear(gearDoc(), gearDoc({ playFormat: 'singles' }));
    renderSheet();
    await openPrefs();

    fireEvent.click(await screen.findByRole('tab', { name: 'Singles' }));

    await waitFor(() => {
      const patch = calls.find((c) => c.url.includes('/gear') && c.init?.method === 'PATCH');
      expect(patch).toBeTruthy();
      expect(JSON.parse(String(patch!.init!.body))).toEqual({ name: 'Lin', playFormat: 'singles' });
    });
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: 'Singles' }).getAttribute('aria-selected')).toBe('true'),
    );
  });

  it('tapping a budget band PATCHes the preference through the shared owner', async () => {
    mockGear(gearDoc(), gearDoc({ budgetMaxCad: 350 }));
    renderSheet();
    await openPrefs();

    fireEvent.click(await screen.findByRole('tab', { name: '$200–350' }));

    await waitFor(() => {
      const patch = calls.find((c) => c.url.includes('/gear') && c.init?.method === 'PATCH');
      expect(patch).toBeTruthy();
      expect(JSON.parse(String(patch!.init!.body))).toEqual({ name: 'Lin', budgetMaxCad: 350 });
    });
  });

  // Only the two preference controls gate on this flag. The recommendation
  // itself and the Add action are VALUE_HUB_SLICE behaviour and must render
  // either way — bpm-stable runs this flag OFF (deploy-stable.yml:82).
  describe('preference-control gating (NEXT_PUBLIC_FLAG_GEAR_RECOMMENDER)', () => {    it('hides the controls when the flag is off, but keeps the pick and the Add action', async () => {
      process.env.NEXT_PUBLIC_FLAG_GEAR_RECOMMENDER = 'false';
      mockGear(gearDoc());
      renderSheet();

      expect(await screen.findByText('Add to my kit')).toBeTruthy();
      expect(screen.getByText('Astrox 99 Pro')).toBeTruthy();

      expect(screen.queryByRole('tab', { name: 'Both' })).toBeNull();
      expect(screen.queryByRole('tab', { name: 'Singles' })).toBeNull();
      expect(screen.queryByRole('tab', { name: 'Doubles' })).toBeNull();
      expect(screen.queryByRole('tab', { name: 'No limit' })).toBeNull();
      expect(screen.queryByRole('tab', { name: '$100–200' })).toBeNull();
    });

    it('shows the controls when the flag is on', async () => {
      mockGear(gearDoc());
      renderSheet();
      await openPrefs();

      expect(await screen.findByRole('tab', { name: 'Both' })).toBeTruthy();
      expect(screen.getByRole('tab', { name: 'Singles' })).toBeTruthy();
      expect(screen.getByRole('tab', { name: 'Doubles' })).toBeTruthy();
      expect(screen.getByRole('tab', { name: 'No limit' })).toBeTruthy();
    });
  });

  /**
   * The controls are what change the gear doc, so they are also what can make
   * the pick stop resolving — a member who taps past /api/recommend's 10/min
   * limit persists a new budget and then watches the pick fail. Dropping the
   * controls at exactly that moment would leave no surface anywhere to undo it:
   * the rail card behind this sheet renders as a non-interactive div in its
   * error state.
   */
  it('keeps the controls reachable when the pick stops resolving', async () => {
    mockGear(gearDoc({ budgetMaxCad: 350 }));
    renderSheet({ pick: false });

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.queryByText('Add to my kit')).toBeNull();

    const band = screen.getByRole('tab', { name: '$200–350' });
    await waitFor(() => expect(band.getAttribute('aria-selected')).toBe('true'));
    expect(screen.getByRole('tab', { name: 'No limit' })).toBeTruthy();
  });
});

describe('GearPickSheet — the paired tension (spec D2)', () => {
  afterEach(cleanup);

  function TensionHarness({ tensionLbs }: { tensionLbs: number | null }) {
    const gear: UseGear = useGear('Lin');
    return (
      <GearPickSheet
        open
        onClose={vi.fn()}
        category="string"
        pick={{
          item: { ...ITEM, id: 's1', category: 'string' as const, model: 'BG65' },
          reasons: ['Wide usable tension window (22-26 lbs).'],
          pairedWith: { label: 'Yonex Astrox 99 Pro', source: 'owned' },
          tensionLbs,
        }}
        owned={false}
        gear={gear}
      />
    );
  }

  function renderTension(tensionLbs: number | null) {
    mockGear(gearDoc());
    return render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <TensionHarness tensionLbs={tensionLbs} />
      </NextIntlClientProvider>,
    );
  }

  it('shows the tension this string wants on this frame', async () => {
    renderTension(25.5);
    await waitFor(() => expect(screen.getByText(/25\.5/)).toBeTruthy());
    // Never a bare figure: the advisory is what makes it a conversation with a
    // stringer rather than an instruction.
    expect(screen.getByText(/starting point, not a spec/i)).toBeTruthy();
  });

  it('shows no tension at all rather than inventing one', async () => {
    renderTension(null);
    await waitFor(() => expect(screen.getByText(/BG65/)).toBeTruthy());
    expect(screen.queryByText('Suggested tension')).toBeNull();
  });
});

describe('GearPickSheet — the spec sheet has to be readable', () => {
  afterEach(cleanup);

  const N69 = {
    id: 's-n69', category: 'string' as const, brand: 'Li-Ning', model: 'N69',
    skillRange: [1, 5] as [number, number],
    attributes: {
      series: 'N', stringType: 'Durability', technology: 'High Elasticity', gaugeMm: 0.69,
      gaugeClass: 'Standard', construction: 'Solid', feel: 'Medium', feelScale: 3,
      repulsion: 8, durability: 8, control: 7, hittingSound: 7,
      ratingSource: 'Consensus estimate', tensionMinLbs: 22, tensionMaxLbs: 29,
      skillLevel: 'Intermediate', setLengthM: 10, reelLengthM: 200,
      colors: 'White; Yellow', priceSetUsdMin: 13, priceSetUsdMax: 18,
      releaseYear: 2022, lastVerified: '2026-08-20',
    },
  };

  function renderSpec() {
    mockGear(gearDoc());
    function H() {
      const gear: UseGear = useGear('Lin');
      return (
        <GearPickSheet open onClose={vi.fn()} category="string"
          pick={{ item: N69, reasons: ['x'], tensionLbs: 25.5 }} owned={false} gear={gear} />
      );
    }
    return render(
      <NextIntlClientProvider locale="en" messages={enMessages}><H /></NextIntlClientProvider>,
    );
  }

  it('labels the specs it shows, once you ask for them', async () => {
    renderSpec();
    await waitFor(() => expect(screen.getByText('N69')).toBeTruthy());

    // Collapsed by default: seven mono spec rows between the name and the
    // reason meant the eye landed on "0.69mm" before it landed on why this
    // string. The disclosure says how many are in there.
    expect(screen.queryByText('Gauge')).toBeNull();
    await openSpecs();

    expect(screen.getByText('Gauge')).toBeTruthy();
    expect(screen.getByText('0.69mm')).toBeTruthy();
  });

  it('does not dump bookkeeping fields at the member', async () => {
    // lastVerified, ratingSource, reelLengthM and the raw sub-ratings are how
    // the catalog is maintained, not what a player checks before buying. The
    // old line printed all of them, unlabelled, as "· 8 · 8 · 7 · 7 ·".
    renderSpec();
    await waitFor(() => expect(screen.getByText('N69')).toBeTruthy());
    expect(screen.queryByText(/2026-08-20/)).toBeNull();
    expect(screen.queryByText(/Consensus estimate/)).toBeNull();
  });
});

/**
 * A failed gear read makes the stored preferences UNKNOWN, and unknown must
 * not render as a confirmed setting.
 *
 * `useGear` sets `loadError: true` AND `loaded: true` on a failed read with
 * `gear` still null, so `gear.gear?.playFormat ?? 'both'` lit the Both and
 * No-limit segments as though the member had chosen them. Same
 * unknown-as-confirmed bug `GearPickRail.isOwned()` had, reachable the same
 * way — a 500, or a 403 from a member_session past its 30-day TTL.
 */
describe('GearPickSheet — preferences are unknown when the gear read fails', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_FLAG_GEAR_RECOMMENDER = 'true';
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete process.env.NEXT_PUBLIC_FLAG_GEAR_RECOMMENDER;
  });

  function mockGearFailure() {
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/equipment/gear')) {
        return Promise.resolve({ ok: false, status: 500, json: async () => ({ error: 'load_failed' }) } as Response);
      }
      return Promise.reject(new Error(`Unmocked fetch: ${url}`));
    }) as unknown as typeof fetch);
  }

  it('lights no segment and says the read failed', async () => {
    mockGearFailure();
    renderSheet();

    const both = await screen.findByRole('tab', { name: 'Both' });
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());

    // Nothing may claim to be the saved choice.
    expect(both.getAttribute('aria-selected')).toBe('false');
    expect(screen.getByRole('tab', { name: 'Singles' }).getAttribute('aria-selected')).toBe('false');
    expect(screen.getByRole('tab', { name: 'Doubles' }).getAttribute('aria-selected')).toBe('false');
    expect(screen.getByRole('tab', { name: 'No limit' }).getAttribute('aria-selected')).toBe('false');
    expect(screen.getByRole('tab', { name: '$100–200' }).getAttribute('aria-selected')).toBe('false');
  });

  it('still lights "No limit" when the doc genuinely has no budget', async () => {
    mockGear(gearDoc({ playFormat: 'both' }));
    renderSheet();
    await openPrefs();

    const none = await screen.findByRole('tab', { name: 'No limit' });
    await waitFor(() => expect(none.getAttribute('aria-selected')).toBe('true'));
    expect(screen.getByRole('tab', { name: 'Both' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
