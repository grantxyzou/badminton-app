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

/** Minimal surface: the bag as text, plus a button that fires `add`. */
function Probe() {
  const gear = useGear('Lin');
  return (
    <div>
      <button type="button" onClick={() => void gear.add(ASTROX)}>add</button>
      <p data-testid="bag">{gear.rackets.map((r) => r.label).join(',') || 'empty'}</p>
      <p data-testid="loaded">{String(gear.loaded)}</p>
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
