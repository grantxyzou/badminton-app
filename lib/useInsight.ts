'use client';

import { useEffect, useState } from 'react';
import { getIdentity, IDENTITY_EVENT } from '@/lib/identity';

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
const STATS_NAME_KEY = 'badminton_stats_preview_name';

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

function resolveActiveName(): string | null {
  const id = getIdentity();
  if (id?.name) return id.name;
  try {
    const stored = localStorage.getItem(STATS_NAME_KEY);
    if (stored && stored.trim()) return stored.trim();
  } catch {
    /* ignore */
  }
  return null;
}

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
 *   hook stays inert — no request, no state — so the legacy build pays nothing.
 */
export function useInsight(enabled = true): { data: InsightData | null; loading: boolean; error: boolean } {
  const [activeName, setActiveName] = useState<string | null>(null);
  const [state, setState] = useState<{ data: InsightData | null; loading: boolean; error: boolean }>({
    data: null,
    loading: false,
    error: false,
  });

  useEffect(() => {
    if (!enabled) return;
    const update = () => {
      cache.clear();
      setActiveName(resolveActiveName());
    };
    setActiveName(resolveActiveName());
    window.addEventListener(IDENTITY_EVENT, update);
    return () => window.removeEventListener(IDENTITY_EVENT, update);
  }, [enabled]);

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
