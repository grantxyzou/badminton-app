import { NextRequest, NextResponse } from 'next/server';
import { isAdminAuthedWithMember, unauthorized } from '@/lib/auth';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import { getContainer } from '@/lib/cosmos';
import { issueRecoveryCode } from '@/lib/memberRecoveryCode';
import { appendEvent } from '@/lib/recoveryAudit';
import { resolveGroupId } from '@/lib/groupContext';
import { resolveActiveMemberId } from '@/lib/memberResolve';

export const dynamic = 'force-dynamic';

/**
 * Admin issues a PIN-reset code for a MEMBER (by name) — not a session player.
 *
 * Previously this required an active-session player record, so an admin could
 * only reset someone already signed up this week (the "but if they're signed
 * up why would they need a pin?" paradox). Recovery is an account-level
 * operation, so it now resolves the member directly and stores the code on the
 * member doc (durable across cold starts).
 */
export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  if (!checkRateLimit(`reset-access:${ip}`, 10, 60 * 60 * 1000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  if (!(await isAdminAuthedWithMember(req)).authed) return unauthorized();

  let body: { name?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) {
    return NextResponse.json({ error: 'Invalid name' }, { status: 400 });
  }

  // THE ADMIN'S OWN GROUP, not a search across clubs. This route is
  // admin-authed and an admin means the person on THEIR roster; the ambiguity
  // that `signInCandidates` exists for is a no-context sign-in, which this is
  // not. It mattered anyway: the code issued here CLEARS a PIN when it is
  // redeemed, so resolving `members[0]` on a name two clubs share would have
  // let one club's admin lock the other club's member out.
  const membersContainer = getContainer('members');
  const memberId = await resolveActiveMemberId(resolveGroupId(req), name);
  const { resource: found } = memberId
    ? await membersContainer.item(memberId, memberId).read()
    : { resource: undefined };
  const member = found ?? null;
  if (!member) {
    return NextResponse.json({ error: 'No account found for that name' }, { status: 404 });
  }

  const { code, stored } = await issueRecoveryCode();
  const updatedEvents = appendEvent(member.recoveryEvents, {
    event: 'reset-access-issued',
    at: new Date().toISOString(),
    admin: 'admin',
  });
  await membersContainer.items.upsert({
    ...member,
    recoveryCode: stored,
    recoveryEvents: updatedEvents,
  });

  return NextResponse.json({ code, expiresAt: stored.expiresAt });
}
