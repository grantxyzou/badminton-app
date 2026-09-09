// Server-only by virtue of importing lib/cosmos (uses non-public env vars
// that won't resolve in a client context). Don't add 'use client' to any
// file that imports this.
import { getActiveSessionId } from '@/lib/cosmos';
import { groupScope } from '@/lib/groupScope';
import type { Announcement } from '@/lib/types';

/**
 * Read a group's announcements for its active session, newest first.
 *
 * Callable from server components (RSC) and from API route handlers.
 * Centralizing this here lets `app/page.tsx` server-render the
 * announcement card so it lands in the initial HTML payload — the
 * announcement is the LCP element on the home tab, so client-fetching
 * it cost ~6s of LCP delay (Lighthouse measured 6028ms element render
 * delay before this was extracted).
 *
 * Returns an empty array on any failure (Cosmos throttle, container
 * misconfig, etc.) so the page can still render. The caller decides
 * how to surface the empty case.
 */
export async function readActiveAnnouncements(groupId: string): Promise<Announcement[]> {
  try {
    const sessionId = await getActiveSessionId(groupId);
    // A group with no session has no announcements — a true empty, not a
    // failure wearing one.
    if (!sessionId) return [];
    return await groupScope(groupId).query<Announcement>('announcements', {
      where: 'c.sessionId = @sessionId',
      params: [{ name: '@sessionId', value: sessionId }],
      orderBy: 'c.time DESC',
    });
  } catch (error) {
    console.error('readActiveAnnouncements failed:', error);
    return [];
  }
}
