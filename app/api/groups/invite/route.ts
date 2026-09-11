/**
 * `GET /api/groups/invite` — the club's current link and code.
 * `POST /api/groups/invite` — regenerate them, retiring the old pair.
 *
 * Admin-gated on BOTH verbs, and on the ASYNC check even for the read. This
 * departs from the repo's read-only-routes-may-use-the-sync-gate convention
 * (CLAUDE.md's read/write admin asymmetry) on purpose: the sync check verifies
 * a cookie's signature and expiry and nothing else, and what this route returns
 * is a live bearer credential for a club. A demoted admin holding a 30-day
 * cookie must not be able to read out the link on their way out of the door.
 *
 * GET MINTS IF THERE IS NOTHING TO SHOW. Every group created through
 * `POST /api/groups` gets a pair at birth, but BPM's group doc arrived through
 * the Phase 2 backfill, which minted none — and a group whose docs went missing
 * behind its pointers is the same case. Lazily minting is what stops the admin
 * card rendering an empty state that only a deploy could fix.
 *
 * Regeneration is the club's ONLY revocation: there is no TTL and no single
 * use. `lib/invites.ts`'s header has the full argument.
 */
import { NextRequest, NextResponse } from 'next/server';
import { isAdminAuthedWithMember, unauthorized } from '@/lib/auth';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import { mintInvite, readInvite } from '@/lib/invites';
import { groupsOn, featureOff, rateLimited } from '@/lib/groupRoutes';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  // Rate-limited like its POST sibling, and for the same reason: the lazy mint
  // below makes this READ a write path, so an unlimited GET would be an
  // unlimited regenerate by another name.
  const ip = getClientIp(req);
  if (!checkRateLimit(`groups-invite-read:${ip}`, 30, 15 * 60 * 1000)) return rateLimited();
  if (!groupsOn()) return featureOff();
  const auth = await isAdminAuthedWithMember(req);
  if (!auth.authed) return unauthorized();

  try {
    const invite = (await readInvite(auth.groupId)) ?? (await mintInvite(auth.groupId, auth.memberId));
    if (!invite) return NextResponse.json({ error: 'not_found' }, { status: 404 });
    return NextResponse.json(invite);
  } catch (error) {
    console.error('GET /api/groups/invite:', error);
    return NextResponse.json({ error: 'invite_failed' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  if (!checkRateLimit(`groups-invite:${ip}`, 10, 60 * 60 * 1000)) return rateLimited();
  if (!groupsOn()) return featureOff();
  const auth = await isAdminAuthedWithMember(req);
  if (!auth.authed) return unauthorized();

  try {
    const invite = await mintInvite(auth.groupId, auth.memberId);
    if (!invite) return NextResponse.json({ error: 'not_found' }, { status: 404 });
    return NextResponse.json(invite);
  } catch (error) {
    console.error('POST /api/groups/invite:', error);
    return NextResponse.json({ error: 'invite_failed' }, { status: 500 });
  }
}
