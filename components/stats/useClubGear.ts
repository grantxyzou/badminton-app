'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ClubGearEntry } from '@/lib/clubGear';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

export type ClubGearStatus = 'loading' | 'ready' | 'error' | 'forbidden';

export interface UseClubGear {
  entries: ClubGearEntry[];
  status: ClubGearStatus;
  retry: () => void;
}

/**
 * The "what the club plays" tally, read once per register.
 *
 * On the Set-up branch two surfaces read it — the club fact on a filled line
 * ("four others play it") and `ClubGearCard` below the card — and they must
 * be the SAME read, or the line and the tally can disagree about one racket
 * on one screen. `GearRegister` owns the instance; `ClubGearCard` keeps its
 * own fetch only on the flag-off branch, where it is the sole reader.
 */
export function useClubGear(enabled = true): UseClubGear {
  const [entries, setEntries] = useState<ClubGearEntry[]>([]);
  const [status, setStatus] = useState<ClubGearStatus>('loading');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    fetch(`${BASE}/api/stats/club/gear`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => {
        if (!live) return;
        setEntries((d?.entries ?? []) as ClubGearEntry[]);
        setStatus('ready');
      })
      .catch((e: Error) => live && setStatus(e?.message === '401' || e?.message === '403' ? 'forbidden' : 'error'));
    return () => {
      live = false;
    };
  }, [enabled, attempt]);

  const retry = useCallback(() => {
    setStatus('loading');
    setAttempt((n) => n + 1);
  }, []);

  return { entries, status, retry };
}
