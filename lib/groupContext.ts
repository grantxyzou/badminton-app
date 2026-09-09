/**
 * WHICH GROUP IS THIS REQUEST FOR?
 *
 * The one seam every route resolves a group through (`docs/plans/multi-group.md`).
 *
 * Phase 1: always BPM. The flag is off in production and nothing carries a
 * group yet, so the whole sweep that routes reads and writes through
 * `groupScope(groupId)` can land with BPM behaving exactly as it does today.
 *
 * Phase 2 adds the real resolution behind the flag: the `groupId` claim in
 * the session cookies (`lib/auth.ts`), verified against a `memberships`
 * point read. Even then, WHILE THE FLAG IS OFF THE CLAIM IS IGNORED — a forged
 * claim must not be able to move a request into another group on a deployment
 * that has not turned groups on. That rule is pinned now, before there is a
 * claim to forge (`__tests__/group-context.test.ts`).
 */
import { NextResponse, type NextRequest } from 'next/server';
import { BPM_GROUP_ID } from './groupScope';

/**
 * The answer when a group has no active session (`getActiveSessionId` returned
 * `null`). One shape for every route, so the client can recognise it: BPM can
 * never hit it (it has the legacy fallback), a NEW group hits it until its
 * owner creates the first session.
 */
export function noActiveSession(): NextResponse {
  return NextResponse.json({ error: 'no_active_session' }, { status: 404 });
}

/** Route handlers. */
export function resolveGroupId(_req: NextRequest): string {
  return BPM_GROUP_ID;
}

/**
 * Server components, which have a cookie HEADER rather than a request
 * (`app/page.tsx`, feeding `lib/announcements.ts`). `app/opengraph-image.tsx`
 * deliberately does NOT go through here: it is the share card for the app's
 * one public URL and hardcodes BPM until there is a per-group URL.
 */
export function resolveGroupIdFromCookieHeader(_cookieHeader: string | null): string {
  return BPM_GROUP_ID;
}
