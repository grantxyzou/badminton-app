// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { showTopToast, useTopToastBus, TOP_TOAST_SUCCESS_MS, TOP_TOAST_ALERT_MS } from '@/lib/topToast';

/**
 * `<TopToast>` is mounted once, in HomeShell. `showTopToast()` is how a card
 * deep in the tree (the advance form's "Session created!") reaches it, and
 * `useTopToastBus()` is the one listener. The bus owns the timer, so the ring
 * TopToast draws and the moment the message leaves agree.
 */
describe('top toast bus', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('a showTopToast() call becomes the hook\'s current message, with the tone\'s default duration', () => {
    const { result } = renderHook(() => useTopToastBus());
    expect(result.current.toast).toBeNull();

    act(() => {
      showTopToast({ tone: 'success', icon: 'check_circle', title: 'Session created!', body: 'Open it, then share the link.' });
    });
    expect(result.current.toast).toMatchObject({
      tone: 'success',
      icon: 'check_circle',
      title: 'Session created!',
      body: 'Open it, then share the link.',
      durationMs: TOP_TOAST_SUCCESS_MS,
    });

    act(() => {
      showTopToast({ tone: 'danger', icon: 'error', title: 'Nope' });
    });
    expect(result.current.toast?.durationMs).toBe(TOP_TOAST_ALERT_MS);
  });

  it('a new message replaces the one showing under a new id (the countdown ring restarts)', () => {
    const { result } = renderHook(() => useTopToastBus());
    act(() => showTopToast({ tone: 'success', icon: 'check_circle', title: 'One' }));
    const first = result.current.toast?.id;
    act(() => showTopToast({ tone: 'success', icon: 'check_circle', title: 'Two' }));
    expect(result.current.toast?.title).toBe('Two');
    expect(result.current.toast?.id).not.toBe(first);
  });

  it('clears itself when its duration runs out, and sooner on dismiss', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useTopToastBus());

    act(() => showTopToast({ tone: 'success', icon: 'check_circle', title: 'Timed', durationMs: 1000 }));
    expect(result.current.toast?.title).toBe('Timed');
    act(() => { vi.advanceTimersByTime(999); });
    expect(result.current.toast?.title).toBe('Timed');
    act(() => { vi.advanceTimersByTime(1); });
    expect(result.current.toast).toBeNull();

    act(() => showTopToast({ tone: 'success', icon: 'check_circle', title: 'Dismissed', durationMs: 1000 }));
    act(() => result.current.dismiss());
    expect(result.current.toast).toBeNull();
  });

  it('stops listening once unmounted', () => {
    const { result, unmount } = renderHook(() => useTopToastBus());
    unmount();
    act(() => showTopToast({ tone: 'success', icon: 'check_circle', title: 'Late' }));
    expect(result.current.toast).toBeNull();
  });
});
