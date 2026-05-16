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

  const startPing = useCallback(() => {
    if (pingTimer.current !== null) return; // already pinging
    pingTimer.current = setInterval(() => {
      // Cheap reachability check. /api/session is small and always
      // present; we only care whether the round-trip succeeds at all.
      fetch(`${BASE}/api/session`, { method: 'GET', cache: 'no-store' })
        .then((r) => {
          if (r.ok) {
            setOnline(true);
            stopPing();
          }
        })
        .catch(() => {
          /* still unreachable — keep pinging */
        });
    }, PING_MS);
  }, [stopPing]);

  const goOffline = useCallback(() => {
    setOnline(false);
    startPing();
  }, [startPing]);

  const reportFetchFailure = useCallback(() => {
    goOffline();
  }, [goOffline]);

  useEffect(() => {
    // Post-hydration: trust the browser's initial value.
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      goOffline();
    }
    const onOnline = () => {
      setOnline(true);
      stopPing();
    };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', goOffline);
      stopPing();
    };
  }, [goOffline, stopPing]);

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
