/**
 * GET  /api/groups/ask — where this account's asks to join stand.
 * POST /api/groups/ask — ask to join a club through its link, signed in.
 *
 * docs/plans/one-way-in.md, step 4. The account signs in FIRST (Apple, Google
 * or an email code), then asks; an organiser's yes adds THIS account to the
 * club. Nothing is created at approval, so there is no secret to hold and no
 * page to keep open: the person can close the app and is told by email.
 *
 * The caller is the live member cookie (`verifyLiveMemberAuth`, so "Sign out
 * everywhere" holds). The club comes from its link, never from the cookie:
 * a brand-new account's cookie names BPM, the club it is NOT in.
 *
 * What the answers can say: only the caller's own asks, read through its own
 * pointer (`Member.joinAsks`). Nothing here says who else is on a roster, so
 * the name-test the signed-out ask allowed (step 1's finding) has no way in.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getContainer } from '@/lib/cosmos';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import { verifyLiveMemberAuth } from '@/lib/auth';
import { resolveClaimLink } from '@/lib/claimLinks';
import { readGroup } from '@/lib/groups';
import { accountAsks, addAccountJoinRequest, MAX_JOIN_NAME } from '@/lib/joinRequests';
import { notifyOrganisersOfJoinRequest } from '@/lib/joinNotify';
import { isFlagOn } from '@/lib/flags';
import type { Member } from '@/lib/types';

export const dynamic = 'force-dynamic';

const HOUR = 60 * 60 * 1000;

export async function GET(req: NextRequest) {
  const ip = getClientIp(req);
  if (!checkRateLimit(`groups-ask-read:${ip}`, 240, HOUR)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }
  const session = await verifyLiveMemberAuth(req);
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  try {
    const { resource } = await getContainer('members').item(session.memberId, session.memberId).read<Member>();
    if (!resource || resource.active !== true) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    return NextResponse.json({ asks: await accountAsks(resource) });
  } catch (err) {
    console.error('GET /api/groups/ask failed:', err);
    return NextResponse.json({ error: 'read_failed' }, { status: 503 });
  }
}

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  if (!checkRateLimit(`groups-ask:${ip}`, 20, HOUR)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }
  const session = await verifyLiveMemberAuth(req);
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!isFlagOn('NEXT_PUBLIC_FLAG_MULTI_GROUP')) return NextResponse.json({ error: 'invite_not_found' }, { status: 404 });

  let body: { doorToken?: unknown; name?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name || name.length > MAX_JOIN_NAME) return NextResponse.json({ error: 'invalid_request' }, { status: 400 });

  // Per account as well as per caller: one person asking a club over and over
  // replaces one request, but should not be able to push the organiser a
  // notification a minute.
  if (!checkRateLimit(`groups-ask:member:${session.memberId}`, 6, HOUR)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }

  try {
    const groupId = await resolveClaimLink(body.doorToken);
    if (!groupId) return NextResponse.json({ error: 'invite_not_found' }, { status: 404 });
    const group = await readGroup(groupId);
    if (!group || group.closedAt) return NextResponse.json({ error: 'invite_not_found' }, { status: 404 });

    const outcome = await addAccountJoinRequest(groupId, session.memberId, name);
    if (!outcome) return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
    if (outcome.outcome === 'already_in') return NextResponse.json({ ok: true, alreadyIn: true, groupId, club: group.name });
    if (outcome.outcome === 'full') return NextResponse.json({ error: 'club_busy' }, { status: 409 });

    await notifyOrganisersOfJoinRequest(groupId, outcome.request.id, name);
    return NextResponse.json({ ok: true, groupId, club: group.name });
  } catch (err) {
    console.error('POST /api/groups/ask failed:', err);
    return NextResponse.json({ error: 'write_failed' }, { status: 503 });
  }
}
