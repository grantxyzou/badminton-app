'use client';

import { useEffect, useState } from 'react';
import { getIdentity, IDENTITY_EVENT } from './identity';

/**
 * The name Stats renders for.
 *
 * This chain was copy-pasted into 13 components (and the key literal into 10),
 * and the copies had already drifted: only 2 of them subscribed to
 * `IDENTITY_EVENT`, so most cards kept showing the previous player's data after
 * a sign-in or sign-out until something else forced a re-render. This module is
 * the single owner. New Stats code should use `useActiveName()`; the older
 * copies migrate as each card is rewritten.
 *
 * Resolution order — identity, then preview name, then nothing:
 *
 *  1. `badminton_identity` — a real signed-in player.
 *  2. `badminton_stats_preview_name` — a name picked purely to VIEW someone's
 *     stats (an admin browsing, or an anonymous visitor using the picker).
 *
 * The preview key is deliberately separate from the real identity and is never
 * written into it: `badminton_identity` carries a `deleteToken` that authorises
 * self-cancel, so promoting a preview name into it would mint a fake credential
 * and break self-cancel semantics. Signing up upgrades a preview name to a real
 * identity, and the preview key is ignored from that point on.
 */
export const STATS_PREVIEW_NAME_KEY = 'badminton_stats_preview_name';

/**
 * Pure resolver. Browser-only — returns `null` during SSR, which is why
 * consumers must not seed `useState` with it (see `useActiveName`).
 */
export function resolveActiveName(): string | null {
  const id = getIdentity();
  if (id?.name) return id.name;
  try {
    const stored = localStorage.getItem(STATS_PREVIEW_NAME_KEY);
    if (stored && stored.trim()) return stored.trim();
  } catch {
    /* localStorage can throw in private mode — treat as no preview name. */
  }
  return null;
}

export interface ActiveName {
  /** The resolved name, or `null` for "nobody". Only meaningful once `resolved`. */
  name: string | null;
  /**
   * Whether the lookup has actually run. Unknown is not the same as
   * known-absent: rendering the signed-out state on the first paint, before
   * the effect reads localStorage, flashes "sign in" at a signed-in member.
   * Gate the empty state on `resolved && !name`, never on `!name` alone.
   */
  resolved: boolean;
}

/**
 * Subscribes to identity changes so sign-in / sign-out reactivity works without
 * a refresh. Both listeners are needed: the browser's own `storage` event fires
 * only in OTHER tabs, so the custom `IDENTITY_EVENT` is what updates this one.
 */
export function useActiveName(): ActiveName {
  // Deliberately NOT seeded from localStorage — the initializer runs during
  // SSR/hydration and would produce a server/client mismatch. Resolve in the
  // effect and let `resolved` carry the "not known yet" state.
  const [state, setState] = useState<ActiveName>({ name: null, resolved: false });

  useEffect(() => {
    const update = () => setState({ name: resolveActiveName(), resolved: true });
    update();
    window.addEventListener(IDENTITY_EVENT, update);
    window.addEventListener('storage', update);
    return () => {
      window.removeEventListener(IDENTITY_EVENT, update);
      window.removeEventListener('storage', update);
    };
  }, []);

  return state;
}
