// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { renderHook, waitFor, cleanup } from '@testing-library/react';
import { useAdminNeedsYou } from '@/lib/useAdminNeedsYou';
import { isNoActiveSession } from '@/lib/apiFetch';

/**
 * Profile's admin row read a new group's `no_active_session` 404 from
 * `/api/players?all=true` as a failed check and showed "Couldn't check" to
 * every new organiser (create-a-group walk, 2026-10-09). No session means
 * nobody can be unpaid: that is an answer.
 */
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function stub(players: () => Response) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/players')) return players();
      if (url.includes('/api/birds')) return new Response(JSON.stringify({ currentStock: 0, burnPerSession: 0 }), { status: 200 });
      return new Response(JSON.stringify([{ active: true, sessionCount: 3, lastSeen: new Date().toISOString() }]), { status: 200 });
    }),
  );
}

describe('useAdminNeedsYou for a group with no session yet', () => {
  it('answers a count, not a failure', async () => {
    stub(() => new Response(JSON.stringify({ error: 'no_active_session' }), { status: 404 }));
    const { result } = renderHook(() => useAdminNeedsYou(true));
    await waitFor(() => expect(result.current.needsYou).toBe(0));
    expect(result.current.loadError).toBe(false);
  });

  it('still reports a real failure', async () => {
    stub(() => new Response(JSON.stringify({ error: 'read_failed' }), { status: 503 }));
    const { result } = renderHook(() => useAdminNeedsYou(true));
    await waitFor(() => expect(result.current.loadError).toBe(true));
    expect(result.current.needsYou).toBeNull();
  });
});

describe('isNoActiveSession', () => {
  it('is true only for the 404 that names no_active_session, and leaves the body readable', async () => {
    const res = new Response(JSON.stringify({ error: 'no_active_session' }), { status: 404 });
    expect(await isNoActiveSession(res)).toBe(true);
    expect(await res.json()).toEqual({ error: 'no_active_session' });
    expect(await isNoActiveSession(new Response('nope', { status: 404 }))).toBe(false);
    expect(await isNoActiveSession(new Response(JSON.stringify({ error: 'no_active_session' }), { status: 500 }))).toBe(false);
    expect(await isNoActiveSession(new Response('[]', { status: 200 }))).toBe(false);
  });
});
