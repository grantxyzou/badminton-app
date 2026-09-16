'use client';

import { useEffect, useRef } from 'react';

/**
 * Follow a link to a place INSIDE the app without reloading it.
 *
 * The app is one page (`app/page.tsx`) whose tabs are React state, not URLs. A
 * notification that says "sign-ups are open" carries `/bpm/`, and an access
 * request carries `/bpm/?tab=admin`. Both used to be followed with
 * `window.location.assign`, which tears the document down: in the native shell
 * that replays the whole launch — splash, network round trip, hydration —
 * INSIDE an app that was already open, which is the loudest "this is a web
 * page" moment in normal use. And the web service worker only focused the
 * open window, so there a tap went nowhere at all.
 *
 * `routeInApp(url)` answers whether a URL is a place in the SPA. If it is, it
 * dispatches `NAVIGATE_EVENT` with the tab (or null for Home) and returns true;
 * `HomeShell` switches to that tab and refetches it. Anything else — another
 * route such as `/migrate` or `/legal/*`, another origin, garbage — returns
 * false, and the caller does what it always did. Nothing here decides what a
 * member may SEE: an admin tab asked for by a non-admin still meets HomeShell's
 * own gate, exactly as a `?tab=admin` landing does.
 */

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

export const NAVIGATE_EVENT = 'bpm:navigate';
/** The service worker's message type for the same thing (public/sw.js). */
export const SW_NAVIGATE_MESSAGE = 'bpm:navigate';

export interface NavigateDetail {
  /** The `?tab=` value, unvalidated (HomeShell validates), or null for Home. */
  tab: string | null;
}

export function routeInApp(url: string): boolean {
  if (typeof window === 'undefined') return false;
  let u: URL;
  try {
    u = new URL(url, window.location.origin);
  } catch {
    return false;
  }
  if (u.origin !== window.location.origin) return false;
  // The SPA root, with or without its trailing slash. Every other path is a
  // separate route that has to be loaded as one.
  if (u.pathname !== `${BASE}/` && u.pathname !== BASE) return false;
  window.dispatchEvent(new CustomEvent<NavigateDetail>(NAVIGATE_EVENT, { detail: { tab: u.searchParams.get('tab') } }));
  return true;
}

/**
 * Subscribe to in-app navigation from both sources: `routeInApp` on this page
 * (the native bridge) and a message from the service worker (a web push tap
 * on a window that was already open).
 */
export function useInAppNavigation(onNavigate: (detail: NavigateDetail) => void): void {
  const ref = useRef(onNavigate);
  useEffect(() => {
    ref.current = onNavigate;
  }, [onNavigate]);

  useEffect(() => {
    const onEvent = (e: Event) => ref.current((e as CustomEvent<NavigateDetail>).detail ?? { tab: null });
    const onMessage = (e: MessageEvent) => {
      const data = e.data as { type?: unknown; url?: unknown } | null;
      if (data?.type === SW_NAVIGATE_MESSAGE && typeof data.url === 'string') routeInApp(data.url);
    };
    window.addEventListener(NAVIGATE_EVENT, onEvent);
    const sw = typeof navigator !== 'undefined' ? navigator.serviceWorker : undefined;
    sw?.addEventListener('message', onMessage);
    return () => {
      window.removeEventListener(NAVIGATE_EVENT, onEvent);
      sw?.removeEventListener('message', onMessage);
    };
  }, []);
}
