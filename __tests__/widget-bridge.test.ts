// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * The app's half of the widget (docs/plans/native-widgets.md): it hands the
 * widget a pass at most once a day, never on a web page or an older binary,
 * and clears it on sign-out.
 */

const widget = vi.hoisted(() => ({ setSession: vi.fn(), clear: vi.fn(), reload: vi.fn() }));
// Shaped like Capacitor's real proxy: EVERY property is a native method, `then`
// included, and an unknown one throws "not implemented". A plain object here
// is what let a promise resolved with the proxy drop every call unnoticed.
vi.mock('@capacitor/core', () => ({
  registerPlugin: () =>
    new Proxy({}, {
      get(_t, prop) {
        if (prop in widget) return widget[prop as keyof typeof widget];
        return () => {
          throw new Error(`"BpmWidget.${String(prop)}()" is not implemented on ios`);
        };
      },
    }),
}));

import { syncWidgetPass, clearWidgets, reloadWidgets, widgetOpenTarget, WIDGET_MINTED_KEY } from '@/lib/widgetBridge';

function nativeShell(pluginAvailable = true) {
  (window as unknown as { Capacitor?: unknown }).Capacitor = {
    isNativePlatform: () => true,
    getPlatform: () => 'ios',
    isPluginAvailable: () => pluginAvailable,
  };
}

const fetchMock = vi.fn();

beforeEach(() => {
  for (const f of Object.values(widget)) f.mockReset();
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ token: 't.sig', expiresAt: '2026-12-21T00:00:00Z' }), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  localStorage.clear();
});
afterEach(() => {
  delete (window as unknown as { Capacitor?: unknown }).Capacitor;
  vi.unstubAllGlobals();
});

describe('syncWidgetPass', () => {
  it('mints a pass and hands it to the widget with the app’s own address', async () => {
    nativeShell();
    await syncWidgetPass();
    expect(fetchMock).toHaveBeenCalledWith(expect.stringMatching(/\/api\/widget\/token$/), expect.objectContaining({ method: 'POST' }));
    expect(widget.setSession).toHaveBeenCalledWith({
      token: 't.sig',
      expiresAt: '2026-12-21T00:00:00Z',
      baseUrl: expect.stringMatching(/^http/),
    });
    expect(Number(localStorage.getItem(WIDGET_MINTED_KEY))).toBeGreaterThan(0);
  });

  it('does not re-mint within a day, unless forced', async () => {
    nativeShell();
    localStorage.setItem(WIDGET_MINTED_KEY, String(Date.now() - 60_000));
    await syncWidgetPass();
    expect(fetchMock).not.toHaveBeenCalled();
    await syncWidgetPass(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does nothing on a web page or on a binary without the plugin', async () => {
    await syncWidgetPass(true);
    nativeShell(false);
    await syncWidgetPass(true);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(widget.setSession).not.toHaveBeenCalled();
  });

  it('keeps the old pass when the mint is refused', async () => {
    nativeShell();
    fetchMock.mockResolvedValue(new Response('{}', { status: 401 }));
    await syncWidgetPass(true);
    expect(widget.setSession).not.toHaveBeenCalled();
    expect(localStorage.getItem(WIDGET_MINTED_KEY)).toBeNull();
  });

  it('never throws', async () => {
    nativeShell();
    widget.setSession.mockRejectedValue(new Error('UNIMPLEMENTED'));
    await expect(syncWidgetPass(true)).resolves.toBeUndefined();
  });
});

describe('clearWidgets and reloadWidgets', () => {
  it('sign-out clears the widget and forgets the mint, so the next person gets a fresh pass', async () => {
    nativeShell();
    localStorage.setItem(WIDGET_MINTED_KEY, String(Date.now()));
    await clearWidgets();
    expect(widget.clear).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(WIDGET_MINTED_KEY)).toBeNull();
  });

  it('reload is a no-op off the store app', async () => {
    await reloadWidgets();
    expect(widget.reload).not.toHaveBeenCalled();
    nativeShell();
    await reloadWidgets();
    expect(widget.reload).toHaveBeenCalledTimes(1);
  });
});

describe('widgetOpenTarget', () => {
  it('opens a tab the widget names, and only a tab', () => {
    expect(widgetOpenTarget(new URL('bpm://open?tab=skills'))).toMatch(/\/\?tab=skills$/);
    expect(widgetOpenTarget(new URL('bpm://open?tab=home'))).toMatch(/\/$/);
    // An unknown tab, or a path smuggled in, lands on Home — never elsewhere.
    expect(widgetOpenTarget(new URL('bpm://open?tab=admin'))).toMatch(/\/$/);
    expect(widgetOpenTarget(new URL('bpm://open?tab=../legal'))).toMatch(/\/$/);
  });

  it('is not a widget link otherwise', () => {
    expect(widgetOpenTarget(new URL('bpm://auth/return?c=x'))).toBeNull();
    expect(widgetOpenTarget(new URL('https://bpm.grantzou.com/bpm/?tab=skills'))).toBeNull();
  });
});
