/**
 * GET /api/auth/methods — what sign-in methods exist, for the calling member.
 *
 * Two independent questions, deliberately answered together because the UI
 * needs both to decide what to render:
 *
 * - `available`: which providers THIS DEPLOYMENT has credentials for. A build
 *   with Google but not Apple must show one button, not two, and certainly not
 *   a button that fails when tapped.
 * - `linked` / `hasPassword` / `hasPin`: what the CALLER already has. Drives the
 *   upgrade nudge, which must disappear the moment they have anything modern.
 *
 * Identity comes from the `member_session` cookie, never a name in the query
 * string. Names are enumerable, so a name-keyed version of this endpoint would
 * report any member's credential inventory to anyone who asked — a map of who
 * is easiest to attack.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getContainer } from '@/lib/cosmos';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import { isFlagOn } from '@/lib/flags';
import { verifyMemberAuth } from '@/lib/auth';
import { configuredProviders } from '@/lib/oauthProviders';
import { listIdentitiesForMember } from '@/lib/authIdentity';
import { shouldNudgeUpgrade } from '@/lib/authNudge';
import type { Member } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  if (!isFlagOn('NEXT_PUBLIC_FLAG_AUTH_PROVIDERS')) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const ip = getClientIp(req);
  if (!checkRateLimit(`auth-methods:${ip}`, 30, 60 * 1000)) {
    // Degraded, not empty: reporting "nothing available" would hide the
    // provider buttons and look like the feature is off. `available: null`
    // means UNKNOWN, and the UI renders nothing rather than a confident lie.
    return NextResponse.json({ available: null, linked: null });
  }

  const available = configuredProviders();
  const auth = verifyMemberAuth(req);
  if (!auth) {
    // Anonymous is a legitimate state, not an error: the sign-in surface needs
    // `available` to draw its buttons before anybody is signed in.
    return NextResponse.json({ available, linked: [], hasPassword: false, hasPin: false });
  }

  try {
    const { resource: member } = await getContainer('members')
      .item(auth.memberId, auth.memberId)
      .read<Member>();
    if (!member || member.active !== true) {
      return NextResponse.json({ available, linked: [], hasPassword: false, hasPin: false });
    }

    const identities = await listIdentitiesForMember(member.id);
    const linked = identities
      .filter((i) => i.provider === 'google' || i.provider === 'apple')
      .map((i) => i.provider);

    const hasPassword = typeof member.passwordHash === 'string' && member.passwordHash.length > 0;
    const hasPin = typeof member.pinHash === 'string' && member.pinHash.length > 0;

    return NextResponse.json({
      available,
      linked,
      hasPassword,
      hasPin,
      // Own record, so the narrow email canary permits returning it.
      email: member.email ?? null,
      emailVerified: member.emailVerified === true,
      nudge: shouldNudgeUpgrade({
        hasPin,
        hasPassword,
        linkedCount: linked.length,
        dismissedAt: member.authNudge?.dismissedAt ?? null,
      }),
    });
  } catch (err) {
    console.error('GET /api/auth/methods unhandled:', err);
    return NextResponse.json({ available: null, linked: null });
  }
}
