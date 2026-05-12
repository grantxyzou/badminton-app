// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useHasPin } from '@/lib/useHasPin';

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

describe('useHasPin', () => {
  it('returns null for empty name', () => {
    const { result } = renderHook(() => useHasPin('', 10));
    expect(result.current).toBeNull();
  });

  it('returns null for too-short names (< 2 chars)', () => {
    const { result } = renderHook(() => useHasPin('A', 10));
    expect(result.current).toBeNull();
  });

  it('returns true when probe says hasPin: true', async () => {
    mockOk({ hasPin: true });
    const { result } = renderHook(() => useHasPin('Alice', 10));
    await act(async () => { vi.advanceTimersByTime(20); });
    await waitFor(() => expect(result.current).toBe(true));
  });

  it('returns false when probe says hasPin: false', async () => {
    mockOk({ hasPin: false });
    const { result } = renderHook(() => useHasPin('Bob', 10));
    await act(async () => { vi.advanceTimersByTime(20); });
    await waitFor(() => expect(result.current).toBe(false));
  });

  it('stays null on 5xx (network/server failure)', async () => {
    // Critical: server failures must not falsely claim hasPin=false. The UI
    // hint is preventative; a wrong hint is worse than no hint.
    mockFail(500);
    const { result } = renderHook(() => useHasPin('Carol', 10));
    await act(async () => { vi.advanceTimersByTime(20); });
    // Give the await chain a tick to settle.
    await act(async () => { await Promise.resolve(); });
    expect(result.current).toBeNull();
  });

  it('stays null on 429 (rate limited)', async () => {
    mockFail(429);
    const { result } = renderHook(() => useHasPin('Dan', 10));
    await act(async () => { vi.advanceTimersByTime(20); });
    await act(async () => { await Promise.resolve(); });
    expect(result.current).toBeNull();
  });

  it('resets to null when name changes (debounce restarts)', async () => {
    mockOk({ hasPin: true });
    const { result, rerender } = renderHook(({ n }) => useHasPin(n, 10), {
      initialProps: { n: 'Alice' },
    });
    await act(async () => { vi.advanceTimersByTime(20); });
    await waitFor(() => expect(result.current).toBe(true));

    rerender({ n: 'Bobby' });
    // Right after rerender, value should be null (probing again).
    expect(result.current).toBeNull();
  });
});
