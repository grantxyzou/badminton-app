// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useMemberProbe } from '@/lib/useHasPin';

const originalFetch = global.fetch;

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
  global.fetch = originalFetch;
});

function mockOk(body: unknown) {
  global.fetch = (async () => new Response(JSON.stringify(body), { status: 200 })) as typeof fetch;
}

function mockFail(status: number) {
  global.fetch = (async () => new Response('{}', { status })) as typeof fetch;
}

describe('useMemberProbe', () => {
  it('returns null for empty name', () => {
    const { result } = renderHook(() => useMemberProbe('', 10));
    expect(result.current).toBeNull();
  });

  it('returns null for too-short names (< 2 chars)', () => {
    const { result } = renderHook(() => useMemberProbe('A', 10));
    expect(result.current).toBeNull();
  });

  it('reports an existing member with a PIN', async () => {
    mockOk({ hasPin: true, createdAt: '2026-01-01' });
    const { result } = renderHook(() => useMemberProbe('Alice', 10));
    await act(async () => { vi.advanceTimersByTime(20); });
    await waitFor(() => expect(result.current).toEqual({ exists: true, hasPin: true, authed: false }));
  });

  it('reports an existing member without a PIN', async () => {
    mockOk({ hasPin: false, createdAt: '2026-01-01' });
    const { result } = renderHook(() => useMemberProbe('Bob', 10));
    await act(async () => { vi.advanceTimersByTime(20); });
    await waitFor(() => expect(result.current).toEqual({ exists: true, hasPin: false, authed: false }));
  });

  it('reports no member when the answer carries no createdAt', async () => {
    mockOk({ hasPin: false });
    const { result } = renderHook(() => useMemberProbe('Eve', 10));
    await act(async () => { vi.advanceTimersByTime(20); });
    await waitFor(() => expect(result.current).toEqual({ exists: false, hasPin: false, authed: false }));
  });

  it('stays null on 5xx (network/server failure)', async () => {
    // Critical: server failures must not falsely claim hasPin=false. The UI
    // hint is preventative; a wrong hint is worse than no hint.
    mockFail(500);
    const { result } = renderHook(() => useMemberProbe('Carol', 10));
    await act(async () => { vi.advanceTimersByTime(20); });
    // Give the await chain a tick to settle.
    await act(async () => { await Promise.resolve(); });
    expect(result.current).toBeNull();
  });

  it('stays null on 429 (rate limited)', async () => {
    mockFail(429);
    const { result } = renderHook(() => useMemberProbe('Dan', 10));
    await act(async () => { vi.advanceTimersByTime(20); });
    await act(async () => { await Promise.resolve(); });
    expect(result.current).toBeNull();
  });

  it('resets to null when name changes (debounce restarts)', async () => {
    mockOk({ hasPin: true, createdAt: '2026-01-01' });
    const { result, rerender } = renderHook(({ n }) => useMemberProbe(n, 10), {
      initialProps: { n: 'Alice' },
    });
    await act(async () => { vi.advanceTimersByTime(20); });
    await waitFor(() => expect(result.current?.hasPin).toBe(true));

    rerender({ n: 'Bobby' });
    // Right after rerender, value should be null (probing again).
    expect(result.current).toBeNull();
  });
});
