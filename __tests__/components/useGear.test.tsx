// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { useState } from 'react';
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

  // The other half of the same cancellation. `setLoaded(true)` used to live
  // ONLY inside the mount GET's two guarded branches, so a write that claimed
  // the op id first discarded that GET's response and left `loaded` false
  // forever — YourKitCard renders CardSkeleton and GearPickRail's fetch
  // effect early-returns, so the whole register sits on skeletons with no
  // error and no retry until the tab remounts.
  it('a write that cancels the mount read still marks the hook loaded', async () => {
    let resolveMountGet: ((r: Response) => void) | null = null;
    let getCount = 0;
    const added = { id: 'new', catalogId: ASTROX.id, category: 'racket' as const, label: 'Yonex Astrox 100ZZ' };

    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? 'GET').toUpperCase();
      if (!url.includes('/api/equipment/gear')) return Promise.reject(new Error(`Unmocked fetch: ${url}`));
      if (method === 'POST') {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ gear: gearDoc([added], 'new') }) } as Response);
      }
      getCount += 1;
      if (getCount === 1) return new Promise<Response>((resolve) => { resolveMountGet = resolve; });
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ gear: gearDoc([added], 'new') }) } as Response);
    }) as unknown as typeof fetch);

    render(<Probe />);
    expect(screen.getByTestId('loaded').textContent).toBe('false');

    fireEvent.click(screen.getByText('add'));

    // The mount GET is still pending and will be discarded when it lands, so
    // the write itself has to be what flips `loaded`.
    await waitFor(() => expect(screen.getByTestId('loaded').textContent).toBe('true'));
    expect(resolveMountGet).not.toBeNull();
  });

  // A failed write produces no document, so if the read it cancelled was the
  // only one, the hook must re-read rather than stay on skeletons.
  it('re-reads when a failed write cancelled the only read', async () => {
    let getCount = 0;
    const existing = { id: 'r1', catalogId: ASTROX.id, category: 'racket' as const, label: 'Yonex Astrox 100ZZ' };

    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? 'GET').toUpperCase();
      if (!url.includes('/api/equipment/gear')) return Promise.reject(new Error(`Unmocked fetch: ${url}`));
      if (method === 'POST') {
        return Promise.resolve({ ok: false, status: 500, json: async () => ({ error: 'save_failed' }) } as Response);
      }
      getCount += 1;
      // Hold the mount read open forever; only the recovery read resolves.
      if (getCount === 1) return new Promise<Response>(() => {});
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ gear: gearDoc([existing], 'r1') }) } as Response);
    }) as unknown as typeof fetch);

    render(<Probe />);
    expect(screen.getByTestId('loaded').textContent).toBe('false');

    fireEvent.click(screen.getByText('add'));

    await waitFor(() => expect(screen.getByTestId('loaded').textContent).toBe('true'));
    expect(getCount).toBe(2);
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

/**
 * A refused write must say WHICH refusal it was.
 *
 * Every non-409 failure used to collapse into `reason: 'error'`, which both
 * sheets render as "Couldn't load that — refresh to try again". For a lapsed
 * `member_session` that instruction is not vague, it is wrong: the cookie has
 * a 30-day TTL, `badminton_identity` in localStorage has none, so the app goes
 * on resolving an active name — Stats renders, the kit card renders, the sheet
 * opens — while every write is refused, and refreshing can never mint a
 * cookie. The member re-taps a dead button indefinitely.
 */
describe('useGear — a refusal names itself', () => {
  afterEach(cleanup);

  function ReasonProbe({ item }: { item: CatalogItem }) {
    const gear = useGear('Lin');
    const [reason, setReason] = useState('none');
    return (
      <div>
        <span data-testid="reason">{reason}</span>
        <button onClick={async () => setReason(JSON.stringify(await gear.add(item)))}>add</button>
      </div>
    );
  }

  const CASES: [number, string | null, string][] = [
    [401, null, 'unauthorized'],
    [403, null, 'unauthorized'],
    [404, 'member_not_found', 'member_not_found'],
    [409, 'bag_full', 'bag_full'],
    [409, 'duplicate_racket', 'duplicate_racket'],
    // An unrecognised code must NOT be promoted to a specific reason the
    // server never gave — the narrowness rule the union was written under.
    [409, 'save_conflict', 'error'],
    [500, 'save_failed', 'error'],
    // Reachable by anyone: the bag limiter runs BEFORE auth, so twenty taps in
    // an hour replaces whatever the original fault was with this one — the
    // failure mode of someone trying to reproduce a bug.
    [429, 'rate_limited', 'rate_limited'],
  ];

  for (const [status, body, expected] of CASES) {
    it(`maps ${status}${body ? ` ${body}` : ''} to ${expected}`, async () => {
      vi.stubGlobal('fetch', vi.fn(async (_u: string, init?: RequestInit) => {
        const method = init?.method ?? 'GET';
        if (method === 'GET') return { ok: true, status: 200, json: async () => ({ gear: null }) } as Response;
        return { ok: false, status, json: async () => ({ error: body }) } as Response;
      }) as unknown as typeof fetch);

      render(<ReasonProbe item={ASTROX} />);
      fireEvent.click(screen.getByText('add'));
      await waitFor(() =>
        expect(screen.getByTestId('reason').textContent).toBe(JSON.stringify({ ok: false, reason: expected })),
      );
    });
  }
});

/**
 * Adding a string is TWO writes, and the second one failing is not the same
 * event as the first one failing.
 *
 * `add` returned the tension PUT's own failure, so the sheet reported
 * "couldn't save that" — while the POST had already succeeded and the string
 * was in the bag. Worse, the item then appears in `ownedCatalogIds` and is
 * filtered out of the catalog list, so there is no row left to tap to retry.
 * The member is told nothing saved, sees the string listed anyway, and has no
 * route forward.
 */
describe('useGear — a failed tension follow-up is not a failed add', () => {
  afterEach(cleanup);

  function StringProbe() {
    const gear = useGear('Lin');
    const [reason, setReason] = useState('none');
    return (
      <div>
        <span data-testid="reason">{reason}</span>
        <span data-testid="bag">{(gear.gear?.items ?? []).map((i) => i.label).join(',')}</span>
        <button onClick={async () => setReason(JSON.stringify(await gear.add(BG65, { tensionLbs: 24 })))}>add</button>
      </div>
    );
  }

  it('reports tension_not_saved, and the string stays in the bag', async () => {
    const added = { id: 's1', catalogId: BG65.id, category: 'string' as const, label: 'Yonex BG65' };
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (method === 'GET') return { ok: true, status: 200, json: async () => ({ gear: null }) } as Response;
      if (method === 'POST') {
        return { ok: true, status: 200, json: async () => ({ gear: gearDoc([added]) }) } as Response;
      }
      // The tension write fails.
      return { ok: false, status: 500, json: async () => ({ error: 'save_failed' }) } as Response;
    }) as unknown as typeof fetch);

    render(<StringProbe />);
    fireEvent.click(screen.getByText('add'));

    await waitFor(() =>
      expect(screen.getByTestId('reason').textContent)
        .toBe(JSON.stringify({ ok: false, reason: 'tension_not_saved' })),
    );
    // The POST's document was applied, so the bag must still show the string —
    // the failure is about the tension, not the item.
    expect(screen.getByTestId('bag').textContent).toBe('Yonex BG65');
  });
});

/**
 * "Pick this racket" means two different things depending on who is asking.
 *
 * POST's contract is "append to my bag" and it deliberately will not move
 * `activeRacketId` — appending a spare must never silently change the racket
 * you play with. But the kit row that opens the picker is labelled "Change"
 * and the sheet closes the instant you pick, so the member never reaches
 * `BagList`'s "Use this one" to finish the job. Tap Change, choose a
 * different racket, and the row still named the old one while the write
 * returned 200: a control that demonstrably did nothing.
 *
 * The caller now states its intent, so appending a spare from anywhere else
 * still leaves the pointer exactly where the route intends.
 */
describe('useGear — makeActive states the caller intent POST cannot infer', () => {
  afterEach(cleanup);

  const ADDED = { id: 'r-new', catalogId: ASTROX.id, category: 'racket' as const, label: 'Yonex Astrox 100ZZ' };
  const EXISTING = { id: 'r-old', catalogId: 'other', category: 'racket' as const, label: 'Old Racket' };

  function Probe({ makeActive }: { makeActive: boolean }) {
    const gear = useGear('Lin');
    return <button onClick={() => { void gear.add(ASTROX, makeActive ? { makeActive: true } : undefined); }}>add</button>;
  }

  function stubFetch(calls: { method: string; body: unknown }[]) {
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (method === 'GET') {
        return { ok: true, status: 200, json: async () => ({ gear: gearDoc([EXISTING], 'r-old') }) } as Response;
      }
      calls.push({ method, body: init?.body ? JSON.parse(String(init.body)) : null });
      // POST returns the doc with the new racket appended, pointer untouched —
      // exactly what the real route does.
      return { ok: true, status: 200, json: async () => ({ gear: gearDoc([EXISTING, ADDED], 'r-old') }) } as Response;
    }) as unknown as typeof fetch);
  }

  it('follows the add with a PATCH activating the racket it just created', async () => {
    const calls: { method: string; body: unknown }[] = [];
    stubFetch(calls);
    render(<Probe makeActive />);
    fireEvent.click(screen.getByText('add'));

    await waitFor(() => expect(calls.map((c) => c.method)).toEqual(['POST', 'PATCH']));
    // The id exists only in the POST's response body, so this is also the
    // regression test for reading it off a ref rather than racing state.
    expect(calls[1].body).toMatchObject({ activeRacketId: 'r-new' });
  });

  it('leaves the pointer alone when the caller did not ask', async () => {
    const calls: { method: string; body: unknown }[] = [];
    stubFetch(calls);
    render(<Probe makeActive={false} />);
    fireEvent.click(screen.getByText('add'));

    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
    expect(calls.map((c) => c.method)).toEqual(['POST']);
  });
});

/**
 * Recording the tension of a string you ALREADY own.
 *
 * There was no way to do it. `BagList` rendered owned strings read-only and
 * `GearSheet` filters everything you own out of the catalog, so the string on
 * your racket was not tappable anywhere — the only way to record a tension
 * was to add a string you did not already have. The feature worked exactly
 * once per string and never again, which means "update the tension on the
 * strings I'm playing", the thing the field exists for, was impossible.
 */
describe('useGear — setTension updates an owned string in place', () => {
  afterEach(cleanup);

  const OWNED = { id: 's1', catalogId: 'string-yonex-bg65', category: 'string' as const, label: 'Yonex BG65' };

  it('PUTs by catalogId rather than appending a second copy', async () => {
    const calls: { method: string; body: Record<string, unknown> }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (method === 'GET') {
        return { ok: true, status: 200, json: async () => ({ gear: gearDoc([OWNED]) }) } as Response;
      }
      calls.push({ method, body: JSON.parse(String(init?.body)) });
      return {
        ok: true, status: 200,
        json: async () => ({ gear: gearDoc([{ ...OWNED, tensionLbs: 27 }]) }),
      } as Response;
    }) as unknown as typeof fetch);

    function Probe() {
      const gear = useGear('Lin');
      return (
        <div>
          <span data-testid="bag">{(gear.gear?.items ?? []).map((i) => `${i.label}@${i.tensionLbs ?? 'none'}`).join(',')}</span>
          <button onClick={() => { void gear.setTension(OWNED, 27); }}>set</button>
        </div>
      );
    }

    render(<Probe />);
    await waitFor(() => expect(screen.getByTestId('bag').textContent).toBe('Yonex BG65@none'));
    fireEvent.click(screen.getByText('set'));

    // PUT is the idempotent "set this item" verb — it matches on catalogId and
    // updates in place. POST would 409 as a duplicate.
    await waitFor(() => expect(calls.length).toBe(1));
    expect(calls[0].method).toBe('PUT');
    expect(calls[0].body).toMatchObject({
      name: 'Lin',
      item: { catalogId: 'string-yonex-bg65', category: 'string', tensionLbs: 27 },
    });
    await waitFor(() => expect(screen.getByTestId('bag').textContent).toBe('Yonex BG65@27'));
  });
});
