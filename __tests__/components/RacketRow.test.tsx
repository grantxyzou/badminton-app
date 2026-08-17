// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
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
