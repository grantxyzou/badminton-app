/**
 * POST /api/auth/claim-ask — "Is that you?" without a PIN
 * (docs/plans/sign-in-redesign.md, step 3).
 *
 * A new sign-in (Apple, Google or an email code, parked in the pending-signup
 * cookie) chose a name someone already plays under. The first rung is their
 * PIN (`/api/auth/claim-name`). This route is the other two:
 *
 *   1. ANY PHONE WHERE THAT PERSON IS STILL SIGNED IN. The ask is stored on
 *      the person (an access request carrying the new sign-in, `link`), their
 *      phones get a push, and Home asks "Someone is signing in as you on a new
 *      phone. Is this you?" with three numbers; tapping the one the new phone
 *      shows approves (`/api/auth/new-phone`). The number is Google's and
 *      WhatsApp's guard against a reflex yes.
 *   2. AN ORGANIZER, only when they ask for one (`organizer: true`, which
 *      replaces this new phone's own waiting ask): it goes on the club's
 *      card, where an organizer's approval links it the same way.
 *
 * Either approval links the new sign-in to the account (`lib/linkSignIn.ts`),
 * so the waiting page signs straight in through the access-request claim, and
 * if it gave up, signing in again the same way lands on the account.
 *
 * HOW OFTEN (lib/newPhoneGuard.ts): one waiting ask per person, three a day,
 * none for a day after "No, it's not me" or a wrong number. A refusal stores
 * and sends nothing and answers like any other ask, so a stranger cannot keep
 * the prompt coming until it is tapped without reading.
 *
 * ONE ANSWER FOR EVERY NAME. A name nobody holds, or a link that no longer
 * works, gets the same `{ ok, secret, match, club }` and nothing is stored or
 * sent: the poll then reads `pending` until the seal runs out, as for anyone
 * still waiting (lib/askSecret.ts). The `name_taken` that led here already
 * said the name is a member's; this says nothing about their phones.
 */
import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import { readPendingSignup } from '@/lib/pendingSignup';
import { resolveActiveMemberId } from '@/lib/memberResolve';
import { resolveGroupId } from '@/lib/groupContext';
import { resolveClaimLink } from '@/lib/claimLinks';
import { isFlagOn } from '@/lib/flags';
import { issueAccessRequest, MAX_OPEN_REQUESTS } from '@/lib/accessRequest';
import { updateAccessRequests } from '@/lib/accessRequestStore';
import { sealAskSecret } from '@/lib/askSecret';
import { sendPushToMembers } from '@/lib/push';
import { buildNewPhonePayload, buildNewPhoneOrganizerPayload } from '@/lib/pushMessages';
import { rosterMembers } from '@/lib/roster';
import { mayAskNewPhone, noteAsked, mayPushOrganizers, noteOrganizersPushed } from '@/lib/newPhoneGuard';
import { padMissingAccount } from '@/lib/accountPad';

export const dynamic = 'force-dynamic';

const HOUR_MS = 60 * 60 * 1000;

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  if (!checkRateLimit(`claim-ask:ip:${ip}`, 10, HOUR_MS)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }

  const body = await req.json().catch(() => null);
  const name = body && typeof body.name === 'string' ? body.name.trim().slice(0, 50) : '';
  if (!name) return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  const organizer = body?.organizer === true;
  const inviteToken = typeof body?.inviteToken === 'string' && body.inviteToken.trim() ? body.inviteToken.trim().slice(0, 128) : null;

  if (!checkRateLimit(`claim-ask:${name.toLowerCase()}:${ip}`, 5, HOUR_MS)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }

  // The new sign-in being asked about. Only the browser that started it holds
  // this cookie (lib/pendingSignup.ts), so nobody can ask on another's behalf.
  const pending = readPendingSignup(req);
  if (!pending) return NextResponse.json({ error: 'no_pending_signup' }, { status: 400 });

  try {
    // The club the link names, as `claim-name` reads it: a signed-out browser
    // carries no club cookie of its own.
    let groupId: string | null = resolveGroupId(req);
    if (isFlagOn('NEXT_PUBLIC_FLAG_MULTI_GROUP') && inviteToken) {
      groupId = await resolveClaimLink(inviteToken);
    }
    const memberId = groupId ? await resolveActiveMemberId(groupId, name) : null;

    const link = { provider: pending.provider, sub: pending.sub, email: pending.email, emailVerified: pending.emailVerified };
    const issued = issueAccessRequest({ ...(groupId ? { groupId } : {}), link, organizer });

    if (memberId && groupId) {
      const now = Date.now();
      let pushOrganizers = false;
      const result = await updateAccessRequests(memberId, (open, member) => {
        // The phone's limits bind a phone ask only (lib/newPhoneGuard.ts).
        if (!organizer && !mayAskNewPhone(member.newPhoneLog, open, link, now)) return null;
        // One ask per new sign-in: asking again (or asking an organizer
        // instead) replaces the last one, so it cannot block itself.
        const others = open.filter((r) => !(r.link && r.link.provider === link.provider && r.link.sub === link.sub));
        if (others.length >= MAX_OPEN_REQUESTS) return null;
        pushOrganizers = organizer && mayPushOrganizers(member.newPhoneLog, now);
        const newPhoneLog = organizer
          ? pushOrganizers
            ? noteOrganizersPushed(member.newPhoneLog, now)
            : member.newPhoneLog ?? []
          : noteAsked(member.newPhoneLog, now);
        return { requests: [...others, issued.stored], patch: { newPhoneLog } };
      });
      // Not awaited: how long a push fan-out takes would say how many phones
      // the person has (security review, 2026-11-20).
      if (!result) {
        // A refusal pays the write a stored ask does, so it reads like one.
        await padMissingAccount(1);
      } else {
        if (organizer) {
          if (pushOrganizers) void tellOrganizers(groupId, memberId, name);
        } else
          void Promise.resolve()
            .then(() => sendPushToMembers([memberId], (locale) => buildNewPhonePayload(locale)))
            .catch((err) => console.error('claim-ask push failed:', err));
      }
    } else {
      // The reads and the write a real person's ask does (gap 3).
      await padMissingAccount();
    }

    return NextResponse.json({
      ok: true,
      secret: sealAskSecret(issued.secret),
      match: issued.stored.match,
      club: groupId,
    });
  } catch (err) {
    console.error('POST /api/auth/claim-ask failed:', err);
    return NextResponse.json({ error: 'request_failed' }, { status: 503 });
  }
}

/** The club's ORGANIZERS hear it: only an organizer may approve a new sign-in
 *  onto someone (with groups off, every admin is one). */
async function tellOrganizers(groupId: string, memberId: string, name: string): Promise<void> {
  try {
    const adminIds = (await rosterMembers(groupId))
      .filter(({ member: m, membership }) => (membership ? membership.role === 'owner' : m.role === 'admin') && m.id !== memberId)
      .map(({ member: m }) => m.id);
    if (adminIds.length > 0) {
      await sendPushToMembers(adminIds, (locale) => buildNewPhoneOrganizerPayload(name, memberId, locale));
    }
  } catch (err) {
    console.error('claim-ask organizer push failed:', err);
  }
}
