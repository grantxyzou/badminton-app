'use client';

import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH || '';
const PING_MS = 15_000;

interface OnlineValue {
  online: boolean;
  /**
   * Call from a fetch `.catch` when a request fails for network reasons.
   * `navigator.onLine` lies (captive portal, server down) — a real failed
   * request is stronger evidence of "can't reach the server" than the
   * browser's optimistic flag, so it flips the signal immediately and
   * starts the reachability ping.
   */
  reportFetchFailure: () => void;
}

// Sane default: assume online. A connectivity hook must never itself be
// the reason a tree crashes when rendered outside the provider — and
// "assume reachable" is the correct optimistic default (the first real
// fetch failure corrects it).
const OnlineContext = createContext<OnlineValue>({
  online: true,
  reportFetchFailure: () => {},
});

export function OnlineProvider({ children }: { children: ReactNode }) {
  // Start `true` on both server and first client render so hydration
  // matches; correct from navigator.onLine in an effect post-hydration.
  const [online, setOnline] = useState(true);
  const pingTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPing = useCallback(() => {
    if (pingTimer.current !== null) {
      clearInterval(pingTimer.current);
      pingTimer.current = null;
    }
  }, []);

  /**
   * One reachability check. `/api/session` is small, always present, and
   * `force-dynamic` with a catch that still answers 200 — so `r.ok` is a
   * question about the NETWORK, not about Cosmos.
   */
  const probe = useCallback(() => {
    fetch(`${BASE}/api/session`, { method: 'GET', cache: 'no-store' })
      .then((r) => {
        if (r.ok) {
          setOnline(true);
          stopPing();
        }
      })
      .catch(() => {
        /* still unreachable — the interval keeps trying */
      });
  }, [stopPing]);

  const startPing = useCallback(() => {
    if (pingTimer.current !== null) return; // already pinging
    pingTimer.current = setInterval(probe, PING_MS);
  }, [probe]);

  const goOffline = useCallback(() => {
    setOnline(false);
    startPing();
    /**
     * PROBE NOW, not in 15 seconds.
     *
     * `setInterval` schedules its FIRST run at +15s, so a WiFi-to-cellular
     * handover — where the in-flight request dies at the instant the network
     * becomes healthy again — used to disable sign-up, self-cancel, kudos and
     * every admin action for a full 15 seconds over a working connection. The
     * handover case is the common one, and it is precisely the case where the
     * very next request would have succeeded.
     */
    probe();
  }, [startPing, probe]);

  const reportFetchFailure = useCallback(() => {
    goOffline();
  }, [goOffline]);

  useEffect(() => {
    // Post-hydration: trust the browser's initial value.
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      goOffline();
    }
    /**
     * VERIFY, do not assert.
     *
     * This used to `setOnline(true)` and CANCEL the ping outright. WKWebView
     * fires `online` on an interface that is up but not yet usable, so the one
     * active recovery mechanism was being destroyed by the event least
     * qualified to judge. Now the event only triggers a probe; the probe
     * decides, and the interval keeps running until it says yes.
     */
    const onOnline = () => probe();

    /**
     * Anything that means "the user is looking at the app again" is a reason
     * to re-check, and on iOS it is the ONLY reliable one: a backgrounded
     * WKWebView has its timers suspended, so the 15s interval does not run
     * while the phone is locked. Someone who flips network and pockets the
     * phone comes back to a stale "You're offline" that the interval alone
     * would take another 15s to clear.
     *
     * `bpm:resume` is already dispatched by NativeBridge on Capacitor's
     * appStateChange — this hook was the one place in the app not listening to
     * it. `focus` and `visibilitychange` cover the web and PWA equivalents.
     */
    const onWake = () => {
      if (pingTimer.current !== null) probe();
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') onWake();
    };

    window.addEventListener('online', onOnline);
    window.addEventListener('offline', goOffline);
    window.addEventListener('focus', onWake);
    window.addEventListener('bpm:resume', onWake);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', goOffline);
      window.removeEventListener('focus', onWake);
      window.removeEventListener('bpm:resume', onWake);
      document.removeEventListener('visibilitychange', onVisible);
      stopPing();
    };
  }, [goOffline, stopPing, probe]);

  return createElement(
    OnlineContext.Provider,
    { value: { online, reportFetchFailure } },
    children,
  );
}

/** `true` when the server is believed reachable. */
export function useOnline(): boolean {
  return useContext(OnlineContext).online;
}

/** Hand to fetch `.catch` blocks to nudge the signal offline on failure. */
export function useReportFetchFailure(): () => void {
  return useContext(OnlineContext).reportFetchFailure;
}
