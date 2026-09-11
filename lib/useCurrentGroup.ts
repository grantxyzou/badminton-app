'use client';

import { useCallback, useEffect, useState } from 'react';
import { IDENTITY_EVENT } from '@/lib/identity';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

export interface CurrentGroup {
  id: string;
  name: string;
  role: 'owner' | 'admin' | 'member';
  rosterName: string;
  isOwner: boolean;
  memberCount: number;
}

export interface GroupListEntry {
  id: string;
  name: string;
  role: 'owner' | 'admin' | 'member';
  rosterName: string;
  joinedAt: string;
  current: boolean;
}

/**
 * Which club this device is in, and which clubs the person belongs to.
 *
 * THREE STATES, NEVER TWO. `group === null` with `error === false` is "signed
 * out or no club", and `error === true` is "we could not find out" — the
 * lying-empty-state rule, which matters more here than usual: a switcher that
 * renders "no other groups" on a failed fetch teaches someone their club is
 * gone. `loading` stays true until the first answer lands, so nothing renders a
 * confident empty state in the meantime.
 *
 * FLAG OFF the endpoints 404 by design, and that is NOT an error — there is one
 * club and the concept is absent. It resolves to `group: null, error: false`, so
 * every consumer renders nothing without special-casing the flag client-side.
 *
 * Subscribes to `IDENTITY_EVENT` because a sign-in, a sign-out or a group switch
 * all change the answer inside the same tab, where `storage` events never fire.
 */
export function useCurrentGroup() {
  const [group, setGroup] = useState<CurrentGroup | null>(null);
  const [groups, setGroups] = useState<GroupListEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const refresh = useCallback(async () => {
    setError(false);
    try {
      const [currentRes, mineRes] = await Promise.all([
        fetch(`${BASE}/api/groups/current`, { cache: 'no-store' }),
        fetch(`${BASE}/api/groups/mine`, { cache: 'no-store' }),
      ]);

      // 404 = the feature is off; 401 = signed out. Neither is a failure.
      if (currentRes.status === 404 || currentRes.status === 401) {
        setGroup(null);
        setGroups([]);
        return;
      }
      if (!currentRes.ok) {
        setError(true);
        return;
      }
      setGroup((await currentRes.json()) as CurrentGroup);
      if (mineRes.ok) {
        const body = (await mineRes.json()) as { groups?: GroupListEntry[] };
        setGroups(body.groups ?? []);
      }
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const onIdentity = () => void refresh();
    window.addEventListener(IDENTITY_EVENT, onIdentity);
    return () => window.removeEventListener(IDENTITY_EVENT, onIdentity);
  }, [refresh]);

  return { group, groups, loading, error, refresh };
}
