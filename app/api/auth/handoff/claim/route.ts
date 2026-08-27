/**
 * POST /api/auth/handoff/claim — the PWA collects a sign-in that completed in
 * another storage context.
 *
 * This is the half of the iOS-PWA fix that runs back INSIDE the app. The OAuth
 * excursion finished in Safari and parked the resolved member against
 * `sha256(handoffId)`; this route takes the PREIMAGE, redeems it, and mints
 * `member_session` on ITS OWN response — which, because the app called it
 * same-origin from its own webview, lands in the jar that was missing one.
 *
 * See lib/authHandoff.ts for why holding the ref is not enough to claim, and
 * why that is what keeps login CSRF closed.
 */
import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import { isFlagOn } from '@/lib/flags';
import { getContainer } from '@/lib/cosmos';
import { claimHandoff } from '@/lib/authHandoff';
import { completeSignIn } from '@/lib/authSession';
import type { Member } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  if (!isFlagOn('NEXT_PUBLIC_FLAG_AUTH_PROVIDERS')) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  // Rate limit BEFORE anything else (security rule 4). The claim is a
  // guessable-shaped endpoint — 32 bytes of entropy make guessing hopeless, but
  // a limiter keeps a flood from becoming a Cosmos bill.
  const ip = getClientIp(req);
  if (!checkRateLimit(`handoff-claim:${ip}`, 60, 60 * 60 * 1000)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }

  let handoffId: unknown;
  try {
    ({ handoffId } = await req.json());
  } catch {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }
  if (typeof handoffId !== 'string' || !/^[0-9a-f]{64}$/.test(handoffId)) {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }

  const claim = await claimHandoff(handoffId);

  /* `pending` is reported so the app can keep polling. It is the COMMON state,
     not a rare one: the person is still on Google's consent screen. Collapsing
     it into `none` would make the app give up on every in-flight sign-in. */
  if (claim.status === 'pending') {
    return NextResponse.json({ status: 'pending' }, { status: 200 });
  }
  if (claim.status === 'none') {
    // Absent, expired and already-claimed are one answer on purpose.
    return NextResponse.json({ status: 'none' }, { status: 200 });
  }

  const { resource: member } = await getContainer('members')
    .item(claim.memberId, claim.memberId)
    .read<Member>();
  // The stash is already consumed at this point, which is correct: a member
  // deactivated mid-flow must not leave a live stash behind to retry against.
  if (!member || member.active !== true) {
    return NextResponse.json({ status: 'none' }, { status: 200 });
  }

  const res = NextResponse.json({
    status: 'ready',
    name: member.name,
    // The client mirrors identity into localStorage; it needs the same shape
    // the PIN path returns. `deleteToken` is deliberately absent — this is a
    // sign-in, not a session sign-up (see the auth taxonomy in CLAUDE.md).
    memberId: member.id,
  });
  completeSignIn(res, member);
  return res;
}
