'use client';

import { useEffect, useState } from 'react';
import type { ClubTensionBand } from '@/lib/clubTension';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/** One read per frame per page load: the band moves when someone restrings,
 *  not while a sheet is open. A failed read is not cached. */
const cache = new Map<string, Promise<ClubTensionBand | null>>();

export function resetClubTensionCache(): void {
  cache.clear();
}

function load(frame: string): Promise<ClubTensionBand | null> {
  let p = cache.get(frame);
  if (!p) {
    p = fetch(`${BASE}/api/stats/club/tension?frame=${encodeURIComponent(frame)}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => (d?.band ?? null) as ClubTensionBand | null);
    p.catch(() => cache.delete(frame));
    cache.set(frame, p);
  }
  return p;
}

export type ClubTensionState =
  | { status: 'loading'; band: null }
  | { status: 'ready'; band: ClubTensionBand | null }
  | { status: 'error'; band: null };

/**
 * The club's tension band for one racket frame (lib/clubTension). `band: null`
 * with `status: 'ready'` is "fewer than three members" — say nothing — which is
 * a different fact from a read that failed.
 */
export function useClubTension(frame: string | null | undefined): ClubTensionState {
  const [state, setState] = useState<{ frame: string | null; value: ClubTensionState }>({ frame: null, value: { status: 'loading', band: null } });

  useEffect(() => {
    if (!frame) return;
    let live = true;
    load(frame)
      .then((band) => live && setState({ frame, value: { status: 'ready', band } }))
      .catch(() => live && setState({ frame, value: { status: 'error', band: null } }));
    return () => { live = false; };
  }, [frame]);

  if (!frame) return { status: 'ready', band: null };
  return state.frame === frame ? state.value : { status: 'loading', band: null };
}
