// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import GearSheet from '../../components/stats/GearSheet';
import enMessages from '../../messages/en.json';
import type { GearItem } from '../../lib/types';

/**
 * GearSheet BROWSES a category's catalog and nothing else.
 *
 * It used to also be the bag-management surface — remove, use-this-one, set
 * tension — stacked above the catalog somebody had opened in order to add
 * something. That half moved to `YourKitCard`, and its tests moved with it
 * (see `YourKitCard.test.tsx`). What is pinned here is the browse job: one tap
 * commits and the sheet STAYS OPEN so the row can show its checked state,
 * owned rows appear IN PLACE rather than being hidden or lifted into a
 * separate section, brand is a group heading with a count rather than the
 * first line of every row, and search leads.
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

/** Answers with a different catalog per category, so a category switch can be
 *  used to change which brands exist without touching ownership. */
function mockCatalogByCategory(byCategory: Record<string, unknown>) {
  global.fetch = vi.fn(async (url: RequestInfo | URL) => {
    const u = String(url);
    if (u.includes('/api/equipment/catalog')) {
      const cat = new URL(u, 'http://x').searchParams.get('category') ?? 'racket';
      return new Response(JSON.stringify({ items: byCategory[cat] ?? [] }), { status: 200 });
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
    expect(screen.getByPlaceholderText('Search 3 rackets')).toBeTruthy();
  });

  /**
   * The placeholder carries the catalog count, which is what let the
   * instruction line above it go — and it answers a question the sheet never
   * did: how many are there. It is also per-category; the string sheet used
   * the racket copy, so "Search rackets" appeared over a list of strings.
   */
  it('counts the catalog in the search placeholder, per category', async () => {
    mockCatalog();
    const { unmount } = renderSheet();
    expect(await screen.findByPlaceholderText('Search 3 rackets')).toBeTruthy();
    unmount();
    cleanup();

    mockCatalog(STRING_CATALOG);
    renderSheet({ category: 'string', title: 'Add a string' });
    expect(await screen.findByPlaceholderText('Search 1 strings')).toBeTruthy();
    expect(screen.queryByPlaceholderText(/rackets/)).toBeNull();
  });

  /** The instruction line explained the control it sat above. */
  it('does not explain how to search', async () => {
    mockCatalog();
    renderSheet();
    await screen.findByText('Astrox 88D Pro');
    expect(screen.queryByText(/Search, or browse by brand/)).toBeNull();
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

  /**
   * The brand was the first line of every row — printed five times running,
   * directly under a filter chip already naming that brand. As a heading it is
   * said once and carries the count.
   */
  it('groups rows under a brand heading that carries its own count', async () => {
    mockCatalog();
    renderSheet();
    expect(await screen.findByText('Yonex · 2')).toBeTruthy();
    expect(screen.getByText('Victor · 1')).toBeTruthy();
  });

  /**
   * Picking is one tap, not tap-then-Save — and the tap does NOT dismiss.
   *
   * The sheet used to close the instant a pick succeeded. That was defensible
   * while owned rows were hidden from the catalog: there was nothing left to
   * see. Now the tapped row turns into a checked, tinted, inert owned row,
   * and that is the only confirmation the action has — closing on success
   * rendered it for one frame to nobody.
   */
  it('commits on one tap and stays open — no Save button, no dismiss', async () => {
    mockCatalog();
    const { onPick, onClose } = renderSheet();
    fireEvent.click(await screen.findByText('Nanoflare 800'));

    await waitFor(() => expect(onPick).toHaveBeenCalledTimes(1));
    expect(onPick.mock.calls[0][0].id).toBe('racket-yonex-nanoflare-800');
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /^Save/ })).toBeNull();
  });

  /**
   * Owned rows used to be REMOVED from the catalog and re-rendered in a
   * separate "Already in your kit" section pinned above it. They stay in
   * place now, checked and captioned — the question a browse list is asked is
   * "do I already have this?", and the list itself should answer it.
   */
  it('keeps a racket you own in the list, marked, rather than hiding it', async () => {
    mockCatalog();
    renderSheet({ ownedCatalogIds: ['racket-yonex-astrox-88d-pro'] });
    expect(await screen.findByText('Astrox 88D Pro')).toBeTruthy();
    expect(screen.getByText('In your kit')).toBeTruthy();
    // Still counted in its brand group — the count describes the catalog, not
    // what is left to buy.
    expect(screen.getByText('Yonex · 2')).toBeTruthy();
  });

  it('does not offer an owned row as something to add', async () => {
    mockCatalog();
    const { onPick } = renderSheet({ ownedCatalogIds: ['racket-yonex-astrox-88d-pro'] });
    fireEvent.click(await screen.findByText('Astrox 88D Pro'));
    expect(onPick).not.toHaveBeenCalled();
    // Not a button at all: there is nothing to do to a row you already own.
    expect(screen.queryByRole('button', { name: 'Yonex Astrox 88D Pro' })).toBeNull();
  });

  it('says which owned racket is the one in play today', async () => {
    mockCatalog();
    const owned: GearItem[] = [
      { id: 'g1', catalogId: 'racket-yonex-astrox-88d-pro', category: 'racket', label: 'Yonex Astrox 88D Pro' },
    ];
    renderSheet({ ownedCatalogIds: [owned[0].catalogId!], ownedItems: owned, activeItemId: 'g1' });
    expect(await screen.findByText('In your kit · using today')).toBeTruthy();
  });

  it('says what tension an owned string is strung at', async () => {
    mockCatalog(STRING_CATALOG);
    const owned: GearItem[] = [
      { id: 'g9', catalogId: 'string-yonex-bg65', category: 'string', label: 'Yonex BG65', tensionLbs: 24 },
    ];
    renderSheet({ category: 'string', ownedCatalogIds: ['string-yonex-bg65'], ownedItems: owned });
    expect(await screen.findByText('In your kit · strung at 24 lb')).toBeTruthy();
  });

  /** Brand tabs describe the CATALOG, so owning everything of a brand no
   *  longer empties its tab — the rows are still there, checked. */
  it('keeps a brand tab whose every racket is already owned', async () => {
    mockCatalog();
    renderSheet({
      ownedCatalogIds: ['racket-yonex-astrox-88d-pro', 'racket-yonex-nanoflare-800'],
    });
    expect(await screen.findByRole('tab', { name: 'Yonex' })).toBeTruthy();
    expect(screen.getByText('Yonex · 2')).toBeTruthy();
  });

  /** The stale-brand guard still matters: switching category refetches, and a
   *  tab from the previous category would otherwise survive into a list that
   *  has no such brand. */
  it('moves off a brand tab that the next category does not have', async () => {
    mockCatalogByCategory({ racket: CATALOG, string: STRING_CATALOG });
    const sheet = (category: 'racket' | 'string') => (
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <GearSheet
          open
          onClose={vi.fn()}
          category={category}
          ownedCatalogIds={[]}
          onPick={vi.fn(async () => ({ ok: true as const }))}
          busy={false}
          online
        />
      </NextIntlClientProvider>
    );
    const { rerender } = render(sheet('racket'));
    await screen.findByText('DriveX 9X');
    fireEvent.click(screen.getByRole('tab', { name: 'Victor' }));
    expect(screen.getByRole('tab', { name: 'Victor' }).getAttribute('aria-selected')).toBe('true');

    rerender(sheet('string'));
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: 'All' }).getAttribute('aria-selected')).toBe('true'),
    );
    expect(screen.queryByRole('tab', { name: 'Victor' })).toBeNull();
  });

  it('does not fire onPick while busy', async () => {
    mockCatalog();
    const { onPick } = renderSheet({ busy: true });
    fireEvent.click(await screen.findByText('Astrox 88D Pro'));
    expect(onPick).not.toHaveBeenCalled();
  });

  /** The tension field left with the kit section — it described a string the
   *  member did not yet own, and duplicated a control one row above it. */
  it('carries no tension field, for either category', async () => {
    mockCatalog(STRING_CATALOG);
    renderSheet({ category: 'string', title: 'Add a string' });
    await screen.findByText('BG65');
    expect(screen.queryByLabelText('Tension you strung at')).toBeNull();
    expect(screen.queryByRole('spinbutton')).toBeNull();
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
  const PLACEHOLDER = 'Search 3 rackets';

  it('matches on model across every brand, ignoring the selected tab', async () => {
    mockCatalog();
    renderSheet();
    await waitFor(() => screen.getByText('Astrox 88D Pro'));
    fireEvent.change(screen.getByPlaceholderText(PLACEHOLDER), { target: { value: 'drivex' } });
    expect(screen.getByText('DriveX 9X')).toBeTruthy();
    expect(screen.queryByText('Astrox 88D Pro')).toBeNull();
  });

  /**
   * Brand still has to be legible in a cross-brand result — that was the whole
   * reason it used to ride on every row. Grouping preserves it: the heading is
   * present even while the brand tabs are hidden by an active query.
   */
  it('still names the brand in cross-brand results, via the group heading', async () => {
    mockCatalog();
    renderSheet();
    await waitFor(() => screen.getByText('Astrox 88D Pro'));
    fireEvent.change(screen.getByPlaceholderText(PLACEHOLDER), { target: { value: 'drivex' } });
    // Brand tabs are hidden while a query is active, so this can only be the
    // group heading.
    expect(screen.queryByRole('tab')).toBeNull();
    expect(screen.getByText('Victor · 1')).toBeTruthy();
  });

  it('matches case-insensitively on brand', async () => {
    mockCatalog();
    renderSheet();
    await waitFor(() => screen.getByText('Astrox 88D Pro'));
    fireEvent.change(screen.getByPlaceholderText(PLACEHOLDER), { target: { value: 'VICTOR' } });
    expect(screen.getByText('DriveX 9X')).toBeTruthy();
  });

  // A search miss is not a broken screen.
  it('shows an empty state, not an error, when nothing matches', async () => {
    mockCatalog();
    renderSheet();
    await waitFor(() => screen.getByText('Astrox 88D Pro'));
    fireEvent.change(screen.getByPlaceholderText(PLACEHOLDER), { target: { value: 'zzzz' } });
    expect(screen.getByText('No rackets match that.')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('restores brand browsing when the query is cleared', async () => {
    mockCatalog();
    renderSheet();
    await waitFor(() => screen.getByText('Astrox 88D Pro'));
    const input = screen.getByPlaceholderText(PLACEHOLDER);
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
    fireEvent.change(screen.getByPlaceholderText(PLACEHOLDER), { target: { value: 'drivx' } });
    expect(screen.getByText('DriveX 9X')).toBeTruthy();
  });

  /** A search result that includes something you own still says so. */
  it('marks an owned row inside a search result', async () => {
    mockCatalog();
    renderSheet({ ownedCatalogIds: ['racket-victor-drivex-9x'] });
    await waitFor(() => screen.getByText('Astrox 88D Pro'));
    fireEvent.change(screen.getByPlaceholderText(PLACEHOLDER), { target: { value: 'drivex' } });
    expect(screen.getByText('In your kit')).toBeTruthy();
  });
});
