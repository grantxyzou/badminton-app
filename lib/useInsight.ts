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

/**
 * A load result, NOT just the payload.
 *
 * `/api/stats/insight` is owner-or-admin gated (`ownsNameOrAdmin`), so a
 * device with no `member_session` cookie for this name — an expired 30-day
 * cookie alongside a still-live `badminton_identity`, or the stats
 * preview-name path — gets a 403. Collapsing that into `null` made it
 * indistinguishable from "this member has no insight", which is a lying empty
 * state: the surface simply wasn't there and nothing said why. `forbidden`
 * carries it so a consumer can render the actionable sign-in state instead.
 */
export type InsightLoad =
  | { data: InsightData; forbidden: false }
  | { data: null; forbidden: boolean };

type Entry = { promise: Promise<InsightLoad> };
const cache = new Map<string, Entry>();

function load(name: string): Promise<InsightLoad> {
  const key = name.toLowerCase();
  const hit = cache.get(key);
  if (hit) return hit.promise;
  const promise = fetch(`${BASE}/api/stats/insight?name=${encodeURIComponent(name)}`, { cache: 'no-store' })
    .then(async (r) => {
      if (r.ok) return { data: (await r.json()) as InsightData, forbidden: false as const };
      // Only 403 is a known "you may not read this". Every other non-ok
      // status (429, 5xx, flag-off 404) stays a plain load failure — telling
      // a rate-limited member to sign in again would be its own lie.
      return { data: null, forbidden: r.status === 403 };
    })
    .catch(() => ({ data: null, forbidden: false }));
  cache.set(key, { promise });
  // A refusal must not be memoized past the in-flight window. The cache is
  // keyed by NAME and only cleared on a name → different-name transition, so a
  // member who signs in again as the SAME name would otherwise keep being told
  // "sign in on Profile" after doing exactly that — a false instruction, which
  // is the defect this whole state exists to remove. Concurrent mounts still
  // share the one request; only a LATER mount re-asks, and a 403 costs neither
  // a Cosmos read nor a Claude call.
  void promise.then((res) => {
    if (res.forbidden && cache.get(key)?.promise === promise) cache.delete(key);
  });
  return promise;
}

export interface UseInsight {
  data: InsightData | null;
  loading: boolean;
  /** The read FAILED for an unknown reason. Mutually exclusive with `forbidden`. */
  error: boolean;
  /**
   * The server refused the read (403): this device does not own the name and
   * is not an admin. Distinct from `error` — the fix is signing in, not
   * refreshing.
   */
  forbidden: boolean;
}

/**
 * @param enabled gate the fetch (e.g. the insight-cards flag). When false the
 *   hook issues no request and holds no data, so the legacy build pays nothing
 *   but the identity subscription every Stats surface carries anyway.
 */
export function useInsight(enabled = true): UseInsight {
  // The name comes from the module that owns the identity chain. That module
  // subscribes to `storage` as well as IDENTITY_EVENT; this hook previously
  // listened for IDENTITY_EVENT only, so signing in from ANOTHER tab left the
  // insight keyed to the departed member while the prop-driven cards moved on.
  const { name: activeName } = useActiveName();
  const [state, setState] = useState<UseInsight>({
    data: null,
    loading: false,
    error: false,
    forbidden: false,
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
      setState({ data: null, loading: false, error: false, forbidden: false });
      return;
    }
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: false, forbidden: false }));
    load(activeName).then((res) => {
      if (cancelled) return;
      setState({
        data: res.data,
        loading: false,
        // A refusal is not an unknown failure. Keeping both true would let a
        // consumer that only checks `error` render "couldn't load" over a
        // state that refreshing will never fix.
        error: res.data === null && !res.forbidden,
        forbidden: res.forbidden,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, activeName]);

  return state;
}
