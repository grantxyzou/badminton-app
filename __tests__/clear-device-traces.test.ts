import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Sign-out clears the badge, the long-press menu and the widget, and never
 * waits on them for long: one native call that never answered once left the
 * Sign out button doing nothing (docs/plans/native-widgets.md, 2026-10-23).
 */

const clears = vi.hoisted(() => ({
  badge: vi.fn<() => Promise<void>>(),
  shortcuts: vi.fn<() => Promise<void>>(),
  widgets: vi.fn<() => Promise<void>>(),
}));
vi.mock('@/lib/appBadge', () => ({ clearAppBadge: clears.badge }));
vi.mock('@/lib/appShortcuts', () => ({ clearAppShortcuts: clears.shortcuts }));
vi.mock('@/lib/widgetBridge', () => ({ clearWidgets: clears.widgets }));

import { clearDeviceTraces, CLEAR_TRACES_MS } from '@/lib/clearDeviceTraces';

beforeEach(() => {
  vi.useFakeTimers();
  for (const f of Object.values(clears)) f.mockReset().mockResolvedValue(undefined);
});
afterEach(() => {
  vi.useRealTimers();
});

describe('clearDeviceTraces', () => {
  it('asks all three to clear', async () => {
    await clearDeviceTraces();
    expect(clears.badge).toHaveBeenCalledTimes(1);
    expect(clears.shortcuts).toHaveBeenCalledTimes(1);
    expect(clears.widgets).toHaveBeenCalledTimes(1);
  });

  it('stops waiting on a call that never answers', async () => {
    clears.shortcuts.mockReturnValue(new Promise<void>(() => {}));
    let done = false;
    const p = clearDeviceTraces().then(() => {
      done = true;
    });
    await vi.advanceTimersByTimeAsync(CLEAR_TRACES_MS - 1);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await p;
    expect(done).toBe(true);
  });

  it('never rejects when a clear fails', async () => {
    clears.badge.mockRejectedValue(new Error('UNIMPLEMENTED'));
    await expect(clearDeviceTraces()).resolves.toBeUndefined();
  });
});
