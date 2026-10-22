'use client';

import { useEffect } from 'react';
import { hasNativePlugin, isNative } from './native';

/**
 * The app's half of the home-screen widget (docs/plans/native-widgets.md).
 *
 * The widget runs outside the WebView and has no cookies, so the app — while
 * signed in — mints the widget's own pass (`POST /api/widget/token`) and hands
 * it to the native `BpmWidget` plugin, which keeps it where the widget can
 * read it (the iOS App Group, Android's private preferences). From then on the
 * widget reads `GET /api/widget` itself.
 *
 * Store app only, and only on a binary that has the plugin: the deploy that
 * ships this runs on the current store build too, which answers
 * `hasNativePlugin('BpmWidget') === false`, and then nothing here runs. The
 * plugin is registered through a dynamic `@capacitor/core` import inside the
 * `isNative()` branch (`__tests__/native-imports.test.ts`).
 */

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/** When this device last handed the widget a pass. Re-minted daily on open:
 *  the pass lasts sixty days, so a phone opened even once a month never lets
 *  it lapse. */
export const WIDGET_MINTED_KEY = 'bpm_widget_minted_at';
const REMINT_MS = 24 * 60 * 60 * 1000;

interface BpmWidgetPlugin {
  setSession(opts: { token: string; expiresAt: string; baseUrl: string }): Promise<void>;
  clear(): Promise<void>;
  reload(): Promise<void>;
}

let plugin: Promise<BpmWidgetPlugin> | null = null;

function widgetAvailable(): boolean {
  return isNative() && hasNativePlugin('BpmWidget') !== false;
}

function bpmWidget(): Promise<BpmWidgetPlugin> {
  if (!plugin) {
    plugin = import('@capacitor/core').then(({ registerPlugin }) => registerPlugin<BpmWidgetPlugin>('BpmWidget'));
  }
  return plugin;
}

function mintedAt(): number {
  try {
    return Number(localStorage.getItem(WIDGET_MINTED_KEY)) || 0;
  } catch {
    return 0;
  }
}

/**
 * Hand the widget a fresh pass when the last one is a day old (or `force`).
 * Never throws: a widget that keeps its older pass, or says "Open BPM", is
 * the worst outcome, and nothing on screen depends on it.
 */
export async function syncWidgetPass(force = false): Promise<void> {
  if (!widgetAvailable()) return;
  if (!force && Date.now() - mintedAt() < REMINT_MS) return;
  try {
    const res = await fetch(`${BASE}/api/widget/token`, { method: 'POST', cache: 'no-store' });
    if (!res.ok) return;
    const { token, expiresAt } = (await res.json()) as { token?: string; expiresAt?: string };
    if (typeof token !== 'string' || typeof expiresAt !== 'string') return;
    await (await bpmWidget()).setSession({ token, expiresAt, baseUrl: `${window.location.origin}${BASE}` });
    try {
      localStorage.setItem(WIDGET_MINTED_KEY, String(Date.now()));
    } catch {
      /* re-mints next open */
    }
  } catch {
    /* an older binary or no network: the widget keeps what it has */
  }
}

/** Ask the widget to redraw — whatever the person just did in the app shows. */
export async function reloadWidgets(): Promise<void> {
  if (!widgetAvailable()) return;
  try {
    await (await bpmWidget()).reload();
  } catch {
    /* nothing to reload */
  }
}

/** Signing out: a shared phone must not keep the last person's week on its
 *  home screen. The widget then shows "Open BPM and sign in". */
export async function clearWidgets(): Promise<void> {
  try {
    localStorage.removeItem(WIDGET_MINTED_KEY);
  } catch {
    /* nothing stored */
  }
  if (!widgetAvailable()) return;
  try {
    await (await bpmWidget()).clear();
  } catch {
    /* nothing to clear */
  }
}

/** The tabs a widget tap may open. Anything else in the link is ignored. */
const WIDGET_TABS = new Set(['home', 'skills', 'stringing', 'profile']);

/**
 * Where a widget tap lands: `bpm://open?tab=skills` → `/bpm/?tab=skills`. The
 * widget names a TAB, never a path, so a link it carries cannot send the app
 * anywhere but its own tabs. `null` for anything that is not a widget link.
 */
export function widgetOpenTarget(url: URL): string | null {
  if (url.protocol !== 'bpm:' || url.host !== 'open') return null;
  const tab = url.searchParams.get('tab');
  if (!tab || tab === 'home' || !WIDGET_TABS.has(tab)) return `${BASE}/`;
  return `${BASE}/?tab=${tab}`;
}

/**
 * Mounted once, in HomeShell, for a signed-in member: hand the widget its pass
 * on open and on return, and ask it to redraw whenever the app goes to the
 * background — a sign-up, a payment or a check-in made in the app is on the
 * home screen by the time the person gets there.
 */
export function useWidgetBridge(signedIn: boolean): void {
  useEffect(() => {
    if (!signedIn || !widgetAvailable()) return;
    void syncWidgetPass();
    const onResume = () => void syncWidgetPass();
    const onHide = () => {
      if (document.visibilityState === 'hidden') void reloadWidgets();
    };
    window.addEventListener('bpm:resume', onResume);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      window.removeEventListener('bpm:resume', onResume);
      document.removeEventListener('visibilitychange', onHide);
    };
  }, [signedIn]);
}
