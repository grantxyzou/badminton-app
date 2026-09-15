'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { FitFacts } from '@/lib/fitVerdict';
import type { FitVerdictCopy } from '@/lib/fitVerdictCopy';
import type { PlayerGear } from '@/lib/types';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/** Answers settle before the verdict is re-asked: a member tapping through the
 *  page is one read, not one per tap. */
export const VERDICT_DEBOUNCE_MS = 400;

export interface FitVerdictData {
  facts: FitFacts;
  copy: FitVerdictCopy | null;
  checkInLevel: number | null;
}

export interface UseFitVerdict {
  data: FitVerdictData | null;
  /** The first read failed and there is nothing to keep showing. */
  error: boolean;
  /** A 403: this device is not signed in as the member. Retrying will not help. */
  forbidden: boolean;
  retry: () => void;
}

/** Everything on the gear doc the verdict reads. A change to anything else in
 *  the bag (a spare, a note) does not re-ask. */
function signature(gear: PlayerGear | null): string {
  if (!gear) return 'none';
  const active = gear.items.find((i) => i.id === gear.activeRacketId) ?? gear.items.find((i) => i.category === 'racket');
  const strings = gear.items.filter((i) => i.category === 'string' && !i.retiredAt);
  const newest = strings[strings.length - 1];
  return JSON.stringify([
    active?.id, active?.catalogId, active?.feel, newest?.catalogId, newest?.tensionLbs,
    gear.fitLevelOverride, gear.fitPlayStyle, gear.fitSwing, gear.fitGrip, gear.fitSoreness, gear.fitGoal,
    gear.fitArmComfort, gear.playFormat,
  ]);
}

/**
 * The fit page's verdict. KEEPS THE PREVIOUS VERDICT while a new one is being
 * asked for — the design's rule is no spinner on the verdict, so a recompute
 * in flight shows the last answer, not a skeleton. Only the very first read
 * has nothing to show.
 */
export function useFitVerdict(name: string | null, gear: PlayerGear | null, ready: boolean, frame?: string | null): UseFitVerdict {
  const [data, setData] = useState<FitVerdictData | null>(null);
  const [error, setError] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const [nonce, setNonce] = useState(0);
  const seq = useRef(0);
  const sig = signature(gear);

  useEffect(() => {
    if (!name || !ready) return;
    const id = ++seq.current;
    const timer = setTimeout(async () => {
      try {
        const frameQuery = frame ? `&frame=${encodeURIComponent(frame)}` : '';
        const res = await fetch(`${BASE}/api/equipment/fit-verdict?name=${encodeURIComponent(name)}${frameQuery}`, { cache: 'no-store' });
        if (res.status === 401 || res.status === 403) {
          if (id === seq.current) { setForbidden(true); setError(true); }
          return;
        }
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as FitVerdictData;
        if (id !== seq.current) return;
        setData({ facts: body.facts, copy: body.copy ?? null, checkInLevel: body.checkInLevel ?? null });
        setError(false);
        setForbidden(false);
      } catch {
        if (id === seq.current) setError(true);
      }
    }, nonce === 0 && seq.current === 1 ? 0 : VERDICT_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [name, ready, sig, nonce, frame]);

  const retry = useCallback(() => setNonce((n) => n + 1), []);
  return { data, error, forbidden, retry };
}
