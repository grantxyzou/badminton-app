/**
 * POST /api/auth/password — add an email and password to the SIGNED-IN
 * member's own account.
 *
 * WHY THIS EXISTS
 * ---------------
 * The club's door link (docs/plans/door-link.md) lets a new person in on an
 * organiser's approval, with a 30-day session and nothing to sign in WITH
 * after it. Grant, 2026-11-07: "after approval create an account with Apple,
 * Gmail, or email n password". Apple and Google already link to a signed-in
 * account (`ProviderButtons mode="link"`); `POST /api/auth/signup` creates a
 * NEW member and refuses a name that is taken — which is every approved
 * person's own name. This is the missing third way.
 *
 * WHO: the `member_session` cookie, re-checked live (`verifyLiveMemberAuth`,
 * so "Sign out everywhere" and a removal bite). There is deliberately no
 * name or id in the body: a name-keyed version would let anyone put a
 * password on anyone's account.
 *
 * ONCE: a member who already has a password is refused (`password_exists`);
 * changing one is the reset flow, which proves the address first.
 *
 * THE ADDRESS is reserved before the member is written, the same order and
 * the same reason as signup (a member holding an address nothing reserved can
 * have it stolen by the next signup), and released if the write fails. It is
 * UNVERIFIED until the mailed link is redeemed, which is exactly what signup
 * grants: an unverified address never auto-links an OAuth identity.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getContainer } from '@/lib/cosmos';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import { verifyLiveMemberAuth } from '@/lib/auth';
import { hashPassword, validatePasswordStrength } from '@/lib/passwordHash';
import { createToken, VERIFICATION_TTL_MS } from '@/lib/authToken';
import { sendVerificationEmail } from '@/lib/authEmail';
import { normalizeEmail, isPlausibleEmail, reserveIdentity, releaseIdentity } from '@/lib/authIdentity';
import { outboundOriginOrNull } from '@/lib/appOrigin';
import type { Member } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  // Rule 4: rate limit first, before auth and before the body.
  const ip = getClientIp(req);
  if (!checkRateLimit(`auth-add-password:${ip}`, 5, 60 * 60 * 1000)) {
    return NextResponse.json({ error: 'rate_limited', retryAfter: 3600 }, { status: 429 });
  }

  const auth = await verifyLiveMemberAuth(req);
  if (!auth) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let body: { email?: unknown; password?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }
  const email = normalizeEmail(typeof body.email === 'string' ? body.email : '');
  const password = typeof body.password === 'string' ? body.password : '';
  if (!isPlausibleEmail(email)) return NextResponse.json({ error: 'invalid_email' }, { status: 400 });
  const strength = validatePasswordStrength(password);
  if (!strength.ok) {
    return NextResponse.json({ error: 'weak_password', reason: strength.reason }, { status: 400 });
  }

  const container = getContainer('members');
  let member: Member | undefined;
  try {
    ({ resource: member } = await container.item(auth.memberId, auth.memberId).read<Member>());
  } catch (err) {
    console.error('POST /api/auth/password read failed:', err);
    return NextResponse.json({ error: 'service_unavailable' }, { status: 503 });
  }
  if (!member || member.active !== true) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (typeof member.passwordHash === 'string' && member.passwordHash.length > 0) {
    return NextResponse.json({ error: 'password_exists' }, { status: 409 });
  }

  // A 409 here IS the uniqueness check (same-member re-reservation is
  // idempotent, so a retry after a failed write goes through).
  const reservation = await reserveIdentity('email', email, member.id);
  if (!reservation.ok) return NextResponse.json({ error: 'email_taken' }, { status: 409 });

  const previous = typeof member.email === 'string' ? normalizeEmail(member.email) : null;
  const verification = createToken(VERIFICATION_TTL_MS);
  try {
    const updated: Member = {
      ...member,
      email,
      emailVerified: false,
      passwordHash: await hashPassword(password),
      emailVerification: verification.record,
    };
    await container.items.upsert(updated);
  } catch (err) {
    // Free the address only if this call is what took it.
    if (previous !== email) await releaseIdentity('email', email);
    console.error('POST /api/auth/password write failed:', err);
    return NextResponse.json({ error: 'service_unavailable' }, { status: 503 });
  }
  // The old address no longer signs this member in; leaving it reserved would
  // keep it resolving to them and block it for whoever owns it.
  if (previous && previous !== email) await releaseIdentity('email', previous).catch(() => {});

  // Best-effort, never from the request's Host (see signup).
  let sent = false;
  const origin = outboundOriginOrNull();
  if (origin) {
    const verifyUrl = `${origin}/bpm/api/auth/verify-email?token=${verification.token}&email=${encodeURIComponent(email)}`;
    try {
      ({ sent } = await sendVerificationEmail(email, member.name, verifyUrl));
    } catch (err) {
      console.error('add-password verification mail failed:', err);
    }
  } else {
    console.error('add-password: APP_ORIGIN unset — skipping verification email');
  }

  return NextResponse.json({ ok: true, email, verificationSent: sent });
}
