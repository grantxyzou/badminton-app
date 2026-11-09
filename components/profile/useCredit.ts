'use client';

import { useCallback, useEffect, useState } from 'react';
import { BALANCE_EVENT } from '@/lib/balanceRefresh';
import { sharedFetch } from '@/lib/sharedRead';

/** One line of the member's credit history, as `GET /api/credit` sends it. */
export interface CreditEntry {
  id: string;
  kind: string;
  amountCents: number;
  note: string;
  createdAt: string;
}

export interface UseCredit {
  /** `null` while unknown: loading, switched off, or after a failed read. */
  balanceCents: number | null;
  entries: CreditEntry[] | null;
  loadError: boolean;
  reload: () => void;
}

/**
 * The member's store credit in this club (docs/plans/payments.md), read once
 * by Profile and handed to the Gift cards & credit page, so the row's figure
 * and the page's cannot disagree (the same arrangement as `useSignInMethods`).
 *
 * Re-reads on `BALANCE_EVENT`: paying a session with credit on Home, or a
 * redeem on the page, changes it while Profile is kept mounted behind.
 * A failed read is `loadError`, never a $0 (the lying-empty-state rule).
 */
export function useCredit(enabled: boolean): UseCredit {
  const [balanceCents, setBalance] = useState<number | null>(null);
  const [entries, setEntries] = useState<CreditEntry[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!enabled) {
      setBalance(null);
      setEntries(null);
      setLoadError(false);
      return;
    }
    let live = true;
    sharedFetch('/api/credit')
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json() as Promise<{ balanceCents: number; entries: CreditEntry[] }>;
      })
      .then((d) => {
        if (!live) return;
        setBalance(d.balanceCents);
        setEntries(d.entries ?? []);
        setLoadError(false);
      })
      .catch(() => {
        if (live) setLoadError(true);
      });
    return () => {
      live = false;
    };
  }, [enabled, nonce]);

  useEffect(() => {
    if (!enabled) return;
    window.addEventListener(BALANCE_EVENT, reload);
    return () => window.removeEventListener(BALANCE_EVENT, reload);
  }, [enabled, reload]);

  return { balanceCents, entries, loadError, reload };
}
