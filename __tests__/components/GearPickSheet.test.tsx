// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import GearPickSheet from '../../components/stats/GearPickSheet';
import { useGear, type UseGear } from '../../components/stats/useGear';
import enMessages from '../../messages/en.json';
import type { PlayerGear } from '../../lib/types';

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
    process.env.NEXT_PUBLIC_FLAG_RACKET_RECOMMENDER = 'true';
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete process.env.NEXT_PUBLIC_FLAG_RACKET_RECOMMENDER;
  });

  it('shows the saved format and budget as the active segment', async () => {
    mockGear(gearDoc({ playFormat: 'doubles', budgetMaxCad: 200 }));
    renderSheet();

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

    const both = await screen.findByRole('tab', { name: 'Both' });
    expect(both.getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tab', { name: 'No limit' }).getAttribute('aria-selected')).toBe('true');
  });

  it('tapping a format tab PATCHes the preference through the shared owner', async () => {
    mockGear(gearDoc(), gearDoc({ playFormat: 'singles' }));
    renderSheet();

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
  describe('preference-control gating (NEXT_PUBLIC_FLAG_RACKET_RECOMMENDER)', () => {
    it('hides the controls when the flag is off, but keeps the pick and the Add action', async () => {
      process.env.NEXT_PUBLIC_FLAG_RACKET_RECOMMENDER = 'false';
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
