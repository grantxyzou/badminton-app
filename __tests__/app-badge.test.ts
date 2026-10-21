// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * The app icon's badge (docs/plans/native-badge-shortcuts.md): what it
 * counts, and that it never prompts, never throws, and never clears on a
 * badge that was already empty.
 */

const badge = vi.hoisted(() => ({
  checkPermissions: vi.fn(),
  get: vi.fn(),
  set: vi.fn(),
  clear: vi.fn(),
}));
vi.mock('@capawesome/capacitor-badge', () => ({ Badge: badge }));

import { owedBadgeCount, syncAppBadge, clearAppBadge } from '@/lib/appBadge';

function nativeShell(pluginAvailable = true) {
  (window as unknown as { Capacitor?: unknown }).Capacitor = {
    isNativePlatform: () => true,
    getPlatform: () => 'ios',
    isPluginAvailable: () => pluginAvailable,
  };
}

beforeEach(() => {
  for (const f of Object.values(badge)) f.mockReset();
  badge.checkPermissions.mockResolvedValue({ display: 'granted' });
  badge.get.mockResolvedValue({ count: 0 });
});
afterEach(() => {
  delete (window as unknown as { Capacitor?: unknown }).Capacitor;
  delete (navigator as unknown as { setAppBadge?: unknown }).setAppBadge;
  delete (navigator as unknown as { clearAppBadge?: unknown }).clearAppBadge;
});

describe('owedBadgeCount', () => {
  it('counts settled lines not reported paid, plus stringing charges', () => {
    expect(owedBadgeCount({
      sessions: [
        { settled: true },
        { settled: true, selfReported: true },
        { settled: false },
      ],
      stringing: [{}, {}],
    })).toBe(3);
  });

  it('is zero with nothing owed or no answer', () => {
    expect(owedBadgeCount({ sessions: [], stringing: [] })).toBe(0);
    expect(owedBadgeCount(null)).toBe(0);
  });
});

describe('syncAppBadge in the store app', () => {
  it('sets the count when it changed', async () => {
    nativeShell();
    await syncAppBadge(2);
    expect(badge.set).toHaveBeenCalledWith({ count: 2 });
  });

  it('does nothing when the badge already shows that count', async () => {
    nativeShell();
    badge.get.mockResolvedValue({ count: 2 });
    await syncAppBadge(2);
    expect(badge.set).not.toHaveBeenCalled();
  });

  // On iOS a zero badge also clears delivered notifications.
  it('clears only a badge that was showing something', async () => {
    nativeShell();
    await clearAppBadge();
    expect(badge.clear).not.toHaveBeenCalled();
    badge.get.mockResolvedValue({ count: 1 });
    await syncAppBadge(0);
    expect(badge.clear).toHaveBeenCalledTimes(1);
  });

  it('never prompts: no permission, no badge', async () => {
    nativeShell();
    badge.checkPermissions.mockResolvedValue({ display: 'prompt' });
    await syncAppBadge(3);
    expect(badge.set).not.toHaveBeenCalled();
  });

  it('leaves a binary that predates the plugin alone', async () => {
    nativeShell(false);
    await syncAppBadge(3);
    expect(badge.checkPermissions).not.toHaveBeenCalled();
  });

  it('never throws when the plugin does', async () => {
    nativeShell();
    badge.set.mockRejectedValue(new Error('UNIMPLEMENTED'));
    await expect(syncAppBadge(1)).resolves.toBeUndefined();
  });
});

describe('syncAppBadge in the web app on a home screen', () => {
  it('uses the Badging API', async () => {
    const set = vi.fn().mockResolvedValue(undefined);
    const clear = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { setAppBadge: set, clearAppBadge: clear });
    await syncAppBadge(1);
    expect(set).toHaveBeenCalledWith(1);
    await syncAppBadge(0);
    expect(clear).toHaveBeenCalled();
    expect(badge.set).not.toHaveBeenCalled();
  });
});
