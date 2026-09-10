/**
 * WHICH GROUP IS THIS REQUEST FOR?
 *
 * The one seam every route resolves a group through (`docs/plans/multi-group.md`).
 *
 * Flag OFF (Phase 1, and production until the cutover): always BPM. The claim
 * a cookie may carry is IGNORED — a forged claim must not be able to move a
 * request into another group on a deployment that has not turned groups on.
 * That rule was pinned before there was a claim to forge
 * (`__tests__/group-context.test.ts`); `__tests__/group-auth.test.ts` holds
 * both branches.
 *
 * Flag ON (Phase 2): the `groupId` claim on the session cookies (`lib/auth.ts`),
 * member cookie first, then admin — the admin login route mints only the
 * latter. SYNC, signature and expiry only: the claim was verified against a
 * membership when it was MINTED (`completeSignIn`, `POST /api/admin`), so
 * re-reading the membership on every request would buy a Cosmos round-trip on
 * every hot path for a check already made. A route that needs the role fresh
 * uses `requireGroupMember` / `isAdminAuthedWithMember`. No claim, or one that
 * does not verify, means BPM — the group every pre-claim device belongs to.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { BPM_GROUP_ID } from './groupScope';
import { isFlagOn } from './flags';
import { readGroupClaim, SESSION_COOKIE_NAMES } from './auth';

/**
 * The answer when a group has no active session (`getActiveSessionId` returned
 * `null`). One shape for every route, so the client can recognise it: BPM can
 * never hit it (it has the legacy fallback), a NEW group hits it until its
 * owner creates the first session.
 */
export function noActiveSession(): NextResponse {
  return NextResponse.json({ error: 'no_active_session' }, { status: 404 });
}

function fromTokens(member: string | undefined, admin: string | undefined): string {
  if (!isFlagOn('NEXT_PUBLIC_FLAG_MULTI_GROUP')) return BPM_GROUP_ID;
  return readGroupClaim(member) ?? readGroupClaim(admin) ?? BPM_GROUP_ID;
}

/** Route handlers. */
export function resolveGroupId(req: NextRequest): string {
  return fromTokens(
    req.cookies.get(SESSION_COOKIE_NAMES.member)?.value,
    req.cookies.get(SESSION_COOKIE_NAMES.admin)?.value,
  );
}

/** One `name=value` out of a raw `Cookie` header. Values here are base64url, so no decoding. */
function cookieFromHeader(header: string, name: string): string | undefined {
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return undefined;
}

/**
 * Server components, which have a cookie HEADER rather than a request
 * (`app/page.tsx`, feeding `lib/announcements.ts`). `app/opengraph-image.tsx`
 * deliberately does NOT go through here: it is the share card for the app's
 * one public URL and hardcodes BPM until there is a per-group URL.
 */
export function resolveGroupIdFromCookieHeader(cookieHeader: string | null): string {
  if (!cookieHeader) return fromTokens(undefined, undefined);
  return fromTokens(
    cookieFromHeader(cookieHeader, SESSION_COOKIE_NAMES.member),
    cookieFromHeader(cookieHeader, SESSION_COOKIE_NAMES.admin),
  );
}
