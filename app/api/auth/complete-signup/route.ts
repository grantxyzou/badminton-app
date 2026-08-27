/**
 * POST /api/auth/complete-signup — turn a pending provider identity into a
 * Member, once the user has chosen a display name.
 *
 * This is the ONLY place a provider identity becomes an account. The callback
 * deliberately cannot do it: resolution rule 4 needs a name from the user, and
 * must refuse names that already belong to someone.
 *
 * THE PROVIDER FACTS COME FROM THE SIGNED COOKIE, NEVER THE BODY. The body
 * supplies exactly one thing — the chosen name. If `sub` or `email` were
 * accepted from the request, anyone could POST a provider identity they do not
 * own and claim the linked account.
 */
import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { getContainer } from '@/lib/cosmos';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import { isFlagOn } from '@/lib/flags';
import { completeSignIn } from '@/lib/authSession';
import { resolveActiveMemberId } from '@/lib/memberResolve';
import { reserveIdentity, releaseIdentity } from '@/lib/authIdentity';
import { readPendingSignup, clearPendingSignup } from '@/lib/pendingSignup';
import { completeHandoff } from '@/lib/authHandoff';
import type { Member } from '@/lib/types';

export const dynamic = 'force-dynamic';

/**
 * GET — what the pending signup can safely tell the client.
 *
 * ONLY the suggested name. The `sub` and `email` stay inside the signed,
 * HttpOnly cookie: they are the facts POST trusts when it reserves an identity,
 * and handing them to the client would invite a UI that posts them back.
 *
 * This endpoint exists because Apple's name is otherwise unreachable. Apple
 * sends it on the FIRST authorization only, the callback parks it in a cookie
 * the browser cannot read, and without a way to read it back the name Apple
 * will never send again would be silently discarded at the moment we ask the
 * user to type one.
 */
export async function GET(req: NextRequest) {
  if (!isFlagOn('NEXT_PUBLIC_FLAG_AUTH_PROVIDERS')) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  // Rate limited like every other handler here. Generous (60/hr) because it is
  // read-only and returns only a name from a cookie the caller already holds --
  // but the project rule is "rate limit first in every handler", and an
  // unlimited endpoint is worth flagging even when the exposure is small.
  const ip = getClientIp(req);
  if (!checkRateLimit(`auth-pending:${ip}`, 60, 60 * 60 * 1000)) {
    return NextResponse.json({ pending: false, suggestedName: null });
  }

  const pending = readPendingSignup(req);
  if (!pending) return NextResponse.json({ pending: false, suggestedName: null });
  return NextResponse.json({
    pending: true,
    provider: pending.provider,
    suggestedName: pending.suggestedName ?? null,
  });
}

export async function POST(req: NextRequest) {
  if (!isFlagOn('NEXT_PUBLIC_FLAG_AUTH_PROVIDERS')) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const ip = getClientIp(req);
  if (!checkRateLimit(`auth-complete:${ip}`, 10, 60 * 60 * 1000)) {
    return NextResponse.json({ error: 'rate_limited', retryAfter: 3600 }, { status: 429 });
  }

  const pending = readPendingSignup(req);
  if (!pending) {
    // Expired (10 min), tampered with, or never existed. All the same answer —
    // start the provider flow again.
    return NextResponse.json({ error: 'no_pending_signup' }, { status: 400 });
  }

  let body: { name?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 50) : '';
  if (!name) return NextResponse.json({ error: 'invalid_request' }, { status: 400 });

  // A taken name is a REFUSAL with an instruction, not a silent link. Names are
  // enumerable via GET /api/members, so linking on a name match would be
  // account takeover by anyone who can read that list.
  if (await resolveActiveMemberId(name)) {
    return NextResponse.json({ error: 'name_taken' }, { status: 409 });
  }

  const memberId = `member-${randomBytes(8).toString('hex')}`;

  // Reserve the provider identity first, then the email, then write the member
  // — releasing everything reserved so far if a later step fails. Same ordering
  // argument as /api/auth/signup: a reservation with no member blocks one key
  // and belongs to nobody, whereas a member with an unreserved key can have it
  // stolen by the next signup.
  const reservedProvider = await reserveIdentity(pending.provider, pending.sub, memberId);
  if (!reservedProvider.ok) {
    return NextResponse.json({ error: 'already_linked' }, { status: 409 });
  }

  // Only claim the address when the provider verified it. An unverified address
  // must not reserve `email:<addr>`, or a provider account with an arbitrary
  // unconfirmed address could squat the real owner's future signup.
  const claimEmail = pending.email && pending.emailVerified ? pending.email : null;
  if (claimEmail) {
    const reservedEmail = await reserveIdentity('email', claimEmail, memberId);
    if (!reservedEmail.ok) {
      await releaseIdentity(pending.provider, pending.sub);
      return NextResponse.json({ error: 'email_taken' }, { status: 409 });
    }
  }

  try {
    const member: Member = {
      id: memberId,
      name,
      role: 'member',
      sessionCount: 0,
      active: true,
      createdAt: new Date().toISOString(),
      linkedProviders: [pending.provider],
      ...(claimEmail ? { email: claimEmail, emailVerified: true } : {}),
    };
    await getContainer('members').items.create(member);

    /* The PWA case: this response's cookies are being issued to Safari, so
       park the member the app can collect instead. Without this a brand-new
       Google account signs in everywhere EXCEPT the app that started it —
       the same jar split as the sign-in path, one step later. */
    if (pending.handoff) {
      try {
        await completeHandoff(pending.handoff, memberId);
      } catch (err) {
        console.error('handoff complete (signup) failed:', err);
      }
    }

    const res = NextResponse.json(
      { id: memberId, name, email: claimEmail, provider: pending.provider },
      { status: 201 },
    );
    // ORDER: every `cookies.set` must happen BEFORE completeSignIn. Its
    // clearAdminCookie branch APPENDS raw Set-Cookie headers, and a later
    // `.set()` re-serializes the whole cookie map and silently drops them --
    // leaving a stale admin_session alive for a non-admin. Verified, and
    // pinned by __tests__/auth-cookie-order.test.ts.
    clearPendingSignup(res);
    completeSignIn(res, member);
    return res;
  } catch (err) {
    await releaseIdentity(pending.provider, pending.sub);
    if (claimEmail) await releaseIdentity('email', claimEmail);
    console.error('POST /api/auth/complete-signup failed after reservation:', err);
    return NextResponse.json({ error: 'service_unavailable' }, { status: 503 });
  }
}
