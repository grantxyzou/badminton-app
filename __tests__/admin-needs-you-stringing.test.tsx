// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { renderHook, waitFor, cleanup } from '@testing-library/react';
import { useAdminNeedsYou } from '@/lib/useAdminNeedsYou';

/**
 * Audit 2026-10-11, finding 04: three unclaimed stringing requests and a job
 * two days late showed as "1 need you", because the count read unpaid, birds
 * and dormant members only. The bench is now a fourth signal: unclaimed
 * requests and overdue jobs.
 */
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function stub(stringing: () => Response) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/stringing/jobs')) return stringing();
      if (url.includes('/api/players')) return new Response('[]', { status: 200 });
      if (url.includes('/api/birds')) return new Response(JSON.stringify({ currentStock: 0, burnPerSession: 0 }), { status: 200 });
      return new Response('[]', { status: 200 });
    }),
  );
}

const bench = [
  { id: 'a', stringerId: null, status: 'requested', readyBy: null, paidAt: null },
  { id: 'b', stringerId: 'g', status: 'received', readyBy: '2000-01-01', paidAt: null },
  { id: 'c', stringerId: 'g', status: 'ready', readyBy: '2000-01-01', paidAt: null },
];

describe('useAdminNeedsYou counts the bench', () => {
  it('an unclaimed request or a late job is one more signal, with the breakdown', async () => {
    stub(() => new Response(JSON.stringify({ jobs: bench, view: 'bench' }), { status: 200 }));
    const { result } = renderHook(() => useAdminNeedsYou(true));
    await waitFor(() => expect(result.current.needsYou).toBe(1));
    // `ready` is not late — the outstanding thing is money, not work.
    expect(result.current.stringing).toEqual({ waiting: 1, late: 1 });
  });

  it('a bench with nothing waiting adds nothing', async () => {
    stub(() => new Response(JSON.stringify({ jobs: [bench[2]], view: 'bench' }), { status: 200 }));
    const { result } = renderHook(() => useAdminNeedsYou(true));
    await waitFor(() => expect(result.current.needsYou).toBe(0));
    expect(result.current.stringing).toEqual({ waiting: 0, late: 0 });
  });

  it('the stringing flag being off (404) is not a failed check', async () => {
    stub(() => new Response(JSON.stringify({ error: 'not_found' }), { status: 404 }));
    const { result } = renderHook(() => useAdminNeedsYou(true));
    await waitFor(() => expect(result.current.needsYou).toBe(0));
    expect(result.current.stringing).toBeNull();
    expect(result.current.loadError).toBe(false);
  });

  it('a real bench failure leaves the bench UNKNOWN and keeps the other three signals', async () => {
    // Fail open (final review): the bench read shares a per-IP limit with every
    // member's Home card, so a 429 on gym wifi is plausible — and it must not
    // null the unpaid / birds / dormant count that was fine.
    stub(() => new Response(JSON.stringify({ error: 'read_failed' }), { status: 503 }));
    const { result } = renderHook(() => useAdminNeedsYou(true));
    await waitFor(() => expect(result.current.needsYou).toBe(0));
    expect(result.current.stringing).toBeNull();
    expect(result.current.loadError).toBe(false);
  });

  it('a paid racket waiting to be collected is not "late"', async () => {
    // The work is done; the date has passed because the player has not come
    // for it. That is not the stringer's lateness and must not count.
    stub(() => new Response(JSON.stringify({ jobs: [{ id: 'p', stringerId: 'g', status: 'ready', readyBy: '2000-01-01', paidAt: '2026-10-01T00:00:00Z' }], view: 'bench' }), { status: 200 }));
    const { result } = renderHook(() => useAdminNeedsYou(true));
    await waitFor(() => expect(result.current.stringing).not.toBeNull());
    expect(result.current.stringing).toEqual({ waiting: 0, late: 0 });
  });
});
