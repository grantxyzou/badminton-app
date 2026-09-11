'use client';

import { useCallback, useEffect, useState } from 'react';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

export interface Invite {
  token: string;
  code: string;
  createdAt: string;
}

/**
 * The club's invite link and join code, for an ADMIN.
 *
 * The server hands back the two secrets; the URL is built HERE, from
 * `window.location.origin`, because the server has no reliable idea what
 * origin this request arrived on — behind the Azure proxy, in the installed
 * PWA and in the native WebView it differs, and a link that points at the
 * wrong origin is worse than no link.
 *
 * `regenerate()` is the club's only revocation: the old link and code stop
 * working the moment it resolves. Callers MUST confirm before calling it —
 * there is no undo and no way to tell who still holds the old one.
 *
 * A 401 or 404 resolves to `invite: null` with no error, the same posture as
 * `useCurrentGroup`: not an admin, or the feature is off. A real failure sets
 * `error`, so the card can say it could not load rather than render an empty
 * box that reads as "your club has no link".
 */
export function useInviteLink(enabled = true) {
  const [invite, setInvite] = useState<Invite | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    setError(false);
    try {
      const res = await fetch(`${BASE}/api/groups/invite`, { cache: 'no-store' });
      if (res.status === 401 || res.status === 404) {
        setInvite(null);
        return;
      }
      if (!res.ok) {
        setError(true);
        return;
      }
      setInvite((await res.json()) as Invite);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    void load();
  }, [load]);

  const regenerate = useCallback(async (): Promise<boolean> => {
    setBusy(true);
    setError(false);
    try {
      const res = await fetch(`${BASE}/api/groups/invite`, { method: 'POST' });
      if (!res.ok) {
        setError(true);
        return false;
      }
      setInvite((await res.json()) as Invite);
      return true;
    } catch {
      setError(true);
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  /** The shareable URL. `null` until there is a token and a window to read. */
  const url =
    invite && typeof window !== 'undefined'
      ? `${window.location.origin}${BASE}/?join=${invite.token}`
      : null;

  return { invite, url, loading, error, busy, regenerate, reload: load };
}
