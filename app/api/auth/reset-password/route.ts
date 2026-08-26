/**
 * POST /api/auth/reset-password — redeem a reset link and set a new password.
 *
 * Signs the user in on success. They have just proven control of the mailbox
 * the account is bound to, which is the same standard the PIN path uses; making
 * them immediately sign in again with the password they set four seconds ago is
 * friction with no security value.
 *
 * ORDER MATTERS: password strength is validated BEFORE the token is consumed.
 * A rejected-for-being-too-short attempt must not burn the user's only link —
 * they would have to request another one to fix a typo.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getContainer } from '@/lib/cosmos';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import { isFlagOn } from '@/lib/flags';
import { hashPassword, validatePasswordStrength } from '@/lib/passwordHash';
import { checkToken } from '@/lib/authToken';
import { completeSignIn } from '@/lib/authSession';
import { normalizeEmail, lookupIdentity } from '@/lib/authIdentity';
import type { Member } from '@/lib/types';

export const dynamic = 'force-dynamic';

const BAD = () => NextResponse.json({ error: 'invalid_token' }, { status: 400 });

export async function POST(req: NextRequest) {
  if (!isFlagOn('NEXT_PUBLIC_FLAG_AUTH_PROVIDERS')) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const ip = getClientIp(req);
  if (!checkRateLimit(`auth-reset:${ip}`, 5, 60 * 60 * 1000)) {
    return NextResponse.json({ error: 'rate_limited', retryAfter: 3600 }, { status: 429 });
  }

  let body: { email?: unknown; token?: unknown; password?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }

  const email = typeof body.email === 'string' ? normalizeEmail(body.email) : '';
  const token = typeof body.token === 'string' ? body.token : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (!email || !token) return BAD();

  // Before the token is touched — see the ORDER MATTERS note above.
  const strength = validatePasswordStrength(password);
  if (!strength.ok) {
    return NextResponse.json({ error: 'weak_password', reason: strength.reason }, { status: 400 });
  }

  try {
    const identity = await lookupIdentity('email', email);
    if (!identity) return BAD();

    const container = getContainer('members');
    const { resource: member } = await container
      .item(identity.memberId, identity.memberId)
      .read<Member>();
    if (!member || member.active !== true) return BAD();
    if (!checkToken(token, member.passwordReset)) return BAD();

    // Dropping the record is what makes the link single-use.
    const { passwordReset: _consumed, ...rest } = member;
    const updated: Member = {
      ...rest,
      passwordHash: await hashPassword(password),
      // Reaching this point proves control of the mailbox, which is strictly
      // stronger evidence than the verification link we would otherwise mail.
      emailVerified: true,
    };
    await container.items.upsert(updated);

    const res = NextResponse.json({ ok: true, id: member.id, name: member.name });
    completeSignIn(res, updated);
    return res;
  } catch (err) {
    console.error('POST /api/auth/reset-password unhandled:', err);
    return NextResponse.json({ error: 'service_unavailable' }, { status: 503 });
  }
}
