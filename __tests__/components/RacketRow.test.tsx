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

function setIdentity(name: string) {
  localStorage.setItem(
    'badminton_identity',
    JSON.stringify({ name, token: 'tok', sessionId: 'session-2026-06-18' }),
  );
}

function jsonResponse(body: unknown, ok = true) {
  return Promise.resolve({ ok, json: async () => body } as Response);
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

function renderRow() {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <RacketRow />
    </NextIntlClientProvider>,
  );
}

describe('RacketRow', () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it('resolves gear and catalog together — hero shows model, brand and specs', async () => {
    setIdentity('Lin');
    mockFetchByUrl([
      ['/api/equipment/gear', () => jsonResponse({
        gear: { id: 'gear-1', memberId: 'm1', updatedAt: '2026-01-01', items: [
          { id: 'i1', catalogId: ASTROX.id, category: 'racket', label: 'Yonex Astrox 100ZZ' },
        ] },
      })],
      ['/api/equipment/catalog', () => jsonResponse({ items: [ASTROX] })],
      NO_REC,
    ]);

    renderRow();

    await waitFor(() => expect(screen.getByText('Astrox 100ZZ')).toBeTruthy());
    expect(screen.getByText('Yonex')).toBeTruthy();
    expect(screen.getByText('Power · Head-heavy')).toBeTruthy();
    expect(screen.getByText('4U (83–88g) · Extra Stiff')).toBeTruthy();
  });

  it('stored label survives a failed catalog lookup — no error, no empty prompt', async () => {
    setIdentity('Lin');
    mockFetchByUrl([
      ['/api/equipment/gear', () => jsonResponse({
        gear: { id: 'gear-1', memberId: 'm1', updatedAt: '2026-01-01', items: [
          { id: 'i1', catalogId: ASTROX.id, category: 'racket', label: 'Yonex Astrox 100ZZ' },
        ] },
      })],
      ['/api/equipment/catalog', () => jsonResponse({}, false)],
      NO_REC,
    ]);

    const { container } = renderRow();

    // The gear doc's stored label is the thing the player actually has —
    // rendering "no racket yet" here would be the lying-empty-state bug
    // pointed the other way (a real racket reported as absent).
    await waitFor(() => expect(screen.getByText('Yonex Astrox 100ZZ')).toBeTruthy());
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText('Tap to pick yours')).toBeNull();
    expect(container.querySelector('.shimmer-line')).toBeNull();
  });

  // Fix wave 2026-08: RacketRow passed `loadGear` straight through as
  // GearSheet's onSaved, discarding the `live` cleanup closure loadGear used
  // to return. That closure only ever guarded a call against ITS OWN
  // unmount — it did nothing to order two overlapping loadGear() calls
  // against each other. Rapid activate→remove fires two GETs; the older can
  // resolve after the newer and clobber the hero card, with nothing left to
  // refetch and correct it since onSaved already ran. The fix mirrors
  // GearSheet's own gearOpRef monotonic counter.
  it('an out-of-order gear refetch does not revert the hero past a newer mutation', async () => {
    setIdentity('Lin');

    const RACKET_A = { id: 'a', catalogId: null, category: 'racket', label: 'Yonex Astrox 100ZZ' };
    const RACKET_B = { id: 'b', catalogId: null, category: 'racket', label: 'Victor DriveX 9X' };
    // The stale body the delayed mount GET eventually resolves with — echoes
    // the pre-mutation world, which must never win against a newer response.
    const staleGearActiveA = {
      id: 'gear-1', memberId: 'm1', updatedAt: '2026-01-01', activeRacketId: 'a', items: [RACKET_A, RACKET_B],
    };
    // What every OTHER gear GET (and the PATCH) resolves with — the current,
    // post-activation server truth.
    const freshGearActiveB = {
      id: 'gear-1', memberId: 'm1', updatedAt: '2026-01-02', activeRacketId: 'b', items: [RACKET_A, RACKET_B],
    };

    let resolveMountGet: ((r: Response) => void) | null = null;
    let gearGetCount = 0;

    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? 'GET').toUpperCase();
      if (url.includes('/api/recommend')) return Promise.resolve({ ok: true, json: async () => ({ item: null, reason: null }) } as Response);
      if (url.includes('/api/equipment/catalog')) return Promise.resolve({ ok: true, json: async () => ({ items: [] }) } as Response);
      if (url.includes('/api/equipment/gear')) {
        if (method === 'PATCH') return Promise.resolve({ ok: true, json: async () => ({ gear: freshGearActiveB }) } as Response);
        // GET: the FIRST call is RacketRow's own mount fetch — held open
        // deliberately and resolved by hand at the end of the test, after a
        // mutation has already produced a newer result. Every later GET
        // (GearSheet's own load-on-open, and RacketRow's post-activate
        // refetch via onSaved) reflects current server state.
        gearGetCount += 1;
        if (gearGetCount === 1) {
          return new Promise<Response>((resolve) => { resolveMountGet = resolve; });
        }
        return Promise.resolve({ ok: true, json: async () => ({ gear: freshGearActiveB }) } as Response);
      }
      return Promise.reject(new Error(`Unmocked fetch: ${url}`));
    }) as unknown as typeof fetch);

    const { container } = renderRow();

    // The mount GET never resolves yet, so the hero still shows its shimmer
    // — but the card itself is always clickable (onEdit doesn't gate on
    // load state), so the sheet can be opened regardless.
    const heroButton = container.querySelector('button.glass-card') as HTMLElement;
    fireEvent.click(heroButton);

    const activateBtn = await screen.findByLabelText('Use this one — Yonex Astrox 100ZZ');
    fireEvent.click(activateBtn);

    // The activation's PATCH resolves, GearSheet calls onSaved (loadGear),
    // and RacketRow's post-activate refetch (a GET newer than the still-open
    // mount GET) lands — the hero now reflects the mutation. Scoped to the
    // hero button: GearSheet's own BagList also renders "Victor DriveX 9X"
    // as a row label, so an unscoped query matches both.
    await waitFor(() => expect(within(heroButton).getByText('Victor DriveX 9X')).toBeTruthy());

    // Now the stale mount GET finally resolves with pre-mutation data. Flush
    // its full .then chain via a macrotask boundary (microtasks always drain
    // before a timer fires) before asserting nothing regressed.
    await act(async () => {
      resolveMountGet?.({ ok: true, json: async () => ({ gear: staleGearActiveA }) } as Response);
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(within(heroButton).getByText('Victor DriveX 9X')).toBeTruthy();
    expect(within(heroButton).queryByText('Yonex Astrox 100ZZ')).toBeNull();
  });

  it('a failed gear fetch shows the error surface, not the empty prompt', async () => {
    setIdentity('Lin');
    mockFetchByUrl([
      ['/api/equipment/gear', () => jsonResponse({}, false)],
      ['/api/equipment/catalog', () => jsonResponse({ items: [ASTROX] })],
      NO_REC,
    ]);

    renderRow();

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.queryByText('Tap to pick yours')).toBeNull();
  });
});
