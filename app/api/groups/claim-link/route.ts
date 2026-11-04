/**
 * `GET /api/groups/claim-link` — the club's claim link, and how many people on
 * the roster have never signed in.
 * `POST /api/groups/claim-link` — make a new link, retiring the old one.
 *
 * docs/plans/claim-your-name.md. The link lets a person the organiser
 * imported ASK to be let in under their own name; it signs nobody in by
 * itself. Admin-gated on BOTH verbs with the async check, for the reason
 * `GET /api/groups/invite` gives: what the read returns is a club's live
 * credential, and a demoted admin's 30-day cookie must not read it out.
 */
import { NextRequest, NextResponse } from 'next/server';
import { isAdminAuthedWithMember, unauthorized } from '@/lib/auth';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import { readClaimLink, rotateClaimLink, isUnclaimed } from '@/lib/claimLinks';
import { rosterMembers } from '@/lib/roster';
import { rateLimited } from '@/lib/groupRoutes';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const ip = getClientIp(req);
  if (!checkRateLimit(`groups-claim-link-read:${ip}`, 60, 15 * 60 * 1000)) return rateLimited();
  const auth = await isAdminAuthedWithMember(req);
  if (!auth.authed) return unauthorized();

  try {
    const [link, roster] = await Promise.all([readClaimLink(auth.groupId), rosterMembers(auth.groupId)]);
    return NextResponse.json({
      link,
      // Who the link is for: active on this roster, never signed in.
      unclaimed: roster.filter(({ member }) => isUnclaimed(member)).length,
    });
  } catch (error) {
    console.error('GET /api/groups/claim-link:', error);
    return NextResponse.json({ error: 'read_failed' }, { status: 503 });
  }
}

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  // A new link is a deliberate act (it cancels every ask made with the old
  // one); a handful an hour is plenty.
  if (!checkRateLimit(`groups-claim-link:${ip}`, 10, 60 * 60 * 1000)) return rateLimited();
  const auth = await isAdminAuthedWithMember(req);
  if (!auth.authed) return unauthorized();

  try {
    const link = await rotateClaimLink(auth.groupId, auth.memberId);
    if (!link) return NextResponse.json({ error: 'not_found' }, { status: 404 });
    return NextResponse.json({ link }, { status: 201 });
  } catch (error) {
    console.error('POST /api/groups/claim-link:', error);
    return NextResponse.json({ error: 'claim_link_failed' }, { status: 500 });
  }
}
