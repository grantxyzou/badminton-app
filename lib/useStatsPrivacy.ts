'use client';

import { useCallback, useEffect, useState } from 'react';
import type { StatsPrivacy } from './statsPrivacy';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/**
 * Read and write the member's club-comparison preference.
 *
 * Shared by the first-run consent sheet and the Profile → Stats & privacy
 * screen so the two cannot disagree about what the stored answer is.
 *
 * `privacy === null` means UNKNOWN — the read has not finished, or the server
 * answered on a degraded path that never touched the member doc. It does NOT
 * mean "never asked". Treating unknown as unasked would re-fire the consent
 * sheet at someone who already answered, every time the read was rate-limited.
 * That is the same unknown-vs-known-false rule the admin tab gate follows.
 */
export interface UseStatsPrivacy {
  /** null = unknown. Check `loaded` before drawing conclusions from it. */
  privacy: StatsPrivacy | null;
  loaded: boolean;
  error: boolean;
  saving: boolean;
  saveError: boolean;
  /** Resolves true on success. Optimistically updates local state. */
  save: (clubComparison: boolean) => Promise<boolean>;
  reload: () => void;
}

export function useStatsPrivacy(name: string | null): UseStatsPrivacy {
  const [privacy, setPrivacy] = useState<StatsPrivacy | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!name) {
      setLoaded(false);
      return;
    }
    let live = true;
    setError(false);
    fetch(`${BASE}/api/members/me?name=${encodeURIComponent(name)}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => {
        if (!live) return;
        // The server sends `statsPrivacy: null` on its degraded paths. Keep it
        // null rather than substituting a default.
        setPrivacy((d?.statsPrivacy ?? null) as StatsPrivacy | null);
        setLoaded(true);
      })
      .catch(() => {
        if (!live) return;
        setError(true);
        setLoaded(true);
      });
    return () => {
      live = false;
    };
  }, [name, nonce]);

  const save = useCallback(
    async (clubComparison: boolean): Promise<boolean> => {
      if (!name) return false;
      setSaving(true);
      setSaveError(false);
      try {
        const res = await fetch(`${BASE}/api/members/me`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, statsPrivacy: { clubComparison } }),
        });
        if (!res.ok) throw new Error(String(res.status));
        const body = await res.json();
        // Trust the SERVER's echo, not a locally-guessed shape: promptedAt is
        // stamped server-side and is what stops the sheet re-firing.
        setPrivacy((body?.statsPrivacy ?? null) as StatsPrivacy | null);
        return true;
      } catch {
        setSaveError(true);
        return false;
      } finally {
        setSaving(false);
      }
    },
    [name],
  );

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  return { privacy, loaded, error, saving, saveError, save, reload };
}

/**
 * Should the first-run consent sheet open?
 *
 * Requires a POSITIVE answer to "has this member been asked?" — unknown is not
 * enough. `loaded` must be true, the read must not have failed, and the
 * preference must be present with a null `promptedAt`.
 */
export function shouldPromptForComparison(state: UseStatsPrivacy): boolean {
  if (!state.loaded || state.error) return false;
  if (!state.privacy) return false; // unknown — do not ask
  return state.privacy.promptedAt === null;
}
