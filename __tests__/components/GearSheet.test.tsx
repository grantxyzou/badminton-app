// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import GearSheet from '../../components/stats/GearSheet';
import enMessages from '../../messages/en.json';

/**
 * GearSheet is now a catalog picker and nothing else — the bag moved to the
 * Equipment tab. The behaviours worth pinning here are the ones that changed
 * with that split: one tap commits and closes (no Save button), rackets
 * already owned never appear, and every row shows its brand.
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

function mockCatalog(items: unknown = CATALOG, status = 200) {
  global.fetch = vi.fn(async (url: RequestInfo | URL) => {
    if (String(url).includes('/api/equipment/catalog')) {
      return new Response(JSON.stringify({ items }), { status });
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

  it('shows only the active brand’s models, with the spec line as the recognition cue', async () => {
    mockCatalog();
    renderSheet();
    expect(await screen.findByText('Astrox 88D Pro')).toBeTruthy();
    expect(screen.getByText('4U · head-heavy · stiff')).toBeTruthy();
    expect(screen.queryByText('DriveX 9X')).toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: 'Victor' }));
    expect(screen.getByText('DriveX 9X')).toBeTruthy();
    expect(screen.queryByText('Astrox 88D Pro')).toBeNull();
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

  // Regression guard for the old two-surface design: the sheet must never
  // render bag controls again.
  it('renders no bag controls — those live on the Equipment tab now', async () => {
    mockCatalog();
    renderSheet();
    await screen.findByText('Astrox 88D Pro');
    expect(screen.queryByText('Your rackets')).toBeNull();
    expect(screen.queryByText('Use this one')).toBeNull();
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
    expect(screen.getByRole('tab', { name: 'Victor' }).getAttribute('aria-selected')).toBe('true');
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
    fireEvent.change(input, { target: { value: '' } });
    expect(screen.getByText('Astrox 88D Pro')).toBeTruthy();
    expect(screen.queryByText('DriveX 9X')).toBeNull();
  });
});
