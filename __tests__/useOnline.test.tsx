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
    // A test that overrode the tab's visibility hands jsdom's own back.
    delete (document as { visibilityState?: unknown }).visibilityState;
  });

  it('defaults to online', () => {
    const { result } = setup();
    expect(result.current.online).toBe(true);
  });

  it('flips offline on the window offline event', () => {
    const { result } = setup();
    act(() => { window.dispatchEvent(new Event('offline')); });
    expect(result.current.online).toBe(false);
  });

  it('does NOT trust the online event on its own — it probes', async () => {
    // WKWebView fires `online` on an interface that is up but not yet usable.
    // This used to setOnline(true) and cancel the ping outright, destroying
    // the one active recovery mechanism on the say-so of the event least
    // qualified to judge. Now the event asks; the probe answers.
    const fetchMock = vi.fn().mockResolvedValue({ ok: false });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = setup();
    await act(async () => { window.dispatchEvent(new Event('offline')); });
    expect(result.current.online).toBe(false);

    await act(async () => { window.dispatchEvent(new Event('online')); });
    expect(result.current.online).toBe(false); // server still says no
  });

  it('reportFetchFailure flips offline immediately', () => {
    const { result } = setup();
    act(() => { result.current.report(); });
    expect(result.current.online).toBe(false);
  });

  it('probes IMMEDIATELY on going offline, not in 15 seconds', async () => {
    // The handover case: the in-flight request dies at the instant the network
    // becomes healthy again, so the very next request would have succeeded.
    // Waiting for the first interval tick disabled the whole app for 15s over
    // a working connection.
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = setup();
    await act(async () => { result.current.report(); });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain('/api/session');
    expect(result.current.online).toBe(true);
  });

  it('re-probes on resume, because iOS suspends the interval while backgrounded', async () => {
    // `bpm:resume` is dispatched by NativeBridge on Capacitor appStateChange.
    // A phone locked after a network flip comes back with the timer suspended,
    // so without this the stale banner outlives the problem.
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false })  // the immediate probe: still down
      .mockResolvedValueOnce({ ok: true });  // on resume: recovered
    vi.stubGlobal('fetch', fetchMock);

    const { result } = setup();
    await act(async () => { result.current.report(); });
    expect(result.current.online).toBe(false);

    await act(async () => { window.dispatchEvent(new Event('bpm:resume')); });
    expect(result.current.online).toBe(true);
  });

  it('reachability ping clears offline once the server responds', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false })   // the immediate probe
      .mockResolvedValueOnce({ ok: false })   // first interval tick: still down
      .mockResolvedValueOnce({ ok: true });   // second tick: recovered
    vi.stubGlobal('fetch', fetchMock);

    const { result } = setup();
    await act(async () => { result.current.report(); });
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

  it('stops pinging while the tab is hidden and probes at once when it is visible again', async () => {
    // Nobody reads the banner in a hidden tab, so a probe there answers a
    // question nobody asked — and a laptop with the app parked in a
    // background tab asked the server every 15 s for as long as the network
    // was down. Hidden stops the interval; visible probes and restarts it.
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue({ ok: false });
    vi.stubGlobal('fetch', fetchMock);
    let visibility: DocumentVisibilityState = 'visible';
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });

    const { result } = setup();
    await act(async () => { result.current.report(); });
    expect(fetchMock).toHaveBeenCalledTimes(1); // the immediate probe
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    expect(fetchMock).toHaveBeenCalledTimes(2); // one tick while on screen

    visibility = 'hidden';
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(fetchMock).toHaveBeenCalledTimes(2); // four ticks' worth, none sent
    expect(result.current.online).toBe(false); // still honest about it

    visibility = 'visible';
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(fetchMock).toHaveBeenCalledTimes(3); // probes at once, still down
    expect(result.current.online).toBe(false);

    // The interval is back: the next tick runs.
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('going offline in a hidden tab starts no interval; the first look back does', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false })  // the immediate probe on the offline event
      .mockResolvedValue({ ok: true });      // whatever comes next: recovered
    vi.stubGlobal('fetch', fetchMock);
    let visibility: DocumentVisibilityState = 'hidden';
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });

    const { result } = setup();
    await act(async () => { window.dispatchEvent(new Event('offline')); });
    expect(result.current.online).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => { await vi.advanceTimersByTimeAsync(45_000); });
    expect(fetchMock).toHaveBeenCalledTimes(1); // no interval was started

    visibility = 'visible';
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.current.online).toBe(true);
  });

  it('a wake while online probes nothing', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    setup();
    await act(async () => { window.dispatchEvent(new Event('focus')); });
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
