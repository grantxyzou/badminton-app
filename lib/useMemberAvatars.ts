'use client';

import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { normalizeAvatar, type MemberAvatar } from '@/lib/memberAvatar';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/**
 * EVERYONE'S PICTURE, READ ONCE.
 *
 * The single owner of "which avatar goes with this name", in the spirit of
 * `lib/useActiveName.ts`: the roster, payments, kudos and Profile all render
 * avatars, and each fetching `GET /api/members` would be one read per card.
 * One module-level read serves them all; `setMemberAvatar` updates it the
 * moment a member saves, so their own face changes everywhere at once.
 *
 * A failed read is not an error anyone sees: avatars are decoration, so every
 * name falls back to its initial and the next mount tries again.
 */
let byName: Map<string, MemberAvatar | null> = new Map();
let version = 0;
let loaded = false;
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();

const key = (name: string) => name.trim().toLowerCase();

function notify() {
  version += 1;
  for (const l of listeners) l();
}

function load(): void {
  if (loaded || inflight || typeof window === 'undefined') return;
  inflight = fetch(`${BASE}/api/members`, { cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : null))
    .then((rows: unknown) => {
      if (!Array.isArray(rows)) return;
      const next = new Map(byName);
      for (const row of rows as Array<{ name?: unknown; avatar?: unknown }>) {
        if (typeof row?.name !== 'string') continue;
        // A save made while this read was in flight wins over the older answer.
        if (!next.has(key(row.name))) next.set(key(row.name), normalizeAvatar(row.avatar));
      }
      byName = next;
      loaded = true;
      notify();
    })
    .catch(() => {
      /* initials until the next mount retries */
    })
    .finally(() => {
      inflight = null;
    });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Record a member's new picture everywhere it is shown. */
export function setMemberAvatar(name: string, avatar: MemberAvatar | null): void {
  byName = new Map(byName).set(key(name), avatar);
  notify();
}

/** Tests only. */
export function resetMemberAvatars(): void {
  byName = new Map();
  loaded = false;
  inflight = null;
  notify();
}

export function useMemberAvatars(): (name: string) => MemberAvatar | null {
  const snapshot = useSyncExternalStore(subscribe, () => version, () => 0);
  useEffect(() => {
    load();
  }, []);
  // `snapshot` is the dependency that makes a new map produce a new lookup.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useCallback((name: string) => byName.get(key(name)) ?? null, [snapshot]);
}
