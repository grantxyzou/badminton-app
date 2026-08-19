// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent, act, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import RacketRow from '../../components/stats/RacketRow';
import enMessages from '../../messages/en.json';

const ASTROX = {
  id: 'racket-yonex-astrox-100zz', category: 'racket', brand: 'Yonex', model: 'Astrox 100ZZ',
  skillRange: [4, 6],
  attributes: { playStyle: 'Power', balance: 'Head-heavy', weight: '4U', weightGrams: '83-88', flex: 'Extra Stiff' },
};
const DRIVEX = {
  id: 'racket-victor-drivex-9x', category: 'racket', brand: 'Victor', model: 'DriveX 9X',
  skillRange: [3, 5],
  attributes: { weight: '3U', balance: 'even', flex: 'stiff' },
};

function setIdentity(name: string) {
  localStorage.setItem(
    'badminton_identity',
    JSON.stringify({ name, token: 'tok', sessionId: 'session-2026-06-18' }),
  );
}

function jsonResponse(body: unknown, ok = true) {
  return Promise.resolve({ ok, status: ok ? 200 : 500, json: async () => body } as Response);
}

/** Dispatches by matching a substring of the request URL against `handlers`,
 *  in insertion order — lets each test mock the gear, catalog and recommend
 *  endpoints independently (and let one fail while the others succeed). */
function mockFetchByUrl(handlers: ReadonlyArray<readonly [string, () => Promise<Response>]>) {
  vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    const entry = handlers.find(([needle]) => url.includes(needle));
    if (!entry) return Promise.reject(new Error(`Unmocked fetch: ${url}`));
    return entry[1]();
  }) as unknown as typeof fetch);
}

// No pick yet and nothing to say about it — keeps RacketRecCard's own fetch
// from being the unmocked call that fails these tests.
const NO_REC = ['/api/recommend', () => jsonResponse({ item: null, reason: null })] as const;

function gearDoc(items: unknown[], activeRacketId?: string) {
  return { id: 'gear-1', memberId: 'm1', updatedAt: '2026-01-01', items, ...(activeRacketId ? { activeRacketId } : null) };
}

function renderRow() {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <RacketRow />
    </NextIntlClientProvider>,
  );
}

describe('RacketRow (the Equipment tab is the bag)', () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it('resolves gear and catalog together — hero shows model, brand and specs', async () => {
    setIdentity('Lin');
    mockFetchByUrl([
      ['/api/equipment/gear', () => jsonResponse({
        gear: gearDoc([{ id: 'i1', catalogId: ASTROX.id, category: 'racket', label: 'Yonex Astrox 100ZZ' }]),
      })],
      ['/api/equipment/catalog', () => jsonResponse({ items: [ASTROX] })],
      NO_REC,
    ]);

    renderRow();

    await waitFor(() => expect(screen.getByText('Astrox 100ZZ')).toBeTruthy());
    expect(screen.getByText('Power · Head-heavy')).toBeTruthy();
    expect(screen.getByText('4U (83–88g) · Extra Stiff')).toBeTruthy();
  });

  // The bag moved out of the picker sheet and onto the tab. It must be here
  // without opening anything.
  it('lists the bag on the tab, active racket included, with no sheet open', async () => {
    setIdentity('Lin');
    mockFetchByUrl([
      ['/api/equipment/gear', () => jsonResponse({
        gear: gearDoc([
          { id: 'a', catalogId: ASTROX.id, category: 'racket', label: 'Yonex Astrox 100ZZ' },
          { id: 'b', catalogId: DRIVEX.id, category: 'racket', label: 'Victor DriveX 9X' },
        ], 'a'),
      })],
      ['/api/equipment/catalog', () => jsonResponse({ items: [ASTROX, DRIVEX] })],
      NO_REC,
    ]);

    renderRow();

    await waitFor(() => expect(screen.getByText('Your rackets')).toBeTruthy());
    expect(screen.getByText('Using today')).toBeTruthy();
    expect(screen.getByLabelText('Use this one — Victor DriveX 9X')).toBeTruthy();
    expect(screen.getByLabelText('Remove — Yonex Astrox 100ZZ')).toBeTruthy();
    // The picker is closed: no catalog rows, no search box.
    expect(screen.queryByPlaceholderText('Search rackets')).toBeNull();
  });

  it('a single racket still gets its remove and the Using-today badge', async () => {
    setIdentity('Lin');
    mockFetchByUrl([
      ['/api/equipment/gear', () => jsonResponse({
        gear: gearDoc([{ id: 'a', catalogId: ASTROX.id, category: 'racket', label: 'Yonex Astrox 100ZZ' }], 'a'),
      })],
      ['/api/equipment/catalog', () => jsonResponse({ items: [ASTROX] })],
      NO_REC,
    ]);

    renderRow();

    await waitFor(() => expect(screen.getByText('Using today')).toBeTruthy());
    expect(screen.getByLabelText('Remove — Yonex Astrox 100ZZ')).toBeTruthy();
  });

  // Prevent the 409 rather than catching it after the player has already gone
  // looking for a racket to add. MAX_RACKETS mirrors the API route.
  it('disables Add and explains why once the bag is full', async () => {
    setIdentity('Lin');
    const full = Array.from({ length: 10 }, (_, i) => ({
      id: `r${i}`, catalogId: null, category: 'racket', label: `Racket ${i}`,
    }));
    mockFetchByUrl([
      ['/api/equipment/gear', () => jsonResponse({ gear: gearDoc(full, 'r0') })],
      ['/api/equipment/catalog', () => jsonResponse({ items: [ASTROX] })],
      NO_REC,
    ]);

    renderRow();

    await waitFor(() => expect(screen.getByText("That's all the rackets we can hold — remove one first.")).toBeTruthy());
    expect((screen.getByRole('button', { name: 'Add a racket' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('stored label survives a failed catalog lookup — no error, no empty prompt', async () => {
    setIdentity('Lin');
    mockFetchByUrl([
      ['/api/equipment/gear', () => jsonResponse({
        gear: gearDoc([{ id: 'i1', catalogId: ASTROX.id, category: 'racket', label: 'Yonex Astrox 100ZZ' }]),
      })],
      ['/api/equipment/catalog', () => jsonResponse({}, false)],
      NO_REC,
    ]);

    const { container } = renderRow();

    // The gear doc's stored label is the thing the player actually has —
    // rendering "no racket yet" here would be the lying-empty-state bug
    // pointed the other way (a real racket reported as absent).
    await waitFor(() => expect(screen.getAllByText('Yonex Astrox 100ZZ').length).toBeGreaterThan(0));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText('No racket yet — add yours below.')).toBeNull();
    expect(container.querySelector('.shimmer-line')).toBeNull();
  });

  it('a failed gear fetch shows the error surface, not the empty prompt or an empty bag', async () => {
    setIdentity('Lin');
    mockFetchByUrl([
      ['/api/equipment/gear', () => jsonResponse({}, false)],
      ['/api/equipment/catalog', () => jsonResponse({ items: [ASTROX] })],
      NO_REC,
    ]);

    renderRow();

    await waitFor(() => expect(screen.getAllByRole('alert').length).toBeGreaterThan(0));
    expect(screen.queryByText('No racket yet — add yours below.')).toBeNull();
    // A read failure must not render as a truthful "you own no rackets", and
    // Add is disabled because we don't know what's in the bag.
    expect(screen.queryByText('Your rackets')).toBeNull();
    expect((screen.getByRole('button', { name: 'Add a racket' }) as HTMLButtonElement).disabled).toBe(true);
  });

  /**
   * The monotonic op-counter in useGear, pinned.
   *
   * Both the read and all three writes share one counter, because the Add
   * button is deliberately NOT gated on the gear read having finished — a
   * player can open the picker and add a racket while the mount GET is still
   * in flight. Without the guard, that GET resolves afterwards with the
   * pre-add document and silently reverts the bag. The server stays correct;
   * only the UI lies.
   *
   * This race has shipped here twice, which is why the counter has one owner
   * now instead of a copy in each component.
   */
  it('a slow mount read does not revert the bag past a newer add', async () => {
    setIdentity('Lin');

    let resolveMountGet: ((r: Response) => void) | null = null;
    let gearGetCount = 0;
    const added = { id: 'new', catalogId: ASTROX.id, category: 'racket', label: 'Yonex Astrox 100ZZ' };

    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? 'GET').toUpperCase();
      if (url.includes('/api/recommend')) return jsonResponse({ item: null, reason: null });
      if (url.includes('/api/equipment/catalog')) return jsonResponse({ items: [ASTROX] });
      if (url.includes('/api/equipment/gear')) {
        // The POST returns the post-add document, as the real route does.
        if (method === 'POST') return jsonResponse({ gear: gearDoc([added], 'new') });
        gearGetCount += 1;
        // The first GET is the mount read — held open on purpose and resolved
        // by hand below, after the add has already produced a newer result.
        if (gearGetCount === 1) return new Promise<Response>((resolve) => { resolveMountGet = resolve; });
        return jsonResponse({ gear: gearDoc([added], 'new') });
      }
      return Promise.reject(new Error(`Unmocked fetch: ${url}`));
    }) as unknown as typeof fetch);

    renderRow();

    // Add is reachable while the read is still pending — that's the whole
    // premise of the race.
    const addBtn = await screen.findByRole('button', { name: 'Add a racket' });
    expect((addBtn as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(addBtn);

    fireEvent.click(await screen.findByText('Astrox 100ZZ'));

    // The POST landed: the hero and the bag both show the new racket.
    await waitFor(() => expect(screen.getByText('Using today')).toBeTruthy());

    // Now the stale mount GET finally resolves with the pre-add document.
    // Flush its full .then chain via a macrotask boundary (microtasks always
    // drain before a timer fires) before asserting nothing regressed.
    await act(async () => {
      resolveMountGet?.({ ok: true, status: 200, json: async () => ({ gear: null }) } as Response);
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(screen.getByText('Using today')).toBeTruthy();
    expect(screen.queryByText('No racket yet — add yours below.')).toBeNull();
  });

  it('activating another racket moves the badge and updates the hero', async () => {
    setIdentity('Lin');
    const items = [
      { id: 'a', catalogId: ASTROX.id, category: 'racket', label: 'Yonex Astrox 100ZZ' },
      { id: 'b', catalogId: DRIVEX.id, category: 'racket', label: 'Victor DriveX 9X' },
    ];
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      const method = (init?.method ?? 'GET').toUpperCase();
      if (url.includes('/api/recommend')) return jsonResponse({ item: null, reason: null });
      if (url.includes('/api/equipment/catalog')) return jsonResponse({ items: [ASTROX, DRIVEX] });
      if (url.includes('/api/equipment/gear')) {
        if (method === 'PATCH') return jsonResponse({ gear: gearDoc(items, 'b') });
        return jsonResponse({ gear: gearDoc(items, 'a') });
      }
      return Promise.reject(new Error(`Unmocked fetch: ${url}`));
    }) as unknown as typeof fetch);

    const { container } = renderRow();

    fireEvent.click(await screen.findByLabelText('Use this one — Victor DriveX 9X'));

    await waitFor(() => {
      const patch = calls.find((c) => c.url.includes('/gear') && c.init?.method === 'PATCH');
      expect(patch).toBeTruthy();
      expect(JSON.parse(String(patch!.init!.body))).toEqual({ name: 'Lin', activeRacketId: 'b' });
    });

    // The hero follows the pointer. Scoped to the card because the bag list
    // renders the same label one level down.
    const hero = container.querySelector('.glass-card') as HTMLElement;
    await waitFor(() => expect(within(hero).getByText('DriveX 9X')).toBeTruthy());
    expect(screen.getByLabelText('Use this one — Yonex Astrox 100ZZ')).toBeTruthy();
  });
});
