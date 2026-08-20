'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useOnline } from '@/lib/useOnline';
import { rackets as racketsOf, activeRacket } from '@/lib/activeRacket';
import type { PlayerGear, GearItem, CatalogItem } from '@/lib/types';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/** Why a 409 was refused. Deliberately narrow: an unrecognised 409 code maps to
 *  'error', never to a specific reason the server didn't actually give. */
export type GearFailure = 'bag_full' | 'duplicate_racket' | 'error';
export type GearResult = { ok: true } | { ok: false; reason: GearFailure };

export interface UseGear {
  gear: PlayerGear | null;
  /** Rackets in the bag, active one included. */
  rackets: GearItem[];
  active: GearItem | null;
  /** True once the first read has settled, either way. */
  loaded: boolean;
  /** A read FAILED. Distinct from a loaded-empty bag: a player with three
   *  rackets who hits a flaky fetch must see an error, not "you own none". */
  loadError: boolean;
  /** A mutation is in flight, or we're offline. Consumers disable on this. */
  busy: boolean;
  online: boolean;
  reload: () => void;
  add: (item: CatalogItem) => Promise<GearResult>;
  activate: (itemId: string) => Promise<GearResult>;
  remove: (itemId: string) => Promise<GearResult>;
  setPrefs: (prefs: { playFormat?: 'singles' | 'doubles' | 'both'; budgetMaxCad?: number | null }) => Promise<GearResult>;
}

/**
 * Single owner of one player's gear doc.
 *
 * Before this, RacketRow held the read and GearSheet held the writes, and each
 * hand-rolled its own monotonic op counter to stop an older response landing
 * after a newer one. That race has shipped as a bug twice here. Moving the bag
 * onto the Equipment tab would have forked the guard a third time, so the
 * state has one owner and one counter instead.
 *
 * The counter is shared across the read AND all three writes: a slow initial
 * GET still in flight when the player taps activate/remove can otherwise land
 * after the mutation and silently revert the bag to its pre-mutation state.
 * The server stays correct; only the UI lies.
 */
export function useGear(name: string | null): UseGear {
  const online = useOnline();
  const [gear, setGear] = useState<PlayerGear | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);
  const opRef = useRef(0);

  const reload = useCallback(() => {
    if (!name) return;
    const opId = ++opRef.current;
    fetch(`${BASE}/api/equipment/gear?name=${encodeURIComponent(name)}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => {
        if (opId !== opRef.current) return;
        setGear((d.gear as PlayerGear | null) ?? null);
        setLoaded(true);
        setLoadError(false);
      })
      .catch(() => {
        if (opId !== opRef.current) return;
        setLoadError(true);
        setLoaded(true);
      });
  }, [name]);

  useEffect(() => { reload(); }, [reload]);

  /** Every mutation shares this shape: claim the op id, fire, apply the
   *  returned doc only if still current. The response body IS the new gear
   *  doc, so no refetch is needed and no second round-trip can interleave. */
  const mutate = useCallback(async (run: () => Promise<Response>): Promise<GearResult> => {
    if (!name) return { ok: false, reason: 'error' };
    setSaving(true);
    const opId = ++opRef.current;
    try {
      const res = await run();
      if (res.status === 409) {
        const { error } = await res.json().catch(() => ({ error: null }));
        if (error === 'bag_full') return { ok: false, reason: 'bag_full' };
        if (error === 'duplicate_racket') return { ok: false, reason: 'duplicate_racket' };
        return { ok: false, reason: 'error' };
      }
      if (!res.ok) throw new Error(String(res.status));
      const d = await res.json();
      if (opId === opRef.current) {
        setGear((d.gear as PlayerGear | null) ?? null);
        // A successful write proves the doc is readable, so it also clears a
        // stale read error — otherwise the error pill outlives its cause.
        setLoadError(false);
      }
      return { ok: true };
    } catch {
      return { ok: false, reason: 'error' };
    } finally {
      setSaving(false);
    }
  }, [name]);

  const add = useCallback((item: CatalogItem) => mutate(() => fetch(`${BASE}/api/equipment/gear`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      item: { catalogId: item.id, category: 'racket', label: `${item.brand} ${item.model}` },
    }),
  })), [mutate, name]);

  // Tapping the already-active racket is a no-op in the UI (BagList renders a
  // badge, not a button, for that row). This guard is defence in depth so the
  // rule holds even if a caller changes.
  const activate = useCallback(async (itemId: string): Promise<GearResult> => {
    if (activeRacket(gear)?.id === itemId) return { ok: true };
    return mutate(() => fetch(`${BASE}/api/equipment/gear`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, activeRacketId: itemId }),
    }));
  }, [mutate, name, gear]);

  const remove = useCallback((itemId: string) => mutate(() => fetch(
    `${BASE}/api/equipment/gear?name=${encodeURIComponent(name ?? '')}&itemId=${encodeURIComponent(itemId)}`,
    { method: 'DELETE' },
  )), [mutate, name]);

  const setPrefs = useCallback((prefs: { playFormat?: 'singles' | 'doubles' | 'both'; budgetMaxCad?: number | null }) =>
    mutate(() => fetch(`${BASE}/api/equipment/gear`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, ...prefs }),
    })), [mutate, name]);

  return {
    gear,
    rackets: racketsOf(gear),
    active: activeRacket(gear),
    loaded,
    loadError,
    busy: saving || !online,
    online,
    reload,
    add,
    activate,
    remove,
    setPrefs,
  };
}

export default useGear;
