// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useBodyScrollLock } from '../../../components/BottomSheet/useBodyScrollLock';

describe('useBodyScrollLock', () => {
  afterEach(() => {
    document.body.style.position = '';
    document.body.style.top = '';
    document.body.style.width = '';
  });

  it('applies position: fixed to body when active', () => {
    // Unmounted: the lock is reference-counted at module scope, so a hold
    // left behind here would make every later test see a lock already held.
    const { unmount } = renderHook(() => useBodyScrollLock(true));
    expect(document.body.style.position).toBe('fixed');
    unmount();
  });

  it('does NOT apply when inactive', () => {
    renderHook(() => useBodyScrollLock(false));
    expect(document.body.style.position).toBe('');
  });

  it('restores body styles on unmount', () => {
    const { unmount } = renderHook(() => useBodyScrollLock(true));
    expect(document.body.style.position).toBe('fixed');
    unmount();
    expect(document.body.style.position).toBe('');
    expect(document.body.style.top).toBe('');
    expect(document.body.style.width).toBe('');
  });

  /**
   * Two instances at once — the sheet-swap case. `GearPickRail` closes the
   * pick sheet and opens the fit sheet in the same commit, so the first
   * instance is still holding the lock through its 220 ms closing phase when
   * the second takes one. Per-instance snapshots restored the page to
   * scrollable beneath the open sheet, then pinned it fixed with nothing on
   * screen. Only the last release may restore.
   */
  it('reference-counts: the first release keeps the lock, the last restores the page', () => {
    window.scrollTo(0, 240);
    Object.defineProperty(window, 'scrollY', { value: 240, configurable: true });
    const first = renderHook(() => useBodyScrollLock(true));
    expect(document.body.style.top).toBe('-240px');

    Object.defineProperty(window, 'scrollY', { value: 0, configurable: true });
    const second = renderHook(() => useBodyScrollLock(true));
    // The second hold must NOT re-snapshot the already-fixed body.
    expect(document.body.style.top).toBe('-240px');

    first.unmount();
    expect(document.body.style.position).toBe('fixed');
    expect(document.body.style.top).toBe('-240px');

    second.unmount();
    expect(document.body.style.position).toBe('');
    expect(document.body.style.top).toBe('');
  });
});
