'use client';
import { useEffect, useRef } from 'react';
import { isNative } from '@/lib/native';
import { closeTopSheet } from '@/lib/sheetStack';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
const HOST = 'bpm.grantzou.com';

interface Props {
  activeTab: string;
  onGoHome: () => void;
}

type Removable = { remove: () => Promise<void> | void };

/**
 * The glue between the Capacitor shell and the web app. Renders nothing.
 *
 * Everything in here is inside `if (!isNative()) return`, and every plugin
 * is a dynamic import, so on the web this component is a no-op with no
 * bundle cost. What it wires:
 *
 *  - `appUrlOpen`: the custom scheme (`bpm://auth/return` from the OAuth
 *    landing, `bpm://migrate?c=` from the PWA's sheet) and the universal link
 *    (`https://bpm.grantzou.com/bpm/migrate?c=`).
 *  - `bpm:resume`: dispatched when the browser sheet closes, the app returns
 *    to the foreground, or a URL opens — HomeShell's handoff claim listens
 *    for it, because a modal sheet inside the app fires neither
 *    visibilitychange nor focus on this document.
 *  - The Android back button (policy below).
 *  - Status bar style following `data-theme`.
 *  - A push notification tap → navigate, only to our own path.
 */
export default function NativeBridge({ activeTab, onGoHome }: Props) {
  // Refs, so the listeners registered once can read the latest values.
  const tabRef = useRef(activeTab);
  tabRef.current = activeTab;
  const goHomeRef = useRef(onGoHome);
  goHomeRef.current = onGoHome;

  useEffect(() => {
    if (!isNative()) return;
    let disposed = false;
    const handles: Removable[] = [];
    const resume = () => window.dispatchEvent(new Event('bpm:resume'));

    void (async () => {
      // Loaded INDEPENDENTLY, and that is the entire point of allSettled
      // here. `Promise.all` rejects as a unit, so ONE plugin the installed
      // binary predates used to take out `appUrlOpen` (the bpm://auth/return
      // leg of OAuth), app-state resume AND the Android back button together
      // — the three things a store reviewer taps first.
      //
      // Not hypothetical: the shell loads the LIVE web bundle (`server.url`),
      // so the JS on a phone is always as new as the last deploy while the
      // binary is as old as the last store release. Any deploy can name a
      // plugin that phone has never heard of. Degrading ONE capability is
      // normal operation here, not an exception.
      const [appMod, browserMod, barMod] = await Promise.allSettled([
        import('@capacitor/app'),
        import('@capacitor/browser'),
        import('@capacitor/status-bar'),
      ]);
      if (disposed) return;

      const App = appMod.status === 'fulfilled' ? appMod.value.App : null;
      const Browser = browserMod.status === 'fulfilled' ? browserMod.value.Browser : null;
      const bar = barMod.status === 'fulfilled' ? barMod.value : null;
      if (!App || !Browser || !bar) {
        // Surface, never swallow — the AdminErrorBoundary posture. There is no
        // telemetry sink, and nothing the user sees depends on this line.
        console.error('[NativeBridge] plugin unavailable:', {
          app: appMod.status,
          browser: browserMod.status,
          statusBar: barMod.status,
        });
      }

      if (App) {
        handles.push(
          await App.addListener('appUrlOpen', ({ url }) => {
            let u: URL;
            try {
              u = new URL(url);
            } catch {
              return;
            }
            if (u.protocol === 'bpm:') {
              // `bpm://auth/return` — the OAuth landing's way home. Close the
              // browser sheet and let the claim run.
              if (u.host === 'auth') {
                void Browser?.close().catch(() => undefined);
                resume();
                return;
              }
              // `bpm://migrate?c=…` — from the PWA's "Move to the app" sheet.
              if (u.host === 'migrate') {
                const c = u.searchParams.get('c');
                if (c) window.location.assign(`${BASE}/migrate?c=${encodeURIComponent(c)}`);
                return;
              }
              return;
            }
            // Universal / App Link. Only our host and only the migrate path —
            // a link to anything else is not an instruction.
            if (u.host === HOST && u.pathname === `${BASE}/migrate`) {
              window.location.assign(`${BASE}/migrate${u.search}`);
              resume();
            }
          }),
        );
      }

      if (App) {
        handles.push(
          await App.addListener('appStateChange', ({ isActive }) => {
            if (isActive) resume();
          }),
        );
      }
      if (Browser) handles.push(await Browser.addListener('browserFinished', resume));

      /* THE BACK-BUTTON POLICY (Android). Reviewers test it; a surprise exit
         reads as a crash. In order:
           1. an open sheet closes;
           2. any tab other than Home goes Home (the tab is not in the URL, so
              history cannot do this for us);
           3. real history goes back;
           4. from Home with nothing to go back to, the app exits.
         Proposed default — the alternative is exiting immediately from Home.
         Grant's call; change step 2 if it feels wrong on a Pixel. */
      if (App) {
        handles.push(
          await App.addListener('backButton', ({ canGoBack }) => {
            if (closeTopSheet()) return;
            if (tabRef.current !== 'home') {
              goHomeRef.current();
              return;
            }
            if (canGoBack) {
              window.history.back();
              return;
            }
            void App.exitApp();
          }),
        );
      }

      // The page draws under the status bar (env(safe-area-inset-top)); the
      // bar's glyphs follow the theme. Capacitor's Style.Dark = light glyphs
      // for a dark background.
      // Losing this plugin costs cosmetics only — the safe-area padding is
      // CSS and holds without it.
      if (bar) {
        const { StatusBar, Style } = bar;
        const applyStyle = () => {
          const light = document.documentElement.dataset.theme === 'light';
          void StatusBar.setStyle({ style: light ? Style.Light : Style.Dark }).catch(() => undefined);
        };
        await StatusBar.setOverlaysWebView({ overlay: true }).catch(() => undefined);
        applyStyle();
        const observer = new MutationObserver(applyStyle);
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
        handles.push({ remove: () => observer.disconnect() });
      }

      // A tapped push: the payload's `url` is the same field the web SW
      // receives, and gets the same guard — our basePath or nothing.
      try {
        const { FirebaseMessaging } = await import('@capacitor-firebase/messaging');
        handles.push(
          await FirebaseMessaging.addListener('notificationActionPerformed', (event) => {
            const url = (event.notification.data as { url?: unknown } | undefined)?.url;
            if (typeof url === 'string' && url.startsWith(`${BASE}/`)) window.location.assign(url);
          }),
        );
      } catch {
        /* messaging plugin absent in this build — nothing to route */
      }
    })();

    return () => {
      disposed = true;
      for (const h of handles) void h.remove();
    };
  }, []);

  return null;
}
