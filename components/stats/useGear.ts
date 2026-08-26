'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useOnline } from '@/lib/useOnline';
import { rackets as racketsOf, activeRacket } from '@/lib/activeRacket';
import type { PlayerGear, GearItem, CatalogItem } from '@/lib/types';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/** Why a write was refused. Deliberately narrow: an unrecognised code maps to
 *  'error', never to a specific reason the server didn't actually give.
 *
 *  `unauthorized` and `member_not_found` are here because collapsing them into
 *  'error' made this route undiagnosable from the outside. Every non-409
 *  failure rendered as "Couldn't load that — refresh to try again", which for
 *  an expired `member_session` is not merely vague but WRONG: refreshing can
 *  never mint a cookie, and the member sits there re-tapping a button that
 *  will not work until they sign in. That cookie has a 30-day TTL while
 *  `badminton_identity` in localStorage does not expire at all, so the app
 *  goes on resolving an active name — Stats renders, the kit card renders,
 *  the sheet opens — while every write is refused. `GearPickSheet` already
 *  names this exact state in a comment about its own preference controls; it
 *  just had no way to say so out loud. */
export type GearFailure =
  | 'bag_full'
  | 'duplicate_racket'
  | 'unauthorized'
  | 'member_not_found'
  /** Strings only: the item WAS added, its tension was not. See `add`. */
  | 'tension_not_saved'
  /** 20 bag writes per hour per name+IP. Nothing is broken and nothing the
   *  member does now will help — only waiting will. */
  | 'rate_limited'
  | 'error';
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
  /** The second argument attaches a string's tension at add time — see `add`'s
   *  own comment for why it needs a follow-up write rather than one call. */
  add: (item: CatalogItem, extra?: { tensionLbs?: number }) => Promise<GearResult>;
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
  // Mirrors `loaded` for the recovery check in `mutate`, which runs inside a
  // closure that would otherwise read a stale value.
  const loadedRef = useRef(false);
  const markLoaded = useCallback(() => { loadedRef.current = true; setLoaded(true); }, []);

  const reload = useCallback(() => {
    if (!name) return;
    const opId = ++opRef.current;
    fetch(`${BASE}/api/equipment/gear?name=${encodeURIComponent(name)}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => {
        if (opId !== opRef.current) return;
        setGear((d.gear as PlayerGear | null) ?? null);
        markLoaded();
        setLoadError(false);
      })
      .catch(() => {
        if (opId !== opRef.current) return;
        setLoadError(true);
        markLoaded();
      });
  }, [name, markLoaded]);

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
      // 401/403: the caller is not (or is no longer) this member. Read the
      // body for nothing — the status alone is the whole story, and it is a
      // story the member can act on.
      if (res.status === 401 || res.status === 403) {
        return { ok: false, reason: 'unauthorized' };
      }
      // The bag limiter runs BEFORE auth (Rule 4), so this is reachable by
      // anyone — including, in practice, a member re-tapping a button that is
      // failing for some OTHER reason: twenty taps in an hour and the original
      // fault is replaced by this one. Folded into the generic message it read
      // as "refresh to try again", which is wrong twice — refreshing does
      // nothing, and the window is an hour, so the app stays broken for
      // precisely as long as someone keeps trying to reproduce the problem.
      if (res.status === 429) return { ok: false, reason: 'rate_limited' };
      if (res.status === 409 || res.status === 404) {
        const { error } = await res.json().catch(() => ({ error: null }));
        if (error === 'bag_full') return { ok: false, reason: 'bag_full' };
        if (error === 'duplicate_racket') return { ok: false, reason: 'duplicate_racket' };
        if (error === 'member_not_found') return { ok: false, reason: 'member_not_found' };
        return { ok: false, reason: 'error' };
      }
      if (!res.ok) throw new Error(String(res.status));
      const d = await res.json();
      if (opId === opRef.current) {
        setGear((d.gear as PlayerGear | null) ?? null);
        // The response body IS the doc, so a write is also a definitive read —
        // it must set `loaded`, not only clear the error. Claiming the op id
        // above cancelled any in-flight initial GET, and `setLoaded(true)`
        // lives only inside that GET's two guarded branches, so without this
        // a mutation racing the first load strands the register on skeletons
        // permanently: nothing else ever flips `loaded`.
        markLoaded();
        // A successful write proves the doc is readable, so it also clears a
        // stale read error — otherwise the error pill outlives its cause.
        setLoadError(false);
      }
      return { ok: true };
    } catch {
      return { ok: false, reason: 'error' };
    } finally {
      setSaving(false);
      // Same cancellation, unhappy path: a 409 or a failed write produced no
      // doc, so if that cancelled GET was the only one we ever had, re-read —
      // otherwise `loaded` never flips and the register sits on skeletons.
      // Conditioned on having NO doc, not merely on the write failing: once a
      // doc is applied it is authoritative, and re-reading after (say) a
      // failed tension follow-up would discard the item the preceding write
      // just added. Guarded on the op id so a newer operation owns recovery.
      if (!loadedRef.current && opId === opRef.current) reload();
    }
  }, [name, reload, markLoaded]);

  /**
   * Add a catalog item to the bag.
   *
   * The category comes from the ITEM, not a hardcoded 'racket'. It used to be
   * literal, which is why nothing but a racket could ever be added even though
   * the API has always validated and stored the field. Falls back to 'racket'
   * so any legacy caller passing a catalog row without one behaves as before.
   *
   * `extra.tensionLbs` (string picks only) needs a SECOND write: POST is the
   * "append to my bag" verb and has never read `tensionLbs` off the wire, but
   * PUT already does (route.ts:349) — it's the idempotent "set this item"
   * verb, matching by catalogId, so calling it right after a successful add
   * updates the SAME item in place rather than appending a duplicate.
   *
   * The follow-up is AWAITED, not fire-and-forget (review fix, round 1): this
   * is member-typed data — the exact thing the tension field exists to
   * capture — and by the time it resolves the item is already visible in
   * `BagList` (POST's own `mutate()` call already applied it to `gear`
   * above), which is the caller's natural retry surface if the PUT fails.
   * `recordEngagement()` is this codebase's one sanctioned fire-and-forget,
   * precisely because nothing the user sees depends on it; a member-entered
   * tension value is the opposite of that. Both calls still go through
   * `mutate()`, so the shared op counter protects the follow-up exactly like
   * every other write; nothing bypasses it.
   *
   * Gated to `category === 'string'` even though the type allows any item:
   * PUT's own pointer rule (route.ts:373) is "the item I PUT becomes active"
   * for rackets, which is the OPPOSITE of what POST just did two lines above
   * (preserve the existing pointer when the bag already had one — see the
   * comment at route.ts:180). A tension follow-up on a racket would silently
   * re-point `activeRacketId` to whatever was just added, undoing POST's own
   * guard. Not reachable today (only the string sheet ever passes tension),
   * but the two verbs disagree by design and this call site must not be the
   * place that finds out.
   */
  const add = useCallback(async (item: CatalogItem, extra?: { tensionLbs?: number }): Promise<GearResult> => {
    const res = await mutate(() => fetch(`${BASE}/api/equipment/gear`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        item: {
          catalogId: item.id,
          category: item.category ?? 'racket',
          label: `${item.brand} ${item.model}`,
        },
      }),
    }));
    if (res.ok && item.category === 'string' && typeof extra?.tensionLbs === 'number') {
      const withTension = await mutate(() => fetch(`${BASE}/api/equipment/gear`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          item: {
            catalogId: item.id,
            category: item.category ?? 'racket',
            label: `${item.brand} ${item.model}`,
            tensionLbs: extra.tensionLbs,
          },
        }),
      }));
      // Returning the PUT's own failure here described the wrong event. The
      // POST above already succeeded, so the string IS in the bag — but the
      // sheet would report "couldn't save that", and because the item now
      // appears in `ownedCatalogIds` it is filtered out of the catalog, so
      // there is no row left to tap to retry. The member is told nothing
      // saved, sees the string listed anyway, and has no way forward.
      //
      // One reason for every PUT failure, deliberately: whatever the status
      // was, the salient and actionable fact is the same — the string landed,
      // the tension did not. (A 401 here is close to impossible anyway; the
      // POST it follows proved the credential a moment earlier.)
      if (!withTension.ok) return { ok: false, reason: 'tension_not_saved' };
      return withTension;
    }
    return res;
  }, [mutate, name]);

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
