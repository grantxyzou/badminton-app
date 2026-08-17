// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import GearSheet from '../../components/stats/GearSheet';
import enMessages from '../../messages/en.json';

/**
 * The recognition-over-recall redesign. The two behaviours worth pinning:
 * tapping a model SELECTS (v1 saved instantly — browsing felt dangerous), and
 * only the explicit Save button writes.
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

function mockFetch() {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  global.fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    if (String(url).includes('/api/equipment/catalog')) {
      return new Response(JSON.stringify({ items: CATALOG }), { status: 200 });
    }
    if (String(url).includes('/api/equipment/gear')) {
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    return new Response('{}', { status: 404 });
  }) as unknown as typeof fetch;
  return calls;
}

function renderSheet(props: Partial<React.ComponentProps<typeof GearSheet>> = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <GearSheet name="Lin" open onClose={() => {}} onSaved={() => {}} {...props} />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  vi.useRealTimers();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('GearSheet (recognition over recall)', () => {
  it('renders a brand tab per catalog brand and no search box', async () => {
    mockFetch();
    renderSheet();
    expect(await screen.findByRole('tab', { name: 'Yonex' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Victor' })).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('shows only the active brand’s models, with the spec line as the recognition cue', async () => {
    mockFetch();
    renderSheet();
    expect(await screen.findByText('Astrox 88D Pro')).toBeTruthy();
    expect(screen.getByText('4U · head-heavy · stiff')).toBeTruthy();
    expect(screen.queryByText('DriveX 9X')).toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: 'Victor' }));
    expect(screen.getByText('DriveX 9X')).toBeTruthy();
    expect(screen.queryByText('Astrox 88D Pro')).toBeNull();
  });

  it('tapping a model selects it — it must NOT save', async () => {
    const calls = mockFetch();
    renderSheet();
    fireEvent.click(await screen.findByText('Astrox 88D Pro'));

    // The catalog GET and the alongside gear-doc GET (for the bag) have
    // fired, but selecting a model must not write — no gear call of any
    // kind (POST/PATCH/DELETE), only the read. fetch's implicit method
    // (no `init.method`) is GET, so that's excluded by the fallback below.
    expect(calls.filter((c) => c.url.includes('/gear') && (c.init?.method ?? 'GET') !== 'GET')).toHaveLength(0);
    // Save button arms and names the selection.
    expect(screen.getByRole('button', { name: 'Save — Astrox 88D Pro' })).toBeTruthy();
  });

  it('Save is disabled until something is selected', async () => {
    mockFetch();
    renderSheet();
    await screen.findByText('Astrox 88D Pro');
    const save = screen.getByRole('button', { name: 'Save' });
    expect((save as HTMLButtonElement).disabled).toBe(true);
  });

  it('Save POSTs the selected catalogId and shows the saved state', async () => {
    const calls = mockFetch();
    renderSheet();
    fireEvent.click(await screen.findByText('Nanoflare 800'));
    fireEvent.click(screen.getByRole('button', { name: 'Save — Nanoflare 800' }));

    await waitFor(() => expect(screen.getByText(/Saved!/)).toBeTruthy());
    const post = calls.find((c) => c.url.includes('/gear') && c.init?.method === 'POST');
    expect(post).toBeTruthy();
    const body = JSON.parse(String(post!.init!.body));
    expect(body.item.catalogId).toBe('racket-yonex-nanoflare-800');
    expect(body.item.label).toBe('Yonex Nanoflare 800');
    expect(body.name).toBe('Lin');
  });

  it('pre-selects the current racket and lands on its brand tab', async () => {
    mockFetch();
    renderSheet({ currentLabel: 'Victor DriveX 9X' });
    // Victor tab is active and the row is marked selected.
    expect(await screen.findByText('DriveX 9X')).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Victor' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('button', { name: /DriveX 9X — selected/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save — DriveX 9X' })).toBeTruthy();
  });

  it('tapping the selected model again deselects it', async () => {
    mockFetch();
    renderSheet();
    const row = await screen.findByText('Astrox 88D Pro');
    fireEvent.click(row);
    fireEvent.click(screen.getByRole('button', { name: /Astrox 88D Pro — selected/ }));
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('says so when the catalog is empty, instead of rendering a blank sheet', async () => {
    // Regression: the production container held zero rackets, and the sheet
    // drew a title, a hint and a dead Save button — loaded-empty was
    // indistinguishable from broken.
    global.fetch = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url).includes('/api/equipment/catalog')) {
        return new Response(JSON.stringify({ items: [] }), { status: 200 });
      }
      // Isolate the catalog-empty scenario: the gear-doc GET succeeds with
      // no bag, so this test exercises exactly one failure mode.
      if (String(url).includes('/api/equipment/gear')) {
        return new Response(JSON.stringify({ gear: null }), { status: 200 });
      }
      return new Response('{}', { status: 404 });
    }) as unknown as typeof fetch;

    renderSheet();
    expect(await screen.findByText(/No rackets in the catalog yet/)).toBeTruthy();
    // No brand tabs, and Save stays inert.
    expect(screen.queryByRole('tab')).toBeNull();
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows the error pill, not a fake empty catalog, when the load fails', async () => {
    global.fetch = vi.fn(async () => new Response('{}', { status: 500 })) as unknown as typeof fetch;
    renderSheet();
    // Both the catalog GET and the gear-doc GET fail against this blanket
    // 500 mock, so each surfaces its own alert pill.
    const alerts = await screen.findAllByRole('alert');
    expect(alerts.length).toBeGreaterThan(0);
  });

  // Finding 1 (fix round 1): a failed gear read must not render as a
  // truthful "you have no rackets" — it must show its own error pill, even
  // when the catalog load succeeds fine on its own.
  it('shows an error pill instead of a lying empty bag when the gear GET fails', async () => {
    global.fetch = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url).includes('/api/equipment/catalog')) {
        return new Response(JSON.stringify({ items: CATALOG }), { status: 200 });
      }
      if (String(url).includes('/api/equipment/gear')) {
        return new Response('{}', { status: 500 });
      }
      return new Response('{}', { status: 404 });
    }) as unknown as typeof fetch;

    renderSheet();
    // Catalog loaded fine — this isn't a catalog failure.
    expect(await screen.findByText('Astrox 88D Pro')).toBeTruthy();
    expect(await screen.findByRole('alert')).toBeTruthy();
  });
});

describe('GearSheet bag wiring (fix round 1)', () => {
  const BAG_GEAR = {
    id: 'gear-m1',
    memberId: 'm1',
    items: [
      { id: 'a', catalogId: 'racket-yonex-astrox-88d-pro', category: 'racket', label: 'Yonex Astrox 88D Pro' },
      { id: 'b', catalogId: 'racket-victor-drivex-9x', category: 'racket', label: 'Victor DriveX 9X' },
    ],
    activeRacketId: 'a',
  };

  function mockFetchAdvanced(opts: {
    gear?: unknown;
    post?: { status: number; body: unknown };
    patch?: { status: number; body: unknown };
    del?: { status: number; body: unknown };
  } = {}) {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    global.fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      const u = String(url);
      const method = (init?.method ?? 'GET').toUpperCase();
      if (u.includes('/api/equipment/catalog')) {
        return new Response(JSON.stringify({ items: CATALOG }), { status: 200 });
      }
      if (u.includes('/api/equipment/gear')) {
        if (method === 'GET') {
          return new Response(JSON.stringify({ gear: opts.gear ?? null }), { status: 200 });
        }
        if (method === 'POST') {
          const r = opts.post ?? { status: 200, body: { gear: opts.gear ?? null } };
          return new Response(JSON.stringify(r.body), { status: r.status });
        }
        if (method === 'PATCH') {
          const r = opts.patch ?? { status: 200, body: { gear: opts.gear ?? null } };
          return new Response(JSON.stringify(r.body), { status: r.status });
        }
        if (method === 'DELETE') {
          const r = opts.del ?? { status: 200, body: { gear: opts.gear ?? null } };
          return new Response(JSON.stringify(r.body), { status: r.status });
        }
      }
      return new Response('{}', { status: 404 });
    }) as unknown as typeof fetch;
    return calls;
  }

  it('shows the bagFull message on a 409 bag_full refusal, and the sheet stays open', async () => {
    mockFetchAdvanced({ post: { status: 409, body: { error: 'bag_full' } } });
    const onClose = vi.fn();
    renderSheet({ onClose });
    fireEvent.click(await screen.findByText('Astrox 88D Pro'));
    fireEvent.click(screen.getByRole('button', { name: 'Save — Astrox 88D Pro' }));

    expect(await screen.findByText("That's all the rackets we can hold — remove one first.")).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByText(/Saved!/)).toBeNull();
  });

  it('shows the bagDuplicate message on a 409 duplicate_racket refusal, and the sheet stays open', async () => {
    mockFetchAdvanced({ post: { status: 409, body: { error: 'duplicate_racket' } } });
    const onClose = vi.fn();
    renderSheet({ onClose });
    fireEvent.click(await screen.findByText('Astrox 88D Pro'));
    fireEvent.click(screen.getByRole('button', { name: 'Save — Astrox 88D Pro' }));

    expect(await screen.findByText('That racket is already in your bag.')).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByText(/Saved!/)).toBeNull();
  });

  it('falls back to the generic save error on a 500, not a 409 refusal message', async () => {
    mockFetchAdvanced({ post: { status: 500, body: {} } });
    renderSheet();
    fireEvent.click(await screen.findByText('Astrox 88D Pro'));
    fireEvent.click(screen.getByRole('button', { name: 'Save — Astrox 88D Pro' }));

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.queryByText("That's all the rackets we can hold — remove one first.")).toBeNull();
    expect(screen.queryByText('That racket is already in your bag.')).toBeNull();
  });

  // An unrecognized 409 code (neither bag_full nor duplicate_racket) must
  // also fall back to the generic error, not assert a specific reason the
  // server never gave (Finding 5).
  it('falls back to the generic save error on an unrecognized 409 code', async () => {
    mockFetchAdvanced({ post: { status: 409, body: { error: 'something_new' } } });
    renderSheet();
    fireEvent.click(await screen.findByText('Astrox 88D Pro'));
    fireEvent.click(screen.getByRole('button', { name: 'Save — Astrox 88D Pro' }));

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.queryByText("That's all the rackets we can hold — remove one first.")).toBeNull();
    expect(screen.queryByText('That racket is already in your bag.')).toBeNull();
  });

  it('activate fires a PATCH with the tapped racket id', async () => {
    const calls = mockFetchAdvanced({
      gear: BAG_GEAR,
      patch: { status: 200, body: { gear: { ...BAG_GEAR, activeRacketId: 'b' } } },
    });
    renderSheet();
    fireEvent.click(await screen.findByLabelText('Use this one — Victor DriveX 9X'));

    await waitFor(() => {
      const patchCall = calls.find((c) => c.url.includes('/gear') && c.init?.method === 'PATCH');
      expect(patchCall).toBeTruthy();
      expect(JSON.parse(String(patchCall!.init!.body))).toEqual({ name: 'Lin', activeRacketId: 'b' });
    });
  });

  it('remove fires a DELETE with the tapped racket id', async () => {
    const calls = mockFetchAdvanced({
      gear: BAG_GEAR,
      del: { status: 200, body: { gear: { ...BAG_GEAR, items: [BAG_GEAR.items[0]] } } },
    });
    renderSheet();
    fireEvent.click(await screen.findByLabelText('Remove — Victor DriveX 9X'));

    await waitFor(() => {
      const delCall = calls.find((c) => c.url.includes('/gear') && c.init?.method === 'DELETE');
      expect(delCall).toBeTruthy();
      expect(delCall!.url).toContain('name=Lin');
      expect(delCall!.url).toContain('itemId=b');
    });
  });

  it('clears saving after a failed mutation so the UI is not left permanently disabled', async () => {
    mockFetchAdvanced({ gear: BAG_GEAR, patch: { status: 500, body: {} } });
    renderSheet();
    const useBtn = await screen.findByLabelText('Use this one — Victor DriveX 9X');
    fireEvent.click(useBtn);

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    // The failed PATCH must release the shared busy state — every bag
    // button (and Save) re-enables rather than staying disabled forever.
    expect((useBtn as HTMLButtonElement).disabled).toBe(false);
  });
});

describe('GearSheet search', () => {
  it('matches on model across every brand, ignoring the selected tab', async () => {
    mockFetch();
    renderSheet();
    await waitFor(() => screen.getByText('Astrox 88D Pro'));
    fireEvent.change(screen.getByPlaceholderText('Search rackets'), { target: { value: 'drivex' } });
    // DriveX is a Victor racket; the sheet opens on Yonex.
    expect(screen.getByText('DriveX 9X')).toBeTruthy();
    expect(screen.queryByText('Astrox 88D Pro')).toBeNull();
  });

  it('matches case-insensitively on brand', async () => {
    mockFetch();
    renderSheet();
    await waitFor(() => screen.getByText('Astrox 88D Pro'));
    fireEvent.change(screen.getByPlaceholderText('Search rackets'), { target: { value: 'VICTOR' } });
    expect(screen.getByText('DriveX 9X')).toBeTruthy();
  });

  // A search miss is not a broken screen.
  it('shows an empty state, not an error, when nothing matches', async () => {
    mockFetch();
    renderSheet();
    await waitFor(() => screen.getByText('Astrox 88D Pro'));
    fireEvent.change(screen.getByPlaceholderText('Search rackets'), { target: { value: 'zzzz' } });
    expect(screen.getByText('No rackets match that.')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('restores brand browsing when the query is cleared', async () => {
    mockFetch();
    renderSheet();
    await waitFor(() => screen.getByText('Astrox 88D Pro'));
    const input = screen.getByPlaceholderText('Search rackets');
    fireEvent.change(input, { target: { value: 'drivex' } });
    fireEvent.change(input, { target: { value: '' } });
    expect(screen.getByText('Astrox 88D Pro')).toBeTruthy();
    expect(screen.queryByText('DriveX 9X')).toBeNull();
  });
});
