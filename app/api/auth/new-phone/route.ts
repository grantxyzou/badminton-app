/**
 * GET / POST /api/auth/new-phone — "Someone is signing in as you on a new
 * phone. Is this you?" (docs/plans/sign-in-redesign.md, step 3).
 *
 * The second rung of "Is that you?": a new sign-in asked under this person's
 * name (`/api/auth/claim-ask`), and any phone where they are still signed in
 * answers. GET lists the waiting asks with three numbers each; POST answers
 * one. Tapping the number the new phone shows links the new sign-in to this
 * account (`lib/linkSignIn.ts`) and approves the ask, so the new phone signs
 * in. A wrong number, or "No, it's not me", ends the ask: the new phone keeps
 * waiting until it gives up or asks an organizer, and learns nothing.
 *
 * Only the person themselves: the live member cookie, re-read (a phone signed
 * out everywhere, or a removed member, is refused), and only asks stored on
 * THEIR account. No admin branch: an organizer answers on the club's card.
 */
import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import { verifyLiveMemberAuth } from '@/lib/auth';
import { getContainer } from '@/lib/cosmos';
import { openRequests, type StoredAccessRequest } from '@/lib/accessRequest';
import { updateAccessRequests } from '@/lib/accessRequestStore';
import { linkSignInTo } from '@/lib/linkSignIn';
import { noteStopped } from '@/lib/newPhoneGuard';
import type { Member } from '@/lib/types';

export const dynamic = 'force-dynamic';

const HOUR_MS = 60 * 60 * 1000;

type Waiting = StoredAccessRequest & { id: string; link: NonNullable<StoredAccessRequest['link']>; choices: number[]; match: number };

function waiting(r: StoredAccessRequest & { id: string }): r is Waiting {
  return !!r.link && r.approvedAt === undefined && Array.isArray(r.choices) && typeof r.match === 'number';
}

export async function GET(req: NextRequest) {
  const ip = getClientIp(req);
  if (!checkRateLimit(`new-phone:list:${ip}`, 240, HOUR_MS)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }
  const caller = await verifyLiveMemberAuth(req);
  if (!caller) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  try {
    const { resource: member } = await getContainer('members').item(caller.memberId, caller.memberId).read<Member>();
    const asks = openRequests(member)
      .filter(waiting)
      .map((r) => ({
        id: r.id,
        // How the new phone signed in, so they can tell whether it is theirs.
        provider: r.link.provider,
        email: typeof r.link.email === 'string' ? r.link.email : null,
        choices: r.choices,
      }));
    return NextResponse.json({ asks });
  } catch (err) {
    console.error('GET /api/auth/new-phone failed:', err);
    return NextResponse.json({ error: 'read_failed' }, { status: 503 });
  }
}

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  if (!checkRateLimit(`new-phone:answer:${ip}`, 30, HOUR_MS)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }
  const caller = await verifyLiveMemberAuth(req);
  if (!caller) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => null);
  const id = body && typeof body.id === 'string' ? body.id : '';
  const notMe = body?.notMe === true;
  const pick = typeof body?.pick === 'number' ? body.pick : null;
  if (!id || (!notMe && pick === null)) return NextResponse.json({ error: 'invalid_request' }, { status: 400 });

  try {
    // Read the ask; a wrong number or "not me" ends it in the same write.
    let target: Waiting | null = null;
    let stopped = false;
    await updateAccessRequests(caller.memberId, (open, member) => {
      const found = open.find((r) => r.id === id);
      if (!found || !waiting(found)) return null;
      target = found;
      if (notMe || pick !== found.match) {
        // Ended, and no new ask for a day (lib/newPhoneGuard.ts).
        stopped = true;
        return { requests: open.filter((r) => r.id !== id), patch: { newPhoneLog: noteStopped(member.newPhoneLog) } };
      }
      return null; // the right number: link first, approve below
    });
    if (!target) return NextResponse.json({ error: 'not_found' }, { status: 404 });
    if (stopped) return NextResponse.json({ ok: true, outcome: 'stopped' });
    const ask: Waiting = target;

    const linked = await linkSignInTo(caller.memberId, ask.link);
    if (!linked.ok) {
      // That sign-in already belongs to another account: nothing to approve.
      await updateAccessRequests(caller.memberId, (open) => open.filter((r) => r.id !== id));
      return NextResponse.json({ ok: true, outcome: 'already_linked' });
    }
    await updateAccessRequests(caller.memberId, (open) =>
      open.some((r) => r.id === id) ? open.map((r) => (r.id === id ? { ...r, approvedAt: Date.now() } : r)) : null,
    );
    return NextResponse.json({ ok: true, outcome: 'approved' });
  } catch (err) {
    console.error('POST /api/auth/new-phone failed:', err);
    return NextResponse.json({ error: 'write_failed' }, { status: 503 });
  }
}
