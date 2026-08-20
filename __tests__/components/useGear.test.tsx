// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, act } from '@testing-library/react';
import { useGear } from '../../components/stats/useGear';
import type { CatalogItem, PlayerGear } from '../../lib/types';

/**
 * The monotonic op-counter in `useGear`, pinned directly on the hook.
 *
 * `useGear.ts:38-46` says this race "has shipped as a bug twice here", and its
 * only regression test lived in `__tests__/components/RacketRow.test.tsx:203`,
 * which went with that file. Pinning it on the hook rather than on a consumer
 * is strictly better: the guard belongs to the hook, and a test on the hook
 * cannot be deleted by a UI refactor the way the last one was.
 *
 * The counter is shared by the read AND all three writes because a mutation is
 * deliberately NOT gated on the mount read having finished — a member can open
 * the picker and add while the initial GET is still in flight. Without the
 * guard that GET lands afterwards carrying the PRE-add document and silently
 * reverts the bag. The server stays correct; only the UI lies.
 */

const ASTROX: CatalogItem = {
  id: 'racket-yonex-astrox-100zz',
  category: 'racket',
  brand: 'Yonex',
  model: 'Astrox 100ZZ',
  skillRange: [4, 6],
};

function gearDoc(items: PlayerGear['items'], activeRacketId?: string): PlayerGear {
  return { id: 'gear-1', memberId: 'm1', items, ...(activeRacketId ? { activeRacketId } : null) } as PlayerGear;
}

const BG65: CatalogItem = {
  id: 'string-yonex-bg65',
  category: 'string',
  brand: 'Yonex',
  model: 'BG65',
  skillRange: [1, 6],
};

/** Minimal surface: the bag as text, plus a button that fires `add`. */
function Probe() {
  const gear = useGear('Lin');
  return (
    <div>
      <button type="button" onClick={() => void gear.add(ASTROX)}>add</button>
      <button type="button" onClick={() => void gear.add(BG65, { tensionLbs: 24 })}>add-string</button>
      <p data-testid="bag">{gear.rackets.map((r) => r.label).join(',') || 'empty'}</p>
      <p data-testid="loaded">{String(gear.loaded)}</p>
      <p data-testid="tension">{String(gear.gear?.items.find((i) => i.category === 'string')?.tensionLbs ?? 'none')}</p>
    </div>
  );
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('useGear — the shared op counter', () => {
  it('a slow mount read does not revert the bag past a newer add', async () => {
    let resolveMountGet: ((r: Response) => void) | null = null;
    let getCount = 0;
    const added = { id: 'new', catalogId: ASTROX.id, category: 'racket' as const, label: 'Yonex Astrox 100ZZ' };

    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? 'GET').toUpperCase();
      if (!url.includes('/api/equipment/gear')) return Promise.reject(new Error(`Unmocked fetch: ${url}`));
      // The POST returns the post-add document, as the real route does.
      if (method === 'POST') {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ gear: gearDoc([added], 'new') }) } as Response);
      }
      getCount += 1;
      // The mount read is held open on purpose and resolved by hand below,
      // after the add has already produced a newer result.
      if (getCount === 1) return new Promise<Response>((resolve) => { resolveMountGet = resolve; });
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ gear: gearDoc([added], 'new') }) } as Response);
    }) as unknown as typeof fetch);

    render(<Probe />);

    // Adding is reachable while the read is still pending — that is the whole
    // premise of the race, and why the guard cannot be replaced by "wait for
    // the read before allowing writes".
    expect(screen.getByTestId('loaded').textContent).toBe('false');
    fireEvent.click(screen.getByText('add'));

    await waitFor(() => expect(screen.getByTestId('bag').textContent).toBe('Yonex Astrox 100ZZ'));

    // Now the stale mount GET finally resolves with the PRE-add document.
    // Flush its full .then chain via a macrotask boundary (microtasks always
    // drain before a timer fires) before asserting nothing regressed.
    await act(async () => {
      resolveMountGet?.({ ok: true, status: 200, json: async () => ({ gear: null }) } as Response);
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(screen.getByTestId('bag').textContent).toBe('Yonex Astrox 100ZZ');
  });
});

describe('useGear — add() with a tension follow-up', () => {
  // POST (the add-to-bag verb) has never read tensionLbs off the wire; PUT
  // already does. `add`'s extra.tensionLbs argument fires a follow-up PUT
  // after a successful POST — this pins that the follow-up actually lands and
  // that a plain add() (no extra) makes no second call at all.
  it('attaches tensionLbs via a follow-up PUT after a successful add', async () => {
    const calls: string[] = [];
    let putBody: Record<string, unknown> | null = null;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? 'GET').toUpperCase();
      if (!url.includes('/api/equipment/gear')) throw new Error(`Unmocked fetch: ${url}`);
      calls.push(method);
      if (method === 'GET') return { ok: true, status: 200, json: async () => ({ gear: null }) } as Response;
      if (method === 'POST') {
        const added = { id: 's1', catalogId: BG65.id, category: 'string' as const, label: 'Yonex BG65' };
        return { ok: true, status: 200, json: async () => ({ gear: gearDoc([added]) }) } as Response;
      }
      if (method === 'PUT') {
        putBody = JSON.parse(String(init?.body));
        const withTension = { id: 's1', catalogId: BG65.id, category: 'string' as const, label: 'Yonex BG65', tensionLbs: 24 };
        return { ok: true, status: 200, json: async () => ({ gear: gearDoc([withTension]) }) } as Response;
      }
      throw new Error(`Unexpected method: ${method}`);
    }) as unknown as typeof fetch);

    render(<Probe />);
    await waitFor(() => expect(screen.getByTestId('loaded').textContent).toBe('true'));

    fireEvent.click(screen.getByText('add-string'));

    await waitFor(() => expect(screen.getByTestId('tension').textContent).toBe('24'));
    expect(calls.filter((m) => m === 'POST')).toHaveLength(1);
    expect(calls.filter((m) => m === 'PUT')).toHaveLength(1);
    expect((putBody as unknown as { item: { catalogId: string; tensionLbs: number } }).item.catalogId).toBe(BG65.id);
    expect((putBody as unknown as { item: { catalogId: string; tensionLbs: number } }).item.tensionLbs).toBe(24);
  });

  // PUT's own pointer rule always claims activeRacketId for a racket
  // (route.ts:373), which POST deliberately does NOT do when the bag already
  // has a pointer (route.ts:180-186). A tension follow-up firing for a
  // racket would silently override POST's pointer decision, so `add` must
  // never send one for anything but a string, regardless of what a caller
  // passes.
  it('fires no PUT for a racket even if a caller passes tensionLbs', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? 'GET').toUpperCase();
      if (!url.includes('/api/equipment/gear')) throw new Error(`Unmocked fetch: ${url}`);
      calls.push(method);
      if (method === 'GET') return { ok: true, status: 200, json: async () => ({ gear: null }) } as Response;
      const added = { id: 'r1', catalogId: ASTROX.id, category: 'racket' as const, label: 'Yonex Astrox 100ZZ' };
      return { ok: true, status: 200, json: async () => ({ gear: gearDoc([added], 'r1') }) } as Response;
    }) as unknown as typeof fetch);

    function RacketWithTensionProbe() {
      const gear = useGear('Lin');
      return (
        <button type="button" onClick={() => void gear.add(ASTROX, { tensionLbs: 24 })}>add-racket-with-tension</button>
      );
    }

    render(<RacketWithTensionProbe />);
    await waitFor(() => expect(calls).toContain('GET'));

    fireEvent.click(screen.getByText('add-racket-with-tension'));
    await waitFor(() => expect(calls.filter((m) => m === 'POST')).toHaveLength(1));

    // Give a wrongly-fired PUT a tick to show up before asserting its absence.
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(calls.filter((m) => m === 'PUT')).toHaveLength(0);
  });

  it('fires no PUT when add() is called with no tension', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? 'GET').toUpperCase();
      if (!url.includes('/api/equipment/gear')) throw new Error(`Unmocked fetch: ${url}`);
      calls.push(method);
      if (method === 'GET') return { ok: true, status: 200, json: async () => ({ gear: null }) } as Response;
      const added = { id: 'r1', catalogId: ASTROX.id, category: 'racket' as const, label: 'Yonex Astrox 100ZZ' };
      return { ok: true, status: 200, json: async () => ({ gear: gearDoc([added], 'r1') }) } as Response;
    }) as unknown as typeof fetch);

    render(<Probe />);
    await waitFor(() => expect(screen.getByTestId('loaded').textContent).toBe('true'));

    fireEvent.click(screen.getByText('add'));
    await waitFor(() => expect(screen.getByTestId('bag').textContent).toBe('Yonex Astrox 100ZZ'));

    expect(calls.filter((m) => m === 'PUT')).toHaveLength(0);
  });
});
