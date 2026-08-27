// @vitest-environment jsdom
import { useState } from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import YourKitCard from '../../components/stats/YourKitCard';
import type { UseGear } from '../../components/stats/useGear';
import type { GearItem, PlayerGear } from '../../lib/types';
import { activeRacket, rackets as racketsOf } from '../../lib/activeRacket';
import enMessages from '../../messages/en.json';

/**
 * The kit rows name what the member plays with. For rackets that is the
 * ACTIVE one — a pointer, not a position.
 *
 * This card built its rows by walking `items` and taking the first of each
 * category, so a member whose active racket was not the first one they ever
 * added saw the wrong racket named as theirs, and every other gear surface
 * (all of which resolve through `activeRacket()`) disagreed with this card.
 * It also made "Change" look broken: picking a new racket appends it, so the
 * first item — and therefore this row — never moved.
 */
const OLD = { id: 'r-old', catalogId: 'c-old', category: 'racket' as const, label: 'Old Racket' };
const NEW = { id: 'r-new', catalogId: 'c-new', category: 'racket' as const, label: 'New Racket' };

function fakeGear(doc: PlayerGear, overrides: Partial<UseGear> = {}): UseGear {
  // Resolve through the REAL helper the hook uses, not a hand-rolled lookup.
  // A local `find(id === activeRacketId) ?? null` looks equivalent but drops
  // the legacy fallback (a pointerless bag resolves to items[0]), so the
  // fixture would have asserted against behaviour the app does not have.
  return {
    gear: doc,
    rackets: racketsOf(doc),
    active: activeRacket(doc),
    loaded: true,
    loadError: false,
    busy: false,
    online: true,
    reload: vi.fn(),
    add: vi.fn(async () => ({ ok: true as const })),
    activate: vi.fn(async () => ({ ok: true as const })),
    remove: vi.fn(async () => ({ ok: true as const })),
    setPrefs: vi.fn(async () => ({ ok: true as const })),
    setTension: vi.fn(async () => ({ ok: true as const })),
    ...overrides,
  };
}

function renderCard(gear: UseGear) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <YourKitCard activeName="Lin" gear={gear} />
    </NextIntlClientProvider>,
  );
}

describe('YourKitCard — the racket row names the ACTIVE racket', () => {
  afterEach(cleanup);

  it('shows the active racket even when it is not first in the bag', () => {
    const doc = { id: 'g1', memberId: 'm1', items: [OLD, NEW], activeRacketId: 'r-new' } as PlayerGear;
    renderCard(fakeGear(doc));
    expect(screen.getByLabelText(/^Racket —/).textContent).toContain('New Racket');
    expect(screen.getByLabelText(/^Racket —/).textContent).not.toContain('Old Racket');
  });

  it('falls back to the first racket for a legacy bag with no pointer', () => {
    const doc = { id: 'g1', memberId: 'm1', items: [OLD, NEW] } as PlayerGear;
    // No pointer ever existed. `activeRacket()` falls back to items[0], which
    // is what every other gear surface resolves to, so this row must agree.
    renderCard(fakeGear(doc));
    expect(screen.getByLabelText(/^Racket —/).textContent).toContain('Old Racket');
  });

  /**
   * Strings have no active pointer, so the row falls back to array order —
   * and array order is APPEND order, which made "first" the stalest thing the
   * member ever logged. A member who recorded a tension tonight saw a
   * year-old string named as their kit and no tension anywhere, which reads
   * exactly like the tension never saved.
   */
  it('names the freshest string, not the first one ever added', () => {
    const OLD_STRING = { id: 's-old', catalogId: 'c1', category: 'string' as const, label: 'Old String' };
    const NEW_STRING = { id: 's-new', catalogId: 'c2', category: 'string' as const, label: 'New String', tensionLbs: 27 };
    const doc = {
      id: 'g1', memberId: 'm1', items: [OLD, OLD_STRING, NEW_STRING], activeRacketId: 'r-old',
    } as PlayerGear;
    renderCard(fakeGear(doc));

    const row = screen.getByLabelText(/^Strings —/).textContent ?? '';
    expect(row).toContain('New String');
    expect(row).toContain('27');
    expect(row).not.toContain('Old String');
  });
});

/**
 * The bag-MANAGEMENT surface — remove, use-this-one, set tension.
 *
 * It used to live inside `GearSheet`, in an "Already in your kit" section
 * pinned above the catalog somebody had opened in order to ADD something: two
 * unrelated jobs fighting over one sheet, and the reason the catalog had to
 * hide everything you owned. These tests came with it from
 * `GearSheet.test.tsx`; the browse half stayed there.
 */
describe('YourKitCard — managing what you already own', () => {
  afterEach(cleanup);

  it('lists every owned item, the active one included', () => {
    const doc = { id: 'g1', memberId: 'm1', items: [OLD, NEW], activeRacketId: 'r-new' } as PlayerGear;
    renderCard(fakeGear(doc));
    // A bag of one still has to be removable — the old "hide below two items"
    // guard left a one-item player unable to replace what they owned.
    expect(screen.getByLabelText('Remove — Old Racket')).toBeTruthy();
    expect(screen.getByLabelText('Remove — New Racket')).toBeTruthy();
  });

  it('offers Use this one on the racket that is not active, and a badge on the one that is', () => {
    const doc = { id: 'g1', memberId: 'm1', items: [OLD, NEW], activeRacketId: 'r-new' } as PlayerGear;
    renderCard(fakeGear(doc));
    expect(screen.getByLabelText('Use this one — Old Racket')).toBeTruthy();
    expect(screen.queryByLabelText('Use this one — New Racket')).toBeNull();
  });

  it('wires the rows through to activate and remove', async () => {
    const doc = { id: 'g1', memberId: 'm1', items: [OLD, NEW], activeRacketId: 'r-new' } as PlayerGear;
    const activate = vi.fn(async () => ({ ok: true as const }));
    const remove = vi.fn(async () => ({ ok: true as const }));
    renderCard(fakeGear(doc, { activate, remove }));

    fireEvent.click(screen.getByLabelText('Use this one — Old Racket'));
    await waitFor(() => expect(activate).toHaveBeenCalledWith('r-old'));

    fireEvent.click(screen.getByLabelText('Remove — New Racket'));
    await waitFor(() => expect(remove).toHaveBeenCalledWith('r-new'));
  });

  /**
   * A refused activate or remove used to show the member nothing at all —
   * `YourKitCard` called these as `{ void activate(id) }`, so the button was
   * indistinguishable from a dead one. The answer has to be rendered.
   */
  it('says so when a bag operation is refused, rather than nothing at all', async () => {
    const doc = { id: 'g1', memberId: 'm1', items: [OLD, NEW], activeRacketId: 'r-new' } as PlayerGear;
    const remove = vi.fn(async () => ({ ok: false as const, reason: 'unauthorized' as const }));
    renderCard(fakeGear(doc, { remove }));

    fireEvent.click(screen.getByLabelText('Remove — Old Racket'));
    expect(await screen.findByRole('alert')).toBeTruthy();
  });

  it('stays silent when the operation succeeds', async () => {
    const doc = { id: 'g1', memberId: 'm1', items: [OLD, NEW], activeRacketId: 'r-new' } as PlayerGear;
    renderCard(fakeGear(doc));
    fireEvent.click(screen.getByLabelText('Remove — Old Racket'));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });

  it('renders no manage surface at all when the bag is empty', () => {
    const doc = { id: 'g1', memberId: 'm1', items: [] } as unknown as PlayerGear;
    renderCard(fakeGear(doc));
    expect(screen.queryByLabelText(/^Remove —/)).toBeNull();
    expect(screen.queryByLabelText('Tension you strung at')).toBeNull();
  });
});

/**
 * The tension field moved here with the rows it describes. In `GearSheet` it
 * was parented to nothing — it duplicated a control one row above it, and
 * could only ever describe a string the member did not yet own.
 */
describe('YourKitCard — the string tension field', () => {
  afterEach(cleanup);

  const STRING_A = { id: 's1', catalogId: 'c-s1', category: 'string' as const, label: 'Yonex BG65' };

  function withString(overrides = {}) {
    const doc = {
      id: 'g1', memberId: 'm1', items: [OLD, STRING_A], activeRacketId: 'r-old',
    } as PlayerGear;
    return renderCard(fakeGear(doc, overrides));
  }

  it('offers no tension field when nothing in the bag is a string', () => {
    const doc = { id: 'g1', memberId: 'm1', items: [OLD] } as PlayerGear;
    renderCard(fakeGear(doc));
    expect(screen.queryByLabelText('Tension you strung at')).toBeNull();
  });

  /** Disabled rather than hidden: a control that appears and vanishes as you
   *  type reads as a glitch. */
  it('offers the Set tension control only once a usable number is in the field', () => {
    withString();
    const setBtn = screen.getByLabelText('Set tension — Yonex BG65') as HTMLButtonElement;
    expect(setBtn.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText('Tension you strung at'), { target: { value: '26' } });
    expect((screen.getByLabelText('Set tension — Yonex BG65') as HTMLButtonElement).disabled).toBe(false);
  });

  it('applies the typed tension to the owned string', async () => {
    const setTension = vi.fn(async (_item: GearItem, _lbs: number) => ({ ok: true as const }));
    withString({ setTension });

    fireEvent.change(screen.getByLabelText('Tension you strung at'), { target: { value: '26' } });
    fireEvent.click(screen.getByLabelText('Set tension — Yonex BG65'));

    await waitFor(() => expect(setTension).toHaveBeenCalledTimes(1));
    expect(setTension.mock.calls[0][1]).toBe(26);
  });

  /** The clamp is deliberate, but applying it invisibly at save time means a
   *  typo becomes a plausible-looking tension the member never gave. */
  it('shows the clamped value back on blur, so a typo is not stored invisibly', () => {
    withString();
    const input = screen.getByLabelText('Tension you strung at') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '99' } });
    fireEvent.blur(input);
    expect(input.value).toBe('30');
  });

  /** `Number('')` is 0, which is finite — clamping it would silently save 20
   *  for a member who cleared the field to mean "nothing". */
  it('treats a cleared field as nothing, not as the minimum', () => {
    withString();
    const input = screen.getByLabelText('Tension you strung at') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '26' } });
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.blur(input);
    expect(input.value).toBe('');
    expect((screen.getByLabelText('Set tension — Yonex BG65') as HTMLButtonElement).disabled).toBe(true);
  });

  it('reports a refused tension write through the same error slot as every other write', async () => {
    const setTension = vi.fn(async () => ({ ok: false as const, reason: 'tension_not_saved' as const }));
    withString({ setTension });

    fireEvent.change(screen.getByLabelText('Tension you strung at'), { target: { value: '26' } });
    fireEvent.click(screen.getByLabelText('Set tension — Yonex BG65'));

    expect(await screen.findByRole('alert')).toBeTruthy();
  });

  it('offers no tension control on racket rows', () => {
    withString();
    expect(screen.queryByLabelText('Set tension — Old Racket')).toBeNull();
  });
});

/**
 * The ownership wiring, end to end through the real derivation.
 *
 * `GearSheet.test.tsx` passes `ownedCatalogIds` in directly, so it proves the
 * MARKING logic but not that anything supplies it. The production path is this
 * card mapping `ownedItemsForPicking` → `catalogId`, and the dev seed writes
 * `catalogId: null` (free-text entries), so a browser on the seed can never
 * render a checked row either. Both halves passed while the seam between them
 * was untested — this closes it.
 */
describe('YourKitCard — the picker learns what you own from this card', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  const CATALOG = [
    {
      id: 'racket-yonex-astrox-88d-pro', category: 'racket', brand: 'Yonex', model: 'Astrox 88D Pro',
      msrp: 309, skillRange: [4, 6],
      attributes: { weight: '4U', balance: 'head-heavy', flex: 'stiff' },
    },
    {
      id: 'racket-yonex-nanoflare-800', category: 'racket', brand: 'Yonex', model: 'Nanoflare 800',
      msrp: 250, skillRange: [3, 6],
      attributes: { weight: '4U', balance: 'head-light', flex: 'stiff' },
    },
  ];

  function mockCatalog() {
    global.fetch = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url).includes('/api/equipment/catalog')) {
        return new Response(JSON.stringify({ items: CATALOG }), { status: 200 });
      }
      return new Response('{}', { status: 404 });
    }) as unknown as typeof fetch;
  }

  it('marks the owned catalog row as in-your-kit when the picker opens', async () => {
    mockCatalog();
    const OWNED = {
      id: 'r1', catalogId: 'racket-yonex-astrox-88d-pro', category: 'racket' as const,
      label: 'Yonex Astrox 88D Pro',
    };
    const doc = { id: 'g1', memberId: 'm1', items: [OWNED], activeRacketId: 'r1' } as PlayerGear;
    renderCard(fakeGear(doc));

    fireEvent.click(screen.getByLabelText(/^Racket —/));

    // The catalog row is present AND marked, rather than hidden.
    expect(await screen.findByText('Nanoflare 800')).toBeTruthy();
    expect(screen.getByText('In your kit · using today')).toBeTruthy();
    // And it is inert — an owned row is not something to add.
    expect(screen.queryByRole('button', { name: 'Yonex Astrox 88D Pro' })).toBeNull();
  });

  /** A free-text entry has no catalogId, so it cannot be matched to a row.
   *  That must degrade to "unmarked", never to a crash or a wrong match —
   *  it is what the dev seed writes, and what legacy docs carry. */
  it('leaves the list unmarked when the owned item is free-text', async () => {
    mockCatalog();
    const FREETEXT = {
      id: 'r1', catalogId: null, category: 'racket' as const, label: 'Astrox 88D Pro',
    };
    const doc = { id: 'g1', memberId: 'm1', items: [FREETEXT], activeRacketId: 'r1' } as PlayerGear;
    renderCard(fakeGear(doc));

    fireEvent.click(screen.getByLabelText(/^Racket —/));

    expect(await screen.findByText('Nanoflare 800')).toBeTruthy();
    expect(screen.queryByText(/In your kit/)).toBeNull();
  });
});

/**
 * Tapping a catalog row leaves the sheet OPEN and flips that row in place.
 *
 * This needs a stateful owner: `fakeGear`'s `add` is a stub that reports
 * success without changing the document, so the row could never flip and the
 * assertion would pass vacuously against a component that had simply stopped
 * closing. The harness below mutates the gear doc the way `useGear` does, so
 * the propagation path — add → shared doc → ownedCatalogIds → checked row —
 * is the thing under test rather than the absence of an onClose call.
 */
describe('YourKitCard — a pick confirms itself in place', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  const CATALOG = [
    {
      id: 'racket-yonex-astrox-88d-pro', category: 'racket', brand: 'Yonex', model: 'Astrox 88D Pro',
      msrp: 309, skillRange: [4, 6],
      attributes: { weight: '4U', balance: 'head-heavy', flex: 'stiff' },
    },
  ];

  function Harness() {
    const [doc, setDoc] = useState({ id: 'g1', memberId: 'm1', items: [] } as unknown as PlayerGear);
    const gear = fakeGear(doc, {
      add: async (item: { id: string; category?: string; brand: string; model: string }) => {
        setDoc((d) => ({
          ...d,
          items: [...d.items, {
            id: 'new-1',
            catalogId: item.id,
            category: (item.category ?? 'racket') as 'racket',
            label: `${item.brand} ${item.model}`,
          }],
        }));
        return { ok: true as const };
      },
    } as Partial<UseGear>);
    return (
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <YourKitCard activeName="Lin" gear={gear} />
      </NextIntlClientProvider>
    );
  }

  it('marks the tapped row in place and leaves the sheet open', async () => {
    global.fetch = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url).includes('/api/equipment/catalog')) {
        return new Response(JSON.stringify({ items: CATALOG }), { status: 200 });
      }
      return new Response('{}', { status: 404 });
    }) as unknown as typeof fetch;

    render(<Harness />);
    fireEvent.click(screen.getByLabelText(/^Racket —/));

    const row = await screen.findByRole('button', { name: 'Yonex Astrox 88D Pro' });
    fireEvent.click(row);

    // The row became an owned row...
    expect(await screen.findByText(/In your kit/)).toBeTruthy();
    // ...and is no longer something you can add again.
    expect(screen.queryByRole('button', { name: 'Yonex Astrox 88D Pro' })).toBeNull();
    // ...while the sheet is still standing.
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
});
