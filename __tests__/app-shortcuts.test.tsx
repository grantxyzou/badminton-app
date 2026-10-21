// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, waitFor, act } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import enMessages from '../messages/en.json';

/**
 * The store app's long-press menu (docs/plans/native-badge-shortcuts.md):
 * the three items, the live line under each, where a tap goes, and that
 * nothing happens outside the store app.
 */

const shortcuts = vi.hoisted(() => ({ set: vi.fn(), clear: vi.fn() }));
vi.mock('@capawesome/capacitor-app-shortcuts', () => ({ AppShortcuts: shortcuts }));

import { openShortcut, useAppShortcuts, noteOwedForShortcuts, clearAppShortcuts, setAppShortcuts } from '@/lib/appShortcuts';
import { takeStringingIntent } from '@/lib/stringingIntent';
import { resetSharedReads } from '@/lib/sharedRead';

function nativeShell() {
  (window as unknown as { Capacitor?: unknown }).Capacitor = {
    isNativePlatform: () => true,
    getPlatform: () => 'ios',
    isPluginAvailable: () => true,
  };
}

function Probe() {
  useAppShortcuts();
  return null;
}

const SESSION = { id: 'session-2026-10-22', datetime: '2026-10-22T19:00:00-07:00', signupOpen: true };

beforeEach(async () => {
  shortcuts.set.mockReset().mockResolvedValue(undefined);
  shortcuts.clear.mockReset().mockResolvedValue(undefined);
  resetSharedReads();
  await clearAppShortcuts();
  shortcuts.clear.mockReset().mockResolvedValue(undefined);
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(SESSION), { status: 200 })));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  delete (window as unknown as { Capacitor?: unknown }).Capacitor;
  sessionStorage.clear();
});

describe('openShortcut', () => {
  it('sends sign-up and balance to Home, and stringing to the request form', () => {
    expect(openShortcut('signup')).toMatch(/\/$/);
    expect(openShortcut('owed')).toMatch(/\/$/);
    expect(openShortcut('stringing')).toMatch(/\/\?tab=stringing$/);
    expect(takeStringingIntent()).toBe('open');
  });

  it('ignores an id that is not ours', () => {
    expect(openShortcut('compose')).toBeNull();
  });
});

describe('useAppShortcuts', () => {
  it('builds the three items with the session day and the amount owed', async () => {
    nativeShell();
    render(
      <NextIntlClientProvider locale="en" messages={enMessages} timeZone="America/Vancouver">
        <Probe />
      </NextIntlClientProvider>,
    );
    await waitFor(() => expect(shortcuts.set).toHaveBeenCalled());
    act(() => noteOwedForShortcuts(18.5));
    await waitFor(() => {
      const last = shortcuts.set.mock.calls.at(-1)![0].shortcuts;
      expect(last.map((s: { id: string }) => s.id)).toEqual(['signup', 'owed', 'stringing']);
      expect(last[0].title).toBe('Sign up for Thursday');
      expect(last[1].description).toBe('$18.50 owed');
      expect(last[2].title).toBe('Request stringing');
      // iOS needs an icon whenever a line sits under the title.
      expect(last.every((s: { iosIcon?: string }) => !!s.iosIcon)).toBe(true);
    });
  });

  it('says so when there is no session this week', async () => {
    nativeShell();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'no_active_session' }), { status: 404 })));
    render(
      <NextIntlClientProvider locale="en" messages={enMessages} timeZone="America/Vancouver">
        <Probe />
      </NextIntlClientProvider>,
    );
    await waitFor(() => expect(shortcuts.set).toHaveBeenCalled());
    const first = shortcuts.set.mock.calls.at(-1)![0].shortcuts;
    expect(first[0].title).toBe("This week's session");
    expect(first[0].description).toBe('No session this week');
  });

  it('does nothing outside the store app', async () => {
    render(
      <NextIntlClientProvider locale="en" messages={enMessages} timeZone="America/Vancouver">
        <Probe />
      </NextIntlClientProvider>,
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(fetch).not.toHaveBeenCalled();
    expect(shortcuts.set).not.toHaveBeenCalled();
  });
});

describe('setAppShortcuts and clearAppShortcuts', () => {
  it('skips a menu identical to the one already set, and clears on sign-out', async () => {
    nativeShell();
    const menu = [{ id: 'stringing' as const, title: 'Request stringing', description: 'Book your next restring', iosIcon: 'wrench.and.screwdriver' }];
    await setAppShortcuts(menu);
    await setAppShortcuts(menu);
    expect(shortcuts.set).toHaveBeenCalledTimes(1);
    await clearAppShortcuts();
    expect(shortcuts.clear).toHaveBeenCalledTimes(1);
  });
});
