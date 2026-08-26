// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import GearSheet from '../../components/stats/GearSheet';
import { useGear } from '../../components/stats/useGear';
import enMessages from '../../messages/en.json';
import type { GearItem } from '../../lib/types';

/**
 * GearSheet is the one place a category's items live: what you already own
 * (via `BagList`) plus the catalog to add or change it. The behaviours worth
 * pinning here are the ones that changed with that shape: one tap commits and
 * closes (no Save button), rackets already owned never appear in the catalog
 * list, every row shows its brand, owned items surface above the catalog, and
 * (strings only) an edited tension value rides along on the pick.
 */

const CATALOG = [
  {
    id: 'racket-yonex-astrox-88d-pro', category: 'racket', brand: 'Yonex', model: 'Astrox 88D Pro',
    msrp: 309, skillRange: [4, 6],
    attributes: { weight: '4U', balance: 'head-heavy', flex: 'stiff', playStyle: 'doubles back-court attack' },
  },
  {
    id: 'racket-yonex-nanoflare-800', category: 'racket', brand: 'Yonex', model: 'Nanoflare 800',
    msrp: 250, skillRange: [3, 6],
    attributes: { weight: '4U', balance: 'head-light', flex: 'stiff' },
  },
  {
    id: 'racket-victor-drivex-9x', category: 'racket', brand: 'Victor', model: 'DriveX 9X',
    msrp: 200, skillRange: [3, 5],
    attributes: { weight: '3U', balance: 'even', flex: 'stiff' },
  },
];

const STRING_CATALOG = [
  {
    id: 'string-yonex-bg65', category: 'string', brand: 'Yonex', model: 'BG65',
    msrp: 12, skillRange: [1, 6],
    attributes: { gaugeMm: 0.7, stringType: 'nylon', feel: 'durable' },
  },
];

function mockCatalog(items: unknown = CATALOG, status = 200) {
  global.fetch = vi.fn(async (url: RequestInfo | URL) => {
    if (String(url).includes('/api/equipment/catalog')) {
      return new Response(JSON.stringify({ items }), { status });
    }
    return new Response('{}', { status: 404 });
  }) as unknown as typeof fetch;
}

/** Also answers `/api/stats/level`, for the string-tension prefill. `level:
 *  null` mimics a member with no check-in yet — `recommendTension` returns
 *  `null` for that, same as `StringTensionCard`. */
function mockCatalogAndLevel(items: unknown = STRING_CATALOG, level: number | null = 3) {
  global.fetch = vi.fn(async (url: RequestInfo | URL) => {
    const u = String(url);
    if (u.includes('/api/equipment/catalog')) {
      return new Response(JSON.stringify({ items }), { status: 200 });
    }
    if (u.includes('/api/stats/level')) {
      return new Response(JSON.stringify({ level: level === null ? null : { level } }), { status: 200 });
    }
    return new Response('{}', { status: 404 });
  }) as unknown as typeof fetch;
}

type PickFn = React.ComponentProps<typeof GearSheet>['onPick'];

function renderSheet(props: Partial<React.ComponentProps<typeof GearSheet>> = {}) {
  const onPick = (props.onPick ?? vi.fn(async () => ({ ok: true as const }))) as ReturnType<typeof vi.fn> & PickFn;
  const onClose = props.onClose ?? vi.fn();
  const utils = render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <GearSheet
        open
        onClose={onClose}
        ownedCatalogIds={[]}
        onPick={onPick}
        busy={false}
        online
        {...props}
      />
    </NextIntlClientProvider>,
  );
  return { ...utils, onPick, onClose };
}

beforeEach(() => {
  vi.useRealTimers();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('GearSheet (catalog picker)', () => {
  it('renders a brand tab per catalog brand and a search box', async () => {
    mockCatalog();
    renderSheet();
    expect(await screen.findByRole('tab', { name: 'Yonex' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Victor' })).toBeTruthy();
    expect(screen.getByPlaceholderText('Search rackets')).toBeTruthy();
  });

  /**
   * Opens on All, not on whichever brand happens to be first in the catalog.
   * Defaulting to a brand put 46 of the 71 rackets behind a tab the member had
   * no reason to suspect was hiding anything — reported to us as "the racket
   * database isn't showing some rackets".
   */
  it('opens showing every brand, and a brand tab narrows to it', async () => {
    mockCatalog();
    renderSheet();
    expect(await screen.findByText('Astrox 88D Pro')).toBeTruthy();
    expect(screen.getByText('4U · head-heavy · stiff')).toBeTruthy();
    expect(screen.getByText('DriveX 9X')).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'All' }).getAttribute('aria-selected')).toBe('true');

    fireEvent.click(screen.getByRole('tab', { name: 'Victor' }));
    expect(screen.getByText('DriveX 9X')).toBeTruthy();
    expect(screen.queryByText('Astrox 88D Pro')).toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: 'All' }));
    expect(screen.getByText('Astrox 88D Pro')).toBeTruthy();
  });

  // The whole point of the redesign: picking is one tap, not tap-then-Save.
  it('tapping a model picks it and closes the sheet — there is no Save button', async () => {
    mockCatalog();
    const { onPick, onClose } = renderSheet();
    fireEvent.click(await screen.findByText('Nanoflare 800'));

    await waitFor(() => expect(onPick).toHaveBeenCalledTimes(1));
    expect(onPick.mock.calls[0][0].id).toBe('racket-yonex-nanoflare-800');
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: /^Save/ })).toBeNull();
  });

  // A category with nothing owned yet shows no owned-items section — BagList
  // itself renders null on an empty list, and the sheet must not draw an
  // empty "Your rackets" shell above the catalog.
  it('renders no owned-items section when the player owns nothing in this category yet', async () => {
    mockCatalog();
    renderSheet();
    await screen.findByText('Astrox 88D Pro');
    expect(screen.queryByText('Using today')).toBeNull();
  });

  it('omits rackets already in the bag', async () => {
    mockCatalog();
    renderSheet({ ownedCatalogIds: ['racket-yonex-astrox-88d-pro'] });
    expect(await screen.findByText('Nanoflare 800')).toBeTruthy();
    expect(screen.queryByText('Astrox 88D Pro')).toBeNull();
  });

  // If every racket of a brand is already owned, that brand's tab must go too
  // — an empty tab you can stand on reads as broken.
  it('drops a brand tab once all of its rackets are owned, and moves off it', async () => {
    mockCatalog();
    renderSheet({
      ownedCatalogIds: ['racket-yonex-astrox-88d-pro', 'racket-yonex-nanoflare-800'],
    });
    expect(await screen.findByText('DriveX 9X')).toBeTruthy();
    expect(screen.queryByRole('tab', { name: 'Yonex' })).toBeNull();
    // Falls back to All rather than to some other brand: All is a superset, so
    // it cannot itself be the tab that just emptied.
    expect(screen.getByRole('tab', { name: 'All' }).getAttribute('aria-selected')).toBe('true');
  });

  it('moves off a brand tab that empties while you are standing on it', async () => {
    mockCatalog();
    const sheet = (ownedCatalogIds: string[]) => (
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <GearSheet
          open
          onClose={vi.fn()}
          ownedCatalogIds={ownedCatalogIds}
          onPick={vi.fn(async () => ({ ok: true as const }))}
          busy={false}
          online
        />
      </NextIntlClientProvider>
    );
    const { rerender } = render(sheet([]));
    await screen.findByText('DriveX 9X');
    fireEvent.click(screen.getByRole('tab', { name: 'Victor' }));
    expect(screen.getByRole('tab', { name: 'Victor' }).getAttribute('aria-selected')).toBe('true');

    rerender(sheet(['racket-victor-drivex-9x']));
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: 'All' }).getAttribute('aria-selected')).toBe('true'),
    );
  });

  it('does not fire onPick while busy', async () => {
    mockCatalog();
    const { onPick } = renderSheet({ busy: true });
    fireEvent.click(await screen.findByText('Astrox 88D Pro'));
    expect(onPick).not.toHaveBeenCalled();
  });

  it('says so when the catalog is empty, instead of rendering a blank sheet', async () => {
    // Regression: the production container held zero rackets, and the sheet
    // drew a title and a hint over nothing — loaded-empty was
    // indistinguishable from broken.
    mockCatalog([]);
    renderSheet();
    expect(await screen.findByText(/No rackets in the catalog yet/)).toBeTruthy();
    expect(screen.queryByRole('tab')).toBeNull();
  });

  it('shows an error pill when the catalog GET fails, not an empty state', async () => {
    mockCatalog(null, 500);
    renderSheet();
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.queryByRole('tab')).toBeNull();
    // A load failure is not a loaded-empty catalog — the two must not share
    // a rendering.
    expect(screen.queryByText(/No rackets in the catalog yet/)).toBeNull();
  });
});

describe('GearSheet refusal messages', () => {
  // Both 409 reasons are unreachable by design now (owned rackets are filtered
  // out, and the tab disables Add at MAX_RACKETS). They stay mapped so a bag
  // that fills some other way says so rather than reading as a crash.
  it.each([
    ['bag_full', "That's all the rackets we can hold — remove one first."],
    ['duplicate_racket', 'That racket is already in your bag.'],
  ] as const)('surfaces the %s refusal and keeps the sheet open', async (reason, message) => {
    mockCatalog();
    const onPick = vi.fn(async () => ({ ok: false as const, reason }));
    const { onClose } = renderSheet({ onPick });
    fireEvent.click(await screen.findByText('Astrox 88D Pro'));

    expect(await screen.findByText(message)).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('falls back to the generic error rather than asserting a reason the server did not give', async () => {
    mockCatalog();
    const onPick = vi.fn(async () => ({ ok: false as const, reason: 'error' as const }));
    const { onClose } = renderSheet({ onPick });
    fireEvent.click(await screen.findByText('Astrox 88D Pro'));

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.queryByText("That's all the rackets we can hold — remove one first.")).toBeNull();
    expect(screen.queryByText('That racket is already in your bag.')).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('GearSheet search', () => {
  it('matches on model across every brand, ignoring the selected tab', async () => {
    mockCatalog();
    renderSheet();
    await waitFor(() => screen.getByText('Astrox 88D Pro'));
    fireEvent.change(screen.getByPlaceholderText('Search rackets'), { target: { value: 'drivex' } });
    // DriveX is a Victor racket; the sheet opens on Yonex.
    expect(screen.getByText('DriveX 9X')).toBeTruthy();
    expect(screen.queryByText('Astrox 88D Pro')).toBeNull();
  });

  // The row's brand used to live only in its aria-label, so a cross-brand
  // search — the one case where brand is exactly what you're matching on —
  // rendered as bare model names.
  it('shows the brand on the row, visibly, in cross-brand results', async () => {
    mockCatalog();
    renderSheet();
    await waitFor(() => screen.getByText('Astrox 88D Pro'));
    fireEvent.change(screen.getByPlaceholderText('Search rackets'), { target: { value: 'drivex' } });
    // Brand tabs are hidden while a query is active, so this can only be the
    // row's own visible brand label.
    expect(screen.queryByRole('tab')).toBeNull();
    expect(screen.getByText('Victor')).toBeTruthy();
  });

  it('matches case-insensitively on brand', async () => {
    mockCatalog();
    renderSheet();
    await waitFor(() => screen.getByText('Astrox 88D Pro'));
    fireEvent.change(screen.getByPlaceholderText('Search rackets'), { target: { value: 'VICTOR' } });
    expect(screen.getByText('DriveX 9X')).toBeTruthy();
  });

  // A search miss is not a broken screen.
  it('shows an empty state, not an error, when nothing matches', async () => {
    mockCatalog();
    renderSheet();
    await waitFor(() => screen.getByText('Astrox 88D Pro'));
    fireEvent.change(screen.getByPlaceholderText('Search rackets'), { target: { value: 'zzzz' } });
    expect(screen.getByText('No rackets match that.')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('restores brand browsing when the query is cleared', async () => {
    mockCatalog();
    renderSheet();
    await waitFor(() => screen.getByText('Astrox 88D Pro'));
    const input = screen.getByPlaceholderText('Search rackets');
    fireEvent.change(input, { target: { value: 'drivex' } });
    expect(screen.queryByText('Astrox 88D Pro')).toBeNull();

    fireEvent.change(input, { target: { value: '' } });
    // Back to the tab that was selected before the query — All, here.
    expect(screen.getByText('Astrox 88D Pro')).toBeTruthy();
    expect(screen.getByText('DriveX 9X')).toBeTruthy();
  });

  /** The reported bug, end to end through the sheet. */
  it('finds a racket through a misspelling', async () => {
    mockCatalog();
    renderSheet();
    await waitFor(() => screen.getByText('Astrox 88D Pro'));
    fireEvent.change(screen.getByPlaceholderText('Search rackets'), { target: { value: 'drivx' } });
    expect(screen.getByText('DriveX 9X')).toBeTruthy();
  });
});

describe('GearSheet — owned items', () => {
  // The whole point of Task 6: BagList moved back into the sheet, so a
  // category's owned items and the catalog to add more of them live in one
  // place again.
  it('lists items you already own above the catalog', async () => {
    mockCatalog();
    renderSheet({ ownedItems: [{ id: 'g1', catalogId: 'c1', category: 'racket', label: 'Astrox 88D' }] });
    expect(await screen.findByText('Astrox 88D')).toBeTruthy();
  });

  it('wires the owned list through to onActivate and onRemove', async () => {
    mockCatalog();
    const onActivate = vi.fn();
    const onRemove = vi.fn();
    renderSheet({
      ownedItems: [
        { id: 'g1', catalogId: 'racket-yonex-astrox-88d-pro', category: 'racket', label: 'Astrox 88D Pro' },
        { id: 'g2', catalogId: 'racket-yonex-nanoflare-800', category: 'racket', label: 'Nanoflare 800' },
      ],
      activeItemId: 'g1',
      onActivate,
      onRemove,
      ownedCatalogIds: ['racket-yonex-astrox-88d-pro', 'racket-yonex-nanoflare-800'],
    });
    expect(await screen.findByText('Using today')).toBeTruthy();

    fireEvent.click(screen.getByLabelText('Use this one — Nanoflare 800'));
    expect(onActivate).toHaveBeenCalledWith('g2');

    fireEvent.click(screen.getByLabelText('Remove — Astrox 88D Pro'));
    expect(onRemove).toHaveBeenCalledWith('g1');
  });

  // Strings have no "active" pointer — BagList itself gates the affordance on
  // item.category, so an owned string never grows a nonsense "Use this one".
  it('shows an owned string with no activate control, remove only', async () => {
    mockCatalogAndLevel(STRING_CATALOG, null);
    renderSheet({
      category: 'string',
      ownedItems: [{ id: 's1', catalogId: 'string-yonex-bg65', category: 'string', label: 'Yonex BG65' }],
      onRemove: vi.fn(),
    });
    expect(await screen.findByText('Yonex BG65')).toBeTruthy();
    expect(screen.queryByLabelText(/Use this one/)).toBeNull();
    expect(screen.getByLabelText('Remove — Yonex BG65')).toBeTruthy();
  });
});

describe('GearSheet — string tension capture', () => {
  it('shows no tension field for the racket category', async () => {
    mockCatalog();
    renderSheet();
    await screen.findByText('Astrox 88D Pro');
    expect(screen.queryByLabelText('Tension you strung at')).toBeNull();
  });

  /**
   * This test used to assert `input.value === '24'` — it PINNED the bug.
   *
   * Rendering the advice as the field's VALUE made the field unusable. There
   * is no select-on-focus, so tapping it put a caret beside the
   * recommendation and the first keystroke appended: a member on 26 lb tapped
   * a field reading "24", typed 26, got "2426", and `clampTension` folded
   * that to MAX_LB and stored 30. Silently, and plausibly. Reproduced in a
   * browser: every tension anyone entered was saved as 30.
   *
   * The advice belongs in the placeholder, which costs nothing because the
   * prefill was never sent anyway (see the untouched-field test below). It
   * looked like a value while functioning as a hint.
   */
  it('offers the recommended tension as a placeholder, never as the value', async () => {
    mockCatalogAndLevel(STRING_CATALOG, 3);
    renderSheet({ category: 'string', activeName: 'Lin', format: 'doubles' });
    const input = await screen.findByLabelText('Tension you strung at') as HTMLInputElement;
    // recommendTension(3, 'doubles') = round(21 + 3) = 24.
    await waitFor(() => expect(input.placeholder).toBe('24'));
    // The value must stay empty, or the next keystroke appends to it.
    expect(input.value).toBe('');
  });

  it('stores the number the member typed, not the advice plus the number', async () => {
    mockCatalogAndLevel(STRING_CATALOG, 3);
    const { onPick } = renderSheet({ category: 'string', activeName: 'Lin', format: 'doubles' });
    const input = await screen.findByLabelText('Tension you strung at') as HTMLInputElement;
    await waitFor(() => expect(input.placeholder).toBe('24'));

    fireEvent.change(input, { target: { value: '26' } });
    fireEvent.click(await screen.findByText('BG65'));

    await waitFor(() => expect(onPick).toHaveBeenCalled());
    expect(onPick.mock.calls[0][1]).toBe(26);
  });

  it('shows the clamped value back on blur, so a typo is not stored invisibly', async () => {
    mockCatalogAndLevel(STRING_CATALOG, 3);
    renderSheet({ category: 'string', activeName: 'Lin', format: 'doubles' });
    const input = await screen.findByLabelText('Tension you strung at') as HTMLInputElement;
    await waitFor(() => expect(input.placeholder).toBe('24'));

    // MAX_LB is 30. Clamping is deliberate — doing it invisibly at save time
    // is not: it turns a typo into a plausible tension the member never gave.
    fireEvent.change(input, { target: { value: '45' } });
    fireEvent.blur(input);
    await waitFor(() => expect(input.value).toBe('30'));
  });

  it('opens with an empty tension field when there is no level to advise from', async () => {
    mockCatalogAndLevel(STRING_CATALOG, null);
    renderSheet({ category: 'string', activeName: 'Lin', format: 'doubles' });
    const input = await screen.findByLabelText('Tension you strung at') as HTMLInputElement;
    expect(input.value).toBe('');
  });

  // The advice is a prefill, not a fact — an untouched field must not be
  // silently persisted as if the member reported it.
  it('sends no tensionLbs when the member never touches the prefilled field', async () => {
    mockCatalogAndLevel(STRING_CATALOG, 3);
    const { onPick } = renderSheet({ category: 'string', activeName: 'Lin', format: 'doubles' });
    await screen.findByLabelText('Tension you strung at');
    fireEvent.click(await screen.findByText('BG65'));

    await waitFor(() => expect(onPick).toHaveBeenCalledTimes(1));
    expect(onPick.mock.calls[0][1]).toBeUndefined();
  });

  it('sends the edited tensionLbs, clamped to [20, 30], on pick', async () => {
    mockCatalogAndLevel(STRING_CATALOG, 3);
    const { onPick } = renderSheet({ category: 'string', activeName: 'Lin', format: 'doubles' });
    const input = await screen.findByLabelText('Tension you strung at');
    fireEvent.change(input, { target: { value: '35' } });
    fireEvent.click(await screen.findByText('BG65'));

    await waitFor(() => expect(onPick).toHaveBeenCalledTimes(1));
    expect(onPick.mock.calls[0][1]).toBe(30);
  });

  // `Number('')` is 0 — finite — so a naive clamp reads a cleared field as
  // "20 lb", a number the member never typed, the moment after they
  // deliberately deleted it. Touching-then-clearing must still mean "nothing
  // entered", the same as never touching it at all.
  it('sends no tensionLbs when the member touches the field and then clears it', async () => {
    mockCatalogAndLevel(STRING_CATALOG, 3);
    const { onPick } = renderSheet({ category: 'string', activeName: 'Lin', format: 'doubles' });
    const input = await screen.findByLabelText('Tension you strung at');
    fireEvent.change(input, { target: { value: '26' } });
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.click(await screen.findByText('BG65'));

    await waitFor(() => expect(onPick).toHaveBeenCalledTimes(1));
    expect(onPick.mock.calls[0][1]).toBeUndefined();
  });
});

describe('GearSheet — the tension follow-up failure path (real useGear)', () => {
  /**
   * Review fix, round 1: `GearSheet.pick()` only ever sees whatever `onPick`
   * resolves to — it has no visibility into `useGear.add()`'s internal
   * POST-then-PUT sequence. Every other test in this file mocks `onPick`
   * away, which is exactly why the original defect (the PUT was
   * `void mutate(...)`, fire-and-forget) shipped invisibly past all of them.
   * This mounts the REAL `useGear` hook, wired the same way `YourKitCard`
   * wires it, so a regression back to fire-and-forget shows up here.
   */
  function Harness({ onClose }: { onClose: () => void }) {
    const gear = useGear('Lin');
    const items = gear.gear?.items ?? [];
    const ownedStrings = items.filter((i) => i.category === 'string');
    return (
      <GearSheet
        open
        onClose={onClose}
        category="string"
        activeName="Lin"
        format="doubles"
        ownedCatalogIds={ownedStrings.map((i) => i.catalogId).filter((id): id is string => typeof id === 'string')}
        ownedItems={ownedStrings}
        onPick={(item, tensionLbs) => gear.add(item, typeof tensionLbs === 'number' ? { tensionLbs } : undefined)}
        busy={gear.busy}
        online={gear.online}
      />
    );
  }

  function renderHarness() {
    const onClose = vi.fn();
    const utils = render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <Harness onClose={onClose} />
      </NextIntlClientProvider>,
    );
    return { ...utils, onClose };
  }

  it('keeps the sheet open with an error — item already visible as the retry anchor — when the tension PUT fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? 'GET').toUpperCase();
      if (url.includes('/api/equipment/catalog')) {
        return new Response(JSON.stringify({ items: STRING_CATALOG }), { status: 200 });
      }
      if (url.includes('/api/stats/level')) {
        return new Response(JSON.stringify({ level: { level: 3 } }), { status: 200 });
      }
      if (url.includes('/api/equipment/gear')) {
        if (method === 'GET') return new Response(JSON.stringify({ gear: null }), { status: 200 });
        if (method === 'POST') {
          const added = { id: 's1', catalogId: 'string-yonex-bg65', category: 'string', label: 'Yonex BG65' };
          return new Response(JSON.stringify({ gear: { id: 'gear-1', memberId: 'm1', items: [added] } }), { status: 200 });
        }
        if (method === 'PUT') return new Response(JSON.stringify({ error: 'save_failed' }), { status: 500 });
      }
      return new Response('{}', { status: 404 });
    }) as unknown as typeof fetch);

    const { onClose } = renderHarness();
    const input = await screen.findByLabelText('Tension you strung at');
    // A distinct value from the "24" prefill — RTL's fireEvent.change on an
    // unchanged value can fail to register with React's controlled input.
    fireEvent.change(input, { target: { value: '26' } });
    fireEvent.click(await screen.findByText('BG65'));

    // The failed PUT must surface an error and keep the sheet open — not
    // close on the POST alone and lose the tension silently.
    await screen.findByRole('alert');
    expect(onClose).not.toHaveBeenCalled();

    // The item is already saved (POST succeeded, applied via the real
    // useGear state) and visible in the owned list as the retry anchor — no
    // new UI needed for "try the tension again".
    expect(screen.getAllByText('Yonex BG65').length).toBeGreaterThan(0);
  });

  it('closes normally when the tension PUT succeeds', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? 'GET').toUpperCase();
      if (url.includes('/api/equipment/catalog')) {
        return new Response(JSON.stringify({ items: STRING_CATALOG }), { status: 200 });
      }
      if (url.includes('/api/stats/level')) {
        return new Response(JSON.stringify({ level: { level: 3 } }), { status: 200 });
      }
      if (url.includes('/api/equipment/gear')) {
        if (method === 'GET') return new Response(JSON.stringify({ gear: null }), { status: 200 });
        if (method === 'POST') {
          const added = { id: 's1', catalogId: 'string-yonex-bg65', category: 'string', label: 'Yonex BG65' };
          return new Response(JSON.stringify({ gear: { id: 'gear-1', memberId: 'm1', items: [added] } }), { status: 200 });
        }
        if (method === 'PUT') {
          const withTension = { id: 's1', catalogId: 'string-yonex-bg65', category: 'string', label: 'Yonex BG65', tensionLbs: 24 };
          return new Response(JSON.stringify({ gear: { id: 'gear-1', memberId: 'm1', items: [withTension] } }), { status: 200 });
        }
      }
      return new Response('{}', { status: 404 });
    }) as unknown as typeof fetch);

    const { onClose } = renderHarness();
    const input = await screen.findByLabelText('Tension you strung at');
    // A distinct value from the "24" prefill — RTL's fireEvent.change on an
    // unchanged value can fail to register with React's controlled input.
    fireEvent.change(input, { target: { value: '26' } });
    fireEvent.click(await screen.findByText('BG65'));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});

/**
 * The bag rows must report their own refusals.
 *
 * `YourKitCard` wired these as `{ void activate(id) }` / `{ void remove(id) }`,
 * discarding the `GearResult`. So a refused activate or remove — a lapsed
 * `member_session` being the realistic cause, since that cookie expires at 30
 * days while `badminton_identity` never does — rendered NOTHING: no pill, no
 * change, no explanation. Tapping "Use this one" or the ✕ was indistinguishable
 * from a dead button, and it stayed that way across a reload. These two
 * controls live inside the sheet the member is looking at, which makes it the
 * worst possible place to swallow an error.
 */
describe('GearSheet — a refused bag operation says so', () => {
  const OWNED = [
    { id: 'own-1', catalogId: 'racket-yonex-astrox-88d-pro', category: 'racket' as const, label: 'Yonex Astrox 88D Pro' },
    { id: 'own-2', catalogId: 'racket-yonex-nanoflare-800', category: 'racket' as const, label: 'Yonex Nanoflare 800' },
  ];

  it('shows the sign-in-again message when activate is refused', async () => {
    const onActivate = vi.fn(async () => ({ ok: false as const, reason: 'unauthorized' as const }));
    renderSheet({ ownedItems: OWNED, activeItemId: 'own-1', onActivate });

    // 'own-1' is active and renders a badge, so the button belongs to 'own-2'.
    fireEvent.click(screen.getByLabelText(/Use this one — Yonex Nanoflare 800/i));

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe(enMessages.valueHub.bagSignInAgain);
    });
    expect(onActivate).toHaveBeenCalledWith('own-2');
  });

  it('shows a message when remove is refused, rather than nothing at all', async () => {
    const onRemove = vi.fn(async () => ({ ok: false as const, reason: 'member_not_found' as const }));
    renderSheet({ ownedItems: OWNED, activeItemId: 'own-1', onRemove });

    fireEvent.click(screen.getByLabelText(/Remove — Yonex Astrox 88D Pro/i));

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe(enMessages.valueHub.bagMemberMissing);
    });
  });

  it('stays silent when the operation succeeds', async () => {
    const onRemove = vi.fn(async () => ({ ok: true as const }));
    renderSheet({ ownedItems: OWNED, activeItemId: 'own-1', onRemove });

    fireEvent.click(screen.getByLabelText(/Remove — Yonex Astrox 88D Pro/i));

    await waitFor(() => expect(onRemove).toHaveBeenCalled());
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

/**
 * The tension field has to be able to describe a string you already own.
 *
 * It could only ever describe a string you did NOT own: owned catalogIds are
 * filtered out of the list below, and the bag rows were read-only. So a
 * member whose goal was "record the tension on my current strings" had no
 * route to it at all — the field worked once, at add time, and never again.
 */
describe('GearSheet — setting tension on a string already in the bag', () => {
  const OWNED_STRING = {
    id: 's1', catalogId: 'string-yonex-bg65', category: 'string' as const, label: 'Yonex BG65',
  };

  it('offers the control only once a usable number is in the field', async () => {
    mockCatalogAndLevel(STRING_CATALOG, 3);
    // Params declared so `mock.calls[0][n]` is indexable — a bare
    // `vi.fn(async () => ...)` types its calls as `[]` and tsc rejects the
    // assertions below even though vitest runs them happily.
    const onSetTension = vi.fn(
      async (_item: GearItem, _tensionLbs: number) => ({ ok: true as const }),
    );
    renderSheet({
      category: 'string', activeName: 'Lin', format: 'doubles',
      ownedItems: [OWNED_STRING], ownedCatalogIds: [OWNED_STRING.catalogId], onSetTension,
    });

    const button = await screen.findByLabelText('Set tension — Yonex BG65') as HTMLButtonElement;
    // The advice is a placeholder, so the field starts genuinely empty and
    // there is nothing to apply yet.
    expect(button.disabled).toBe(true);

    const input = screen.getByLabelText('Tension you strung at') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '27' } });
    await waitFor(() => expect(button.disabled).toBe(false));

    fireEvent.click(button);
    await waitFor(() => expect(onSetTension).toHaveBeenCalled());
    expect(onSetTension.mock.calls[0][0]).toMatchObject({ id: 's1' });
    expect(onSetTension.mock.calls[0][1]).toBe(27);
  });

  it('reports a refusal through the sheet error slot like every other write', async () => {
    mockCatalogAndLevel(STRING_CATALOG, 3);
    const onSetTension = vi.fn(async () => ({ ok: false as const, reason: 'unauthorized' as const }));
    renderSheet({
      category: 'string', activeName: 'Lin', format: 'doubles',
      ownedItems: [OWNED_STRING], ownedCatalogIds: [OWNED_STRING.catalogId], onSetTension,
    });

    const input = await screen.findByLabelText('Tension you strung at') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '27' } });
    fireEvent.click(await screen.findByLabelText('Set tension — Yonex BG65'));

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe(enMessages.valueHub.bagSignInAgain));
  });

  it('offers no tension control on racket rows', async () => {
    mockCatalog();
    renderSheet({
      ownedItems: [{ id: 'r1', catalogId: 'c1', category: 'racket', label: 'Astrox 88D Pro' }],
      onSetTension: vi.fn(async () => ({ ok: true as const })),
    });
    await screen.findByText('Nanoflare 800');
    expect(screen.queryByLabelText(/^Set tension/)).toBeNull();
  });
});
