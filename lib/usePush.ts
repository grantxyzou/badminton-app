'use client';

import { useCallback, useEffect, useState } from 'react';
import { isIOS, isStandalone } from './standalone';
import { hasVapidPublicKey, getVapidPublicKey, urlBase64ToUint8Array } from './push-client';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH || '';

export type UnsupportedReason =
  /** No service-worker support at all (ancient or locked-down browser). */
  | 'no-sw'
  /** Service workers exist but PushManager doesn't. */
  | 'no-push'
  /** iOS in a browser tab — push requires the home-screen PWA (iOS 16.4+). */
  | 'ios-not-installed'
  /** The build has no VAPID public key, so subscribe() would throw. */
  | 'not-configured';

export type PushState =
  /** Pre-mount / probing. Never render a confirmed negative from this state —
   *  "unknown" is not "no" (CLAUDE.md). */
  | { status: 'loading' }
  | { status: 'unsupported'; reason: UnsupportedReason }
  /** Permission was denied. requestPermission() resolves 'denied' immediately
   *  without prompting, so this is a dead end from JS — the user must change it
   *  in browser settings. */
  | { status: 'denied' }
  | { status: 'off' }
  | { status: 'on' };

export interface UsePushResult {
  state: PushState;
  enable: () => Promise<void>;
  disable: () => Promise<void>;
  busy: boolean;
  error: string | null;
}

/** Detection order matters — see the comments on each branch. */
function detectUnsupported(): UnsupportedReason | null {
  // Guards the "flag on but key missing" deploy: never offer a button that
  // provably cannot work.
  if (!hasVapidPublicKey()) return 'not-configured';
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return 'no-sw';

  // MUST precede the generic no-push branch. On iOS in a browser tab,
  // PushManager is simply absent; reporting that as "not supported" is a dead
  // end, when the truth is "install it and this works". Three signals must
  // agree because isStandalone() === false is documented as "unknown", not a
  // confirmed negative (lib/standalone.ts).
  if (isIOS() && !isStandalone() && !('PushManager' in window)) return 'ios-not-installed';

  if (typeof window === 'undefined' || !('PushManager' in window)) return 'no-push';
  if (typeof Notification === 'undefined') return 'no-push';
  return null;
}

export function usePush(): UsePushResult {
  const [state, setState] = useState<PushState>({ status: 'loading' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const probe = useCallback(async () => {
    const unsupported = detectUnsupported();
    if (unsupported) {
      setState({ status: 'unsupported', reason: unsupported });
      return;
    }
    if (Notification.permission === 'denied') {
      setState({ status: 'denied' });
      return;
    }
    try {
      // getRegistration (not register) — probing must not install a worker on
      // a device whose owner never opted in.
      const registration = await navigator.serviceWorker.getRegistration(`${BASE}/`);
      const sub = registration ? await registration.pushManager.getSubscription() : null;
      setState({ status: sub ? 'on' : 'off' });
    } catch {
      setState({ status: 'off' });
    }
  }, []);

  useEffect(() => {
    void probe();
  }, [probe]);

/**
 * Wait for THIS registration to have an active worker.
 *
 * NOT `navigator.serviceWorker.ready`, which is what used to be here and is why
 * "Turn on notifications" hung forever with no error. That promise resolves
 * when a worker controls THE CURRENT PAGE — and it never rejects, it just waits
 * indefinitely. The page never qualifies: `/bpm/` 308-redirects to `/bpm`, and
 * `/bpm` is not inside a `/bpm/` scope (prefix match, same trailing-slash trap
 * as the manifest scope and the OAuth landing).
 *
 * Push does not need page control at all — it needs an ACTIVE worker in the
 * registration we just made. `pushManager` lives on the registration, and
 * `notificationclick` opens a URL rather than touching the page. So wait for
 * the thing we actually depend on.
 *
 * Times out rather than hanging: a stuck install must surface as an error the
 * sheet can render, never as a spinner with no way out.
 */
async function activeWorker(reg: ServiceWorkerRegistration, timeoutMs = 10_000): Promise<void> {
  if (reg.active) return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('sw_activation_timeout')), timeoutMs);
    const check = () => {
      if (reg.active) {
        clearTimeout(timer);
        resolve();
      }
    };
    // `installing` and `waiting` are the two states an activation passes
    // through; either can be the one present when we arrive.
    for (const worker of [reg.installing, reg.waiting]) {
      worker?.addEventListener('statechange', check);
    }
    reg.addEventListener('updatefound', () => {
      reg.installing?.addEventListener('statechange', check);
    });
    check();
  });
}

  const enable = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      // Registration is lazy and gesture-driven: a user who never opts in ends
      // up with no service worker on their device at all.
      const registration = await navigator.serviceWorker.register(`${BASE}/sw.js`, {
        scope: `${BASE}/`,
        updateViaCache: 'none',
      });
      await activeWorker(registration);

      const permission = await Notification.requestPermission();
      if (permission === 'denied') {
        setState({ status: 'denied' });
        return;
      }
      if (permission !== 'granted') {
        setState({ status: 'off' });
        return;
      }

      const existing = await registration.pushManager.getSubscription();
      const sub =
        existing ??
        (await registration.pushManager.subscribe({
          // Mandatory — Chrome rejects a subscription without it.
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(getVapidPublicKey()),
        }));

      const res = await fetch(`${BASE}/api/push/subscribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sub.toJSON()),
        cache: 'no-store',
      });

      if (!res.ok) {
        // Roll the browser back so client and server can't disagree about who
        // is subscribed — otherwise the user sees "On" and never gets a push.
        try {
          await sub.unsubscribe();
        } catch {
          /* best effort */
        }
        setState({ status: 'off' });
        setError(res.status === 401 ? 'auth' : 'save');
        return;
      }

      setState({ status: 'on' });
    } catch (err) {
      console.error('[push] enable failed:', err);
      setError('generic');
      setState({ status: 'off' });
    } finally {
      setBusy(false);
    }
  }, []);

  const disable = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      const registration = await navigator.serviceWorker.getRegistration(`${BASE}/`);
      const sub = registration ? await registration.pushManager.getSubscription() : null;

      // Server first: if the browser unsubscribed first and the DELETE failed,
      // the server would keep pushing to a dead endpoint until a 410 cleaned it up.
      if (sub) {
        await fetch(`${BASE}/api/push/subscribe`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: sub.endpoint }),
          cache: 'no-store',
        }).catch(() => undefined);
        await sub.unsubscribe().catch(() => undefined);
      }

      // Nothing left to receive — remove the worker so opting out actually
      // removes it rather than leaving a dormant one behind.
      if (registration) {
        const remaining = await registration.pushManager.getSubscription();
        if (!remaining) await registration.unregister().catch(() => undefined);
      }

      setState({ status: 'off' });
    } catch (err) {
      console.error('[push] disable failed:', err);
      setError('generic');
    } finally {
      setBusy(false);
    }
  }, []);

  return { state, enable, disable, busy, error };
}
