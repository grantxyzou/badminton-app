'use client';

import { useCallback, useEffect, useState } from 'react';
import { BALANCE_EVENT } from '@/lib/balanceRefresh';
import { sharedFetch } from '@/lib/sharedRead';
import { unpaidPath } from '@/components/UnpaidSessionsCard';

/** One owed session line, as `GET /api/players/unpaid` sends it. */
export interface OwedSessionLine {
  sessionId: string;
  playerId?: string;
  guestName?: string;
  /** ISO — the session's own date. */
  date: string;
  owedAmount: number;
  settled?: boolean;
  settledAt?: string | null;
  selfReported?: boolean;
}

/** One finished, priced racket. */
export interface OwedStringingLine {
  jobId: string;
  jobNo: string;
  racketLabel: string;
  amount: number;
  /** ISO — when it was finished. */
  at: string;
}

export interface BalanceData {
  totalOwed: number;
  sessions: OwedSessionLine[];
  stringing?: OwedStringingLine[];
  payTo?: { name: string; email: string } | null;
}

export interface UseBalance {
  /** `null` while unknown: loading, signed out, or after a failed read. */
  data: BalanceData | null;
  loadError: boolean;
  /** The member cookie lapsed: not a failure, and no retry fixes it. */
  forbidden: boolean;
  reload: () => void;
}

/**
 * What this member owes (spec §4), from the SAME read as Home's balance card
 * (`GET /api/players/unpaid`, through `sharedFetch`), so Profile's row, the
 * Account balance page and Home cannot disagree about money. Re-reads on
 * `BALANCE_EVENT` (a payment with credit, an accepted stringing price).
 */
export function useBalance(name: string | null): UseBalance {
  const [data, setData] = useState<BalanceData | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!name) {
      setData(null);
      setLoadError(false);
      setForbidden(false);
      return;
    }
    let live = true;
    sharedFetch(unpaidPath(name))
      .then(async (r) => {
        if (!live) return;
        if (r.status === 403) {
          setForbidden(true);
          setLoadError(false);
          setData(null);
          return;
        }
        if (!r.ok) throw new Error(String(r.status));
        const body = (await r.json()) as BalanceData;
        if (!live) return;
        setData(body);
        setForbidden(false);
        setLoadError(false);
      })
      .catch(() => {
        if (live) setLoadError(true);
      });
    return () => {
      live = false;
    };
  }, [name, nonce]);

  useEffect(() => {
    if (!name) return;
    window.addEventListener(BALANCE_EVENT, reload);
    return () => window.removeEventListener(BALANCE_EVENT, reload);
  }, [name, reload]);

  return { data, loadError, forbidden, reload };
}

/**
 * What "Pay with credit" would pay, in cents: the same walk the server makes
 * (`payWithCredit` in lib/storeCredit.ts) — FROZEN lines only (a settled
 * session or a finished racket), oldest first, each paid in full or skipped.
 * Zero means the button has nothing to offer.
 */
export function creditWouldPay(data: Pick<BalanceData, 'sessions' | 'stringing'>, creditCents: number): number {
  const lines = [
    ...data.sessions.filter((s) => s.settled).map((s) => ({ at: s.date, cents: Math.round(s.owedAmount * 100) })),
    ...(data.stringing ?? []).map((j) => ({ at: j.at, cents: Math.round(j.amount * 100) })),
  ].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  let left = creditCents;
  let paid = 0;
  for (const line of lines) {
    if (line.cents <= 0 || line.cents > left) continue;
    left -= line.cents;
    paid += line.cents;
  }
  return paid;
}
