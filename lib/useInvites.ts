'use client';

import { useCallback, useEffect, useState } from 'react';
import { invitesOn } from '@/lib/invitesOn';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

export interface Invite {
  id: string;
  token: string;
  code: string;
  createdAt: string;
  expiresAt: string;
}

/** The link a token travels as, built from the window's own origin. */
export function inviteUrl(token: string): string {
  return typeof window === 'undefined' ? `${BASE}/?join=${token}` : `${window.location.origin}${BASE}/?join=${token}`;
}

/**
 * A club's LIVE one-time invites, for an ADMIN (docs/plans/one-time-invites.md).
 *
 * `create()` makes a new link-and-code pair and returns it; `revoke(id)`
 * retires one. Each works once and for seven days, so the list is what is
 * still waiting to be used. The URL is built HERE, from
 * `window.location.origin`, because the server has no reliable idea what
 * origin this request arrived on — behind the Azure proxy, in the installed
 * PWA and in the native WebView it differs, and a link that points at the
 * wrong origin is worse than no link.
 *
 * It asks exactly when the server answers — `invitesOn()`, multi-group OR
 * members-only — and otherwise does not (see `useCurrentGroup` for why a
 * flag-off hook must make no request). A 401 or 404 resolves to an empty list
 * with no error: not an admin, or a server whose flag disagrees with this
 * bundle. A real failure sets `error`, so the card can say it could not load
 * rather than render an empty list that reads as "nothing waiting".
 */
export function useInvites(enabled = true) {
  const [invites, setInvites] = useState<Invite[]>([]);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!enabled || !invitesOn()) {
      setLoading(false);
      return;
    }
    setError(false);
    try {
      const res = await fetch(`${BASE}/api/groups/invite`, { cache: 'no-store' });
      if (res.status === 401 || res.status === 404) {
        setInvites([]);
        return;
      }
      if (!res.ok) {
        setError(true);
        return;
      }
      setInvites(((await res.json()) as { invites: Invite[] }).invites);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    void load();
  }, [load]);

  const create = useCallback(async (): Promise<Invite | null> => {
    setBusy(true);
    try {
      const res = await fetch(`${BASE}/api/groups/invite`, { method: 'POST' });
      if (!res.ok) return null;
      const made = (await res.json()) as Invite;
      setInvites((prev) => [made, ...prev]);
      return made;
    } catch {
      return null;
    } finally {
      setBusy(false);
    }
  }, []);

  const revoke = useCallback(async (id: string): Promise<boolean> => {
    setBusy(true);
    try {
      const res = await fetch(`${BASE}/api/groups/invite`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      // 404: already used or expired since the list loaded — gone either way.
      if (!res.ok && res.status !== 404) return false;
      setInvites((prev) => prev.filter((i) => i.id !== id));
      return true;
    } catch {
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  return { invites, loading, error, busy, create, revoke, reload: load };
}
