'use client';

import { useSyncExternalStore } from 'react';
import type { NoticeDoc } from './notices';

/**
 * The Notifications page's one client store, shared by the bell (its red dot)
 * and the page (its list), so the two can never disagree about what is new
 * (`docs/plans/notification-center.md`).
 *
 * Module scope, like `lib/useMemberAvatars.ts`: one read serves both, and the
 * page's "seen" clears the bell's dot at once without a second fetch.
 *
 * `loading` and `error` are not "nothing new" — the dot renders only from a
 * read that SUCCEEDED (CLAUDE.md, "Unknown ≠ known-false").
 */
export type Notice = Omit<NoticeDoc, 'kind' | 'memberId' | 'groupId'>;

export interface NoticesState {
  status: 'loading' | 'error' | 'ready';
  notices: Notice[];
  unread: number;
  /** The last "seen" stamp the server holds; `null` = never opened. */
  seenAt: string | null;
}

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
const INITIAL: NoticesState = { status: 'loading', notices: [], unread: 0, seenAt: null };

let state: NoticesState = INITIAL;
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function set(next: NoticesState) {
  state = next;
  listeners.forEach((l) => l());
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

const read = () => state;
const readServer = () => INITIAL;

/**
 * Re-read the list. Concurrent calls share one request. A refetch keeps the
 * list on screen; only a FAILED one replaces it (a stale list is never allowed
 * to stand in for a failure — the loading-cascade rule).
 */
export function refreshNotices(): Promise<void> {
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const res = await fetch(`${BASE}/api/notifications`, { cache: 'no-store' });
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as { notices?: Notice[]; unread?: number; seenAt?: string | null };
      set({
        status: 'ready',
        notices: Array.isArray(body.notices) ? body.notices : [],
        unread: typeof body.unread === 'number' ? body.unread : 0,
        seenAt: typeof body.seenAt === 'string' ? body.seenAt : null,
      });
    } catch {
      set({ ...state, status: 'error' });
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** "I have looked." Clears the dot only once the server has the stamp. */
export async function markNoticesSeen(): Promise<void> {
  try {
    const res = await fetch(`${BASE}/api/notifications/seen`, { method: 'POST', cache: 'no-store' });
    if (!res.ok) return;
    const body = (await res.json()) as { seenAt?: string };
    set({ ...state, unread: 0, seenAt: typeof body.seenAt === 'string' ? body.seenAt : state.seenAt });
  } catch {
    /* the dot stays; the next open tries again */
  }
}

export function useNotices(): NoticesState {
  return useSyncExternalStore(subscribe, read, readServer);
}

/** Tests only. */
export function __resetNoticesForTests(): void {
  state = INITIAL;
  inflight = null;
  listeners.clear();
}

/** The current snapshot, outside React (the page reads it after a refresh). */
export function getNotices(): NoticesState {
  return state;
}
