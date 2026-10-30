'use client';

import { useCallback, useEffect, useState } from 'react';
import { sharedRead } from '@/lib/sharedRead';
import { levelPath, parseLevelRead, type LevelRead } from '@/lib/levelRead';

/** A level read's state. `forbidden` is a 403 (this device does not own the
 *  name) — a refusal, not a failure, and every reader shows it differently. */
export interface LevelState {
  status: 'loading' | 'ready' | 'error' | 'forbidden';
  data: LevelRead | null;
}

/**
 * The canonical level and its trail for `name` (`docs/plans/one-level.md`).
 * Re-read whenever `savedAt` moves — a saved check-in moves the level — and
 * on `reload`. A re-read of the same member keeps what is on screen until the
 * answer lands (the refetch rule). Two readers on one screen share one request
 * through `sharedRead`.
 */
export function useLevelRead(name: string | null, savedAt = 0): LevelState & { reload: () => void } {
  const [state, setState] = useState<LevelState>({ status: 'loading', data: null });
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    if (!name) return;
    let live = true;
    sharedRead<unknown>(levelPath(name))
      .then((d) => live && setState({ status: 'ready', data: parseLevelRead(d) }))
      .catch((e: Error) => live && setState({ status: e?.message === '403' ? 'forbidden' : 'error', data: null }));
    return () => { live = false; };
  }, [name, savedAt, tick]);

  return { ...state, reload };
}
