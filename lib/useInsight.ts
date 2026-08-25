'use client';

import { useEffect, useRef, useState } from 'react';
import { useActiveName } from '@/lib/useActiveName';

/**
 * Shared client hook for the distributed AI insight (greeting + per-card chips).
 *
 * The greeting and the level/trend chips all consume the SAME insight payload,
 * so this hook memoizes the fetch per (lowercased) name and shares the in-flight
 * promise — three consumers trigger ONE network call to /api/stats/insight. The
 * module cache is cleared on IDENTITY_EVENT (sign-in/out) so a new identity
 * refetches. Resolution mirrors the other Stats cards: real identity → stats
 * preview-name → null.
 */

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

export interface CardSlice {
  headline: string;
  support?: string;
  /** Drives the chip icon — set server-side from the driving signal. */
  kind: string;
}

export interface InsightData {
  account: boolean;
  greeting: string | null;
  level: CardSlice | null;
  trend: CardSlice | null;
}

type Entry = { promise: Promise<InsightData | null> };
const cache = new Map<string, Entry>();

function load(name: string): Promise<InsightData | null> {
  const key = name.toLowerCase();
  const hit = cache.get(key);
  if (hit) return hit.promise;
  const promise = fetch(`${BASE}/api/stats/insight?name=${encodeURIComponent(name)}`, { cache: 'no-store' })
    .then((r) => (r.ok ? (r.json() as Promise<InsightData>) : null))
    .catch(() => null);
  cache.set(key, { promise });
  return promise;
}

/**
 * @param enabled gate the fetch (e.g. the insight-cards flag). When false the
 *   hook issues no request and holds no data, so the legacy build pays nothing
 *   but the identity subscription every Stats surface carries anyway.
 */
export function useInsight(enabled = true): { data: InsightData | null; loading: boolean; error: boolean } {
  // The name comes from the module that owns the identity chain. That module
  // subscribes to `storage` as well as IDENTITY_EVENT; this hook previously
  // listened for IDENTITY_EVENT only, so signing in from ANOTHER tab left the
  // insight keyed to the departed member while the prop-driven cards moved on.
  const { name: activeName } = useActiveName();
  const [state, setState] = useState<{ data: InsightData | null; loading: boolean; error: boolean }>({
    data: null,
    loading: false,
    error: false,
  });

  // Force a refresh when the member actually CHANGES. The cache is keyed by
  // name, so a different member can never be *served* stale data — this only
  // makes a re-sign-in re-read rather than replay the memo.
  //
  // The `prev != null` guard is load-bearing: `useActiveName` resolves in an
  // effect, so EVERY consumer transitions null → name on its own mount.
  // treating that as a change made all three consumers clear the cache as they
  // mounted, turning the one shared request this module exists to provide back
  // into three. Only a name → different-name transition is a real switch.
  const seen = useRef<string | null>(null);
  useEffect(() => {
    const prev = seen.current;
    seen.current = activeName;
    if (prev != null && prev !== activeName) cache.clear();
  }, [activeName]);

  useEffect(() => {
    if (!enabled || !activeName) {
      setState({ data: null, loading: false, error: false });
      return;
    }
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: false }));
    load(activeName).then((data) => {
      if (cancelled) return;
      setState({ data: data ?? null, loading: false, error: data === null });
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, activeName]);

  return state;
}
