/**
 * `GET /api/groups/invite` — the club's LIVE one-time invites (newest first).
 * `POST /api/groups/invite` — make a new one.
 * `DELETE /api/groups/invite` — revoke one, by `{ id }`.
 *
 * docs/plans/one-time-invites.md. Each invite is a link and a code that
 * admit one person, once, within seven days; the admin makes one per person.
 *
 * Admin-gated on EVERY verb, and on the ASYNC check even for the read. This
 * departs from the repo's read-only-routes-may-use-the-sync-gate convention
 * (CLAUDE.md's read/write admin asymmetry) on purpose: the sync check verifies
 * a cookie's signature and expiry and nothing else, and what this route returns
 * is live bearer credentials for a club. A demoted admin holding a 30-day
 * cookie must not be able to read them out on their way out of the door.
 */
import { NextRequest, NextResponse } from 'next/server';
import { isAdminAuthedWithMember, unauthorized } from '@/lib/auth';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import { listInvites, mintInvite, revokeInvite } from '@/lib/invites';
import { invitesOn, featureOff, rateLimited } from '@/lib/groupRoutes';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const ip = getClientIp(req);
  if (!checkRateLimit(`groups-invite-read:${ip}`, 60, 15 * 60 * 1000)) return rateLimited();
  if (!invitesOn()) return featureOff();
  const auth = await isAdminAuthedWithMember(req);
  if (!auth.authed) return unauthorized();

  try {
    return NextResponse.json({ invites: await listInvites(auth.groupId) });
  } catch (error) {
    console.error('GET /api/groups/invite:', error);
    return NextResponse.json({ error: 'invite_failed' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  // Enough for an evening of onboarding, too few to mint a pile of live links.
  if (!checkRateLimit(`groups-invite:${ip}`, 30, 60 * 60 * 1000)) return rateLimited();
  if (!invitesOn()) return featureOff();
  const auth = await isAdminAuthedWithMember(req);
  if (!auth.authed) return unauthorized();

  try {
    const invite = await mintInvite(auth.groupId, auth.memberId);
    if (!invite) return NextResponse.json({ error: 'not_found' }, { status: 404 });
    return NextResponse.json(invite, { status: 201 });
  } catch (error) {
    console.error('POST /api/groups/invite:', error);
    return NextResponse.json({ error: 'invite_failed' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const ip = getClientIp(req);
  if (!checkRateLimit(`groups-invite:${ip}`, 30, 60 * 60 * 1000)) return rateLimited();
  if (!invitesOn()) return featureOff();
  const auth = await isAdminAuthedWithMember(req);
  if (!auth.authed) return unauthorized();

  let id: unknown;
  try {
    id = ((await req.json()) as { id?: unknown })?.id;
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }
  if (typeof id !== 'string' || !/^invite:[0-9a-f]{64}$/.test(id)) {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  try {
    // Scoped to the CALLER's club: an id another club holds answers 404 here.
    const ok = await revokeInvite(auth.groupId, id);
    if (!ok) return NextResponse.json({ error: 'not_found' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('DELETE /api/groups/invite:', error);
    return NextResponse.json({ error: 'invite_failed' }, { status: 500 });
  }
}
