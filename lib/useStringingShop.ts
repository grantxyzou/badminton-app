'use client';

import { useCallback, useEffect, useState } from 'react';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

export interface StringingShop {
  /** `true` / `false` from the shop doc, `null` until a read has answered. */
  open: boolean | null;
  /**
   * `loading` until the first answer, `error` when the read failed or was
   * throttled. These used to be one state — `null` — and the card rendered
   * "Coming soon" for both, so a shop that could not be READ said it was
   * closed: the lying empty state, and the label stayed after a failure.
   */
  status: 'loading' | 'ready' | 'error';
  retry: () => void;
}

/**
 * Is the stringing shop open?
 *
 * Callers still render the MODEST thing whenever `open !== true` — a door into
 * the request sheet never appears on a guess, because tapping it would 409.
 * What changed is what the card SAYS while it does not know: a skeleton while
 * loading, an error with Retry when the read failed, "Coming soon" only for a
 * shop the server says is closed.
 */
export function useStringingShop(): StringingShop {
  const [open, setOpen] = useState<boolean | null>(null);
  const [status, setStatus] = useState<StringingShop['status']>('loading');
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => {
    setStatus('loading');
    setAttempt((n) => n + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch(`${BASE}/api/stringing/shop`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => {
        if (cancelled) return;
        if (d && typeof d.open === 'boolean') {
          setOpen(d.open);
          setStatus('ready');
        } else {
          setStatus('error');
        }
      })
      .catch(() => {
        if (!cancelled) setStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  return { open, status, retry };
}
