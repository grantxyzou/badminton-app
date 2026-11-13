/**
 * GET  /api/admin/access-requests — who is waiting to be let in.
 * POST /api/admin/access-requests — let one request in, or clear a person's.
 *
 * Approval is deliberately BLIND: no device string, no IP, no location. Those
 * would be theatre — Grant has no way to verify any of them, and showing
 * unverifiable detail next to an approve button makes a decision feel checked
 * when it was not. What actually secures this is that he knows his club and the
 * request arrives while the person is usually standing in front of him.
 *
 * The safety net is elsewhere: each request is device-bound by a secret, so
 * approving lets in the device that ASKED and nobody else, and it expires in an
 * hour.
 *
 * TWO REQUESTS FOR ONE PERSON CANNOT BE APPROVED (security finding F2).
 * Blind approval is only safe when there is exactly one thing to approve. If a
 * stranger asked under Lin's name as well, the two rows are indistinguishable —
 * by design, per the paragraph above — so an approve button on either is a coin
 * flip over who gets Lin's account. The list says how many devices asked, and
 * the only action on more than one is to clear them all and have the person ask
 * again. Counted over OPEN requests, approved-but-unclaimed included: a second
 * ask landing in the seconds between Grant's tap and Lin's phone collecting it
 * must not read as a fresh single request.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getContainer } from '@/lib/cosmos';
import { isAdminAuthed, isAdminAuthedWithMember } from '@/lib/auth';
import { getClientIp, checkRateLimit } from '@/lib/rateLimit';
import { openRequests, pendingRequests } from '@/lib/accessRequest';
import { updateAccessRequests } from '@/lib/accessRequestStore';
import { resolveGroupId } from '@/lib/groupContext';
import { rosterMemberIds } from '@/lib/roster';
import type { Member } from '@/lib/types';
import { isUnclaimed } from '@/lib/claimLinks';
import type { StoredAccessRequest } from '@/lib/accessRequest';
import { approveJoinRequest, declineJoinRequest, pendingJoinRequests } from '@/lib/joinRequests';
import { readGroup, rosterNameHolder } from '@/lib/groups';
import { noticeClubOfJoin, tellJoinerTheyAreIn } from '@/lib/joinNotify';

/**
 * Whether an ask is THIS club's. A request older than the field carries no
 * club and stays with whichever club's roster holds the person — the narrowing
 * that was the whole rule before (docs/plans/claim-your-name.md).
 */
const askedIn = (r: StoredAccessRequest, groupId: string): boolean => r.groupId === undefined || r.groupId === groupId;

export const dynamic = 'force-dynamic';

const HOUR_MS = 60 * 60 * 1000;

export async function GET(req: NextRequest) {
  const ip = getClientIp(req);
  if (!checkRateLimit(`access-list:${ip}`, 120, HOUR_MS)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }
  // Read-only, but it also answers whether THIS admin is an organiser, which
  // only the membership can say: through the door link only an organiser lets
  // anyone in (docs/plans/door-link.md), and the card must not offer an
  // Approve it will refuse. The sync check stays first, so a stranger costs
  // no read.
  if (!isAdminAuthed(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const admin = await isAdminAuthedWithMember(req);
  if (!admin.authed) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  try {
    // `members` is a PERSON container: a request lives on the person, and
    // nothing on the row says which club they asked. Only the ROSTER can
    // separate them, so the list is narrowed to the admin's club (the same
    // rule as the sign-in readiness list beside it). With one club this is
    // every member; with two, one club's admin would otherwise see — and
    // could approve — the other club's requests by name.
    const groupId = resolveGroupId(req);
    const roster = await rosterMemberIds(groupId);
    const { resources } = await getContainer('members')
      .items.query<Member>({
        // Both fields: a doc written before one-per-device still carries the
        // single `accessRequest`, and Cosmos would not return it otherwise.
        query: 'SELECT * FROM c WHERE IS_DEFINED(c.accessRequest) OR IS_DEFINED(c.accessRequests)',
        parameters: [],
      })
      .fetchAll();

    /* Re-filtered in JS. The mock store ignores the WHERE clause entirely — it
       matches on parameter NAMES, and this query binds none — so the predicate
       above is production-only and this line is what actually holds under
       test. Expiry has to be evaluated here regardless: it is a timestamp
       comparison, not a field the query can express. */
    const waiting = resources
      .filter((m) => roster.has(m.id))
      // Only the asks made FOR this club (docs/plans/claim-your-name.md). A
      // person on two rosters may ask in either; one club's organiser never
      // sees, or approves, the other's. A request from before the field has
      // no club and is seen by the roster's (the rule before).
      .map((m) => ({ m, open: openRequests(m), pending: pendingRequests(m).filter((r) => askedIn(r, groupId)) }))
      .filter(({ pending }) => pending.length > 0)
      .map(({ m, open, pending }) => ({
        memberId: m.id,
        name: m.name,
        at: Math.min(...pending.map((r) => r.expiresAt)),
        count: open.length,
        // Only a lone request is approvable, so only a lone request has an id
        // to approve by.
        requestId: open.length === 1 ? pending[0].id : null,
        // What the card says beside the name: asked with the club's claim
        // link, and nobody has ever signed in under it.
        viaLink: pending.some((r) => r.via === 'link'),
        neverSignedIn: isUnclaimed(m),
      }))
      .sort((a, b) => a.at - b.at);

    // People asking to JOIN through the door link: on the club, not on a
    // person. `nameTaken` lets the card say so before anyone taps Approve.
    const group = await readGroup(groupId);
    const joins = await Promise.all(
      pendingJoinRequests(group).map(async (r) => ({
        joinRequestId: r.id,
        name: r.name,
        at: r.expiresAt,
        // Asked signed in (step 4): approving adds that account, nothing new is made.
        signedIn: typeof r.askedBy === 'string',
        nameTaken: (await rosterNameHolder(groupId, r.name)) !== null,
      })),
    );
    joins.sort((a, b) => a.at - b.at);

    return NextResponse.json({ requests: waiting, joins, organiser: admin.organiser });
  } catch (err) {
    console.error('GET /api/admin/access-requests failed:', err);
    return NextResponse.json({ error: 'read_failed' }, { status: 503 });
  }
}

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  if (!checkRateLimit(`access-approve:${ip}`, 60, HOUR_MS)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }
  // Mutating: re-reads the member and re-checks the role, so a demotion takes
  // effect immediately.
  const admin = await isAdminAuthedWithMember(req);
  if (!admin.authed) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => null);

  // A JOIN through the door link (docs/plans/door-link.md). Organisers only
  // (Grant, 2026-11-05), in either direction: declining is a decision about
  // who comes in too.
  const joinRequestId = body && typeof body.joinRequestId === 'string' ? body.joinRequestId : '';
  if (joinRequestId) {
    const decision = body?.decision;
    if (decision !== 'approve' && decision !== 'decline') {
      return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
    }
    if (!admin.organiser) return NextResponse.json({ error: 'organiser_only' }, { status: 403 });
    try {
      if (decision === 'decline') {
        return (await declineJoinRequest(admin.groupId, joinRequestId))
          ? NextResponse.json({ ok: true })
          : NextResponse.json({ error: 'not_found' }, { status: 404 });
      }
      // A regular or a drop-in (docs/plans/one-way-in.md, step 4): the
      // organiser says which, so a stranger never gets members-first priority
      // by default. Absent reads as a drop-in, the old behaviour.
      const regular = body?.regular === true;
      const result = await approveJoinRequest(admin.groupId, joinRequestId, Date.now(), { regular });
      if (result.outcome === 'approved') {
        // The whole club hears it on the Notifications page (no push), and
        // the person who asked hears it by email and push.
        await noticeClubOfJoin(admin.groupId, { id: result.memberId, name: result.name });
        await tellJoinerTheyAreIn(admin.groupId, result.memberId);
        return NextResponse.json({ ok: true });
      }
      if (result.outcome === 'name_taken') return NextResponse.json({ error: 'name_taken' }, { status: 409 });
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    } catch (err) {
      console.error('POST /api/admin/access-requests (join) failed:', err);
      return NextResponse.json({ error: 'write_failed' }, { status: 503 });
    }
  }

  const memberId = body && typeof body.memberId === 'string' ? body.memberId : '';
  const requestId = body && typeof body.requestId === 'string' ? body.requestId : '';
  const decision = body?.decision;
  if (
    !memberId ||
    (decision !== 'approve' && decision !== 'decline') ||
    (decision === 'approve' && !requestId)
  ) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }

  try {
    // Same narrowing as the list: a person off this club's roster answers the
    // same 404 as one with no request, so the route says nothing about whether
    // they exist elsewhere.
    if (!(await rosterMemberIds(admin.groupId)).has(memberId)) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }
    let refusal: 'not_found' | 'several_requests' | 'organiser_only' | 'already_claimed' | null = null;

    const result = await updateAccessRequests(memberId, (open, member) => {
      if (decision === 'decline') {
        // Declining clears every open request for the person IN THIS CLUB
        // (another club's asks stand). The asking devices then poll into
        // `none` and are told to try again or find the organiser in person —
        // there is no "you were refused" state, because there is nothing
        // useful to do with one.
        const mine = open.filter((r) => askedIn(r, admin.groupId));
        if (mine.length === 0) { refusal = 'not_found'; return null; }
        return open.filter((r) => !askedIn(r, admin.groupId));
      }
      // An ask for ANOTHER club is not this organiser's to approve, even for a
      // person on both rosters: it signs the device in to the club it names.
      const target = open.find((r) => r.id === requestId && r.approvedAt === undefined && askedIn(r, admin.groupId));
      if (!target) { refusal = 'not_found'; return null; }
      // An ask through the club's door link is an organiser's to approve,
      // whoever it is for (Grant, 2026-11-05: "Organisers only").
      if (target.via === 'link' && !admin.organiser) { refusal = 'organiser_only'; return null; }
      // The link admits only an UNCLAIMED name, and that was checked when the
      // ask was made. If the person has since set a PIN, a password or a
      // provider, the real owner is in, and approving would hand a stranger's
      // phone their account (audit, 2026-11-05).
      if (target.via === 'link' && !isUnclaimed(member)) { refusal = 'already_claimed'; return null; }
      // Re-checked at write time, not trusted from the list the admin saw: a
      // second ask may have landed since.
      if (open.length > 1) { refusal = 'several_requests'; return null; }
      return [{ ...target, approvedAt: Date.now() }];
    });

    if (refusal === 'organiser_only') {
      return NextResponse.json({ error: 'organiser_only' }, { status: 403 });
    }
    if (refusal === 'already_claimed') {
      return NextResponse.json({ error: 'already_claimed' }, { status: 409 });
    }
    if (refusal === 'several_requests') {
      return NextResponse.json({ error: 'several_requests' }, { status: 409 });
    }
    if (!result) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('POST /api/admin/access-requests failed:', err);
    return NextResponse.json({ error: 'write_failed' }, { status: 503 });
  }
}
