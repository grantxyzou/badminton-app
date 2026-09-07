/**
 * POST /api/members/access-request — "I can't sign in. Let me in."
 *
 * UNAUTHENTICATED BY NECESSITY. Everything else member-scoped requires a
 * `member_session`; not having one is the entire condition this route exists to
 * resolve. What replaces auth is (a) a heavy IP rate limit, (b) a constant
 * response that reveals nothing about whether the name exists, and (c) the fact
 * that asking accomplishes nothing on its own — a human still has to approve.
 *
 * The response carries a SECRET held only by the asking device. Approval is by
 * name and deliberately blind — Grant taps "let them in" without inspecting a
 * device string he has no way to verify — so without this, approving a request
 * would sign in whoever asked next rather than the person who asked. See
 * lib/accessRequest.ts.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getContainer } from '@/lib/cosmos';
import { getClientIp, checkRateLimit } from '@/lib/rateLimit';
import { resolveActiveMemberId } from '@/lib/memberResolve';
import { issueAccessRequest, isPending } from '@/lib/accessRequest';
import { sendPushToMembers } from '@/lib/push';
import { isFlagOn } from '@/lib/flags';
import type { Member } from '@/lib/types';

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
    const memberId = await resolveActiveMemberId(name);
    const { secret, stored } = issueAccessRequest();

    if (memberId) {
      const container = getContainer('members');
      const { resource: member } = await container.item(memberId, memberId).read<Member>();
      if (member) {
        /**
         * FIRST ASK WINS. Do not overwrite a request that is still open.
         *
         * `accessRequest` is a single object, and approval is by NAME — the
         * admin sees "Lin" and taps, with no way to tell which device is
         * behind it. So an overwrite hands the approval to whoever asked LAST:
         * Lin asks, anyone who knows the name (they are enumerable through
         * GET /api/members) asks again before Grant taps, and the approval
         * mints a session for the second device. Lin's own poll then reports
         * `none`, indistinguishable from an expired request.
         *
         * That is full account takeover — the claim mints `member_session`,
         * which `PATCH /api/members/me` accepts as proof for a first-PIN set —
         * and it defeats the exact property this file's header calls
         * load-bearing. Every test wrote one request per name, so none of them
         * could see it.
         *
         * The response shape is unchanged: the second caller still gets a
         * secret and a 200, it simply will never match. Refusing loudly here
         * would leak that a request is already open for this name.
         */
        if (isPending(member.accessRequest)) {
          return NextResponse.json({ ok: true, secret });
        }
        await container.items.upsert({ ...member, accessRequest: stored });

        /**
         * Tell the admins. Best-effort and never able to fail the request —
         * same posture as the stringing notifier. If push is unconfigured or
         * nobody has opted in, the request still stands and shows up on the
         * Command Center next time an admin opens it.
         *
         * No money and no secret in the body, obviously; a lock screen is a
         * public surface. The name is the whole point of the notification.
         */
        if (isFlagOn('NEXT_PUBLIC_FLAG_PUSH_NOTIFY')) {
          try {
            const { resources: admins } = await container.items
              .query<Member>({
                query: "SELECT * FROM c WHERE c.role = 'admin' AND c.active = true",
                parameters: [],
              })
              .fetchAll();
            /* Re-filtered in JS. The mock store matches on parameter NAMES
               and this query binds none, so `c.role = 'admin'` is invisible to
               it — under the mock every active member comes back, and
               "tell the admins" would broadcast one person's lockout to the
               whole club. Production Cosmos honours the WHERE; the test
               environment is the one that needs this line. */
            const adminIds = admins
              .filter((a) => a.role === 'admin' && a.active === true)
              .map((a) => a.id)
              .filter(Boolean);
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
