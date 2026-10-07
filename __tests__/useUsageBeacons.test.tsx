// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, cleanup } from '@testing-library/react';
import { useUsageBeacons, usagePlatform, REOPEN_AFTER_MS } from '@/lib/useUsageBeacons';

/**
 * The client half of the usage records (docs/plans/usage-metrics.md). What
 * matters is what it does NOT send: nothing with the flag off, nothing for a
 * signed-out visitor, nothing for the admin tab, and no second app_open for a
 * quick glance away.
 */

const FLAG = 'NEXT_PUBLIC_FLAG_USAGE_METRICS';
const before = process.env[FLAG];
let sent: Array<Record<string, unknown>>;

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  document.dispatchEvent(new Event('visibilitychange'));
}

beforeEach(() => {
  sent = [];
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
    sent.push(JSON.parse(String(init.body)));
    return new Response('{}', { status: 201 });
  }));
  process.env[FLAG] = 'true';
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  if (before === undefined) delete process.env[FLAG];
  else process.env[FLAG] = before;
});

describe('useUsageBeacons', () => {
  it('sends nothing with the flag off', () => {
    process.env[FLAG] = 'false';
    renderHook(() => useUsageBeacons('home', true));
    expect(sent).toEqual([]);
  });

  it('sends nothing for a signed-out visitor', () => {
    renderHook(() => useUsageBeacons('home', false));
    expect(sent).toEqual([]);
  });

  it('records one app_open and each change of tab, never admin', () => {
    const { rerender } = renderHook(({ tab }) => useUsageBeacons(tab, true), { initialProps: { tab: 'home' } });
    rerender({ tab: 'home' });
    rerender({ tab: 'skills' });
    rerender({ tab: 'admin' });
    rerender({ tab: 'profile' });
    expect(sent).toEqual([
      { kind: 'app_open', platform: 'web' },
      { kind: 'tab_view', tab: 'home' },
      { kind: 'tab_view', tab: 'skills' },
      { kind: 'tab_view', tab: 'profile' },
    ]);
  });

  it('counts a return after half an hour as another open, a quick glance as nothing', () => {
    vi.useFakeTimers();
    renderHook(() => useUsageBeacons('home', true));
    setVisibility('hidden');
    vi.advanceTimersByTime(5 * 60 * 1000);
    setVisibility('visible');
    expect(sent.filter((e) => e.kind === 'app_open')).toHaveLength(1);
    setVisibility('hidden');
    vi.advanceTimersByTime(REOPEN_AFTER_MS);
    setVisibility('visible');
    expect(sent.filter((e) => e.kind === 'app_open')).toHaveLength(2);
  });

  it('names the platform', () => {
    expect(usagePlatform()).toBe('web');
    vi.stubGlobal('Capacitor', { isNativePlatform: () => true, getPlatform: () => 'ios' });
    expect(usagePlatform()).toBe('ios');
  });
});
