// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import type { ReactNode } from 'react';
import { OnlineProvider, useOnline, useReportFetchFailure } from '../lib/useOnline';

function wrapper({ children }: { children: ReactNode }) {
  return <OnlineProvider>{children}</OnlineProvider>;
}

function setup() {
  return renderHook(
    () => ({ online: useOnline(), report: useReportFetchFailure() }),
    { wrapper },
  );
}

describe('useOnline', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('defaults to online', () => {
    const { result } = setup();
    expect(result.current.online).toBe(true);
  });

  it('flips offline on the window offline event, back on online', () => {
    const { result } = setup();
    act(() => { window.dispatchEvent(new Event('offline')); });
    expect(result.current.online).toBe(false);
    act(() => { window.dispatchEvent(new Event('online')); });
    expect(result.current.online).toBe(true);
  });

  it('reportFetchFailure flips offline immediately', () => {
    const { result } = setup();
    act(() => { result.current.report(); });
    expect(result.current.online).toBe(false);
  });

  it('reachability ping clears offline once the server responds', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false })   // first ping: still down
      .mockResolvedValueOnce({ ok: true });   // second ping: recovered
    vi.stubGlobal('fetch', fetchMock);

    const { result } = setup();
    act(() => { result.current.report(); });
    expect(result.current.online).toBe(false);

    // First interval tick — server still unreachable.
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    expect(result.current.online).toBe(false);

    // Second tick — server responds ok → online, ping stops.
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    expect(result.current.online).toBe(true);

    const callsAfterRecovery = fetchMock.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(fetchMock.mock.calls.length).toBe(callsAfterRecovery); // stopped
    expect(String(fetchMock.mock.calls[0][0])).toContain('/api/session');
  });
});
