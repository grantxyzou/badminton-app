/**
 * POST /api/members/access-request — "I can't sign in. Let me in."
 *
 * UNAUTHENTICATED BY NECESSITY. Everything else member-scoped requires a
 * `member_session`; not having one is the entire condition this route exists to
 * resolve. What replaces auth is (a) a heavy IP rate limit, (b) a constant
 * response that reveals nothing about whether the name exists, and (c) the fact
 * that asking accomplishes nothing on its own — a human still has to approve.
 *
 * The response carries a SECRET held only by the asking device. Approval is
 * deliberately blind — Grant taps "let them in" without inspecting a device
 * string he has no way to verify — so without this, approving a request would
 * sign in whoever asked next rather than the person who asked. See
 * lib/accessRequest.ts.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getClientIp, checkRateLimit } from '@/lib/rateLimit';
import { resolveActiveMemberId } from '@/lib/memberResolve';
import { issueAccessRequest, MAX_OPEN_REQUESTS } from '@/lib/accessRequest';
import { updateAccessRequests } from '@/lib/accessRequestStore';
import { sendPushToMembers } from '@/lib/push';
import { rosterMembers } from '@/lib/roster';
import { resolveGroupId } from '@/lib/groupContext';

export const dynamic = 'force-dynamic';

const HOUR_MS = 60 * 60 * 1000;
const REQUESTS_PER_HOUR = 5;

export async function POST(req: NextRequest) {
  // Rule 4 — rate limit before anything else.
  const ip = getClientIp(req);
  if (!checkRateLimit(`access-request:${ip}`, REQUESTS_PER_HOUR, HOUR_MS)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }

  const body = await req.json().catch(() => null);
  const name = body && typeof body.name === 'string' ? body.name.trim() : '';
  if (!name || name.length > 80) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }

  try {
    // One group for the whole request: the name is resolved in it, so its
    // admins are the ones who can see and decide the request
    // (`app/api/admin/access-requests` narrows to the admin's own roster).
    const groupId = resolveGroupId(req);
    const memberId = await resolveActiveMemberId(groupId, name);
    const { secret, stored } = issueAccessRequest();

    if (memberId) {
      /**
       * EVERY ASK IS ITS OWN ENTRY. Nobody displaces anybody.
       *
       * This used to be one `accessRequest` per member, and it was lost both
       * ways round. Overwriting handed Grant's approval to whoever asked LAST;
       * the "first ask wins" fix that replaced it handed it to whoever asked
       * FIRST — a stranger who knows the name (enumerable via GET
       * /api/members) asks before Lin does, Lin's request is silently not
       * stored, and approving "Lin" signs the stranger in (security finding
       * F2). With a list, both requests stand, the admin sees two, and two is
       * exactly when approval is refused — see app/api/admin/access-requests.
       *
       * Past MAX_OPEN_REQUESTS the new ask is not stored. The response is the
       * same either way: refusing loudly would say a request is already open.
       */
      const result = await updateAccessRequests(memberId, (open) =>
        open.length >= MAX_OPEN_REQUESTS ? null : [...open, stored],
      );

      if (result) {
        const { member } = result;
        /**
         * Tell the admins. Best-effort and never able to fail the request —
         * same posture as the stringing notifier. If push is unconfigured or
         * nobody has opted in, the request still stands and shows up on the
         * Command Center next time an admin opens it.
         *
         * No money and no secret in the body, obviously; a lock screen is a
         * public surface. The name is the whole point of the notification.
         * The tag is per member, so a second ask replaces the banner rather
         * than stacking another.
         *
         * RECIPIENTS ARE THIS CLUB'S ROSTER, never a person-level role. This
         * used to pick every active `Member` with `role: 'admin'` across the
         * deployment. With groups on, rank lives on the MEMBERSHIP and
         * `Member.role` is only BPM's rollback copy, so that query told another
         * club's admins this person's name and missed an organiser whose rank
         * is on their membership alone. `rosterMembers` is flag-aware
         * (memberships with groups on, `Member.role` with them off) and maps
         * an organiser to `admin`, the same reading the join notice and the
         * stringing request notice use. `active` is re-checked in JS because
         * with groups off the roster is a members scan and the mock store
         * applies no WHERE. The asker is left out: they cannot sign in, so a
         * banner on their own phone would lead nowhere.
         */
        try {
          const roster = await rosterMembers(groupId);
          const adminIds = roster
            .filter((r) => r.member.role === 'admin' && r.member.active === true && r.member.id !== member.id)
            .map((r) => r.member.id);
          if (adminIds.length > 0) {
            await sendPushToMembers(adminIds, {
              title: 'Someone can’t sign in',
              body: `${member.name} is asking to be let in.`,
              url: `${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/?tab=admin`,
              tag: `access-${member.id}`,
            });
          }
        } catch (err) {
          console.error('access-request push failed:', err);
        }
      }
    }

    /**
     * THE SAME ANSWER EITHER WAY.
     *
     * A name that does not exist gets a secret too, and a 200. Member names are
     * enumerable through `GET /api/members`, so a route that said "no such
     * member" would turn that list into a membership oracle — and the device
     * holding a secret for a member that was never written simply never gets
     * approved, which is the correct outcome arrived at without telling anyone
     * anything.
     */
    return NextResponse.json({ ok: true, secret });
  } catch (err) {
    console.error('POST /api/members/access-request failed:', err);
    return NextResponse.json({ error: 'request_failed' }, { status: 503 });
  }
}
