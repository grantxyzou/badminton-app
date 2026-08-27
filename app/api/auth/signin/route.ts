/**
 * POST /api/auth/signin — sign in with an email address and password.
 *
 * The email is resolved through the `identities` container as a POINT READ
 * (`email:<normalized>` -> memberId), never by scanning `members` for
 * `LOWER(c.email)`. That is the whole reason the container exists.
 *
 * Every failure — unknown address, wrong password, no password set, deactivated
 * member — returns the SAME 401 body, and the no-account path still runs a real
 * scrypt verification against `FAKE_PASSWORD_HASH`. Without both, the response
 * is an account-enumeration oracle: an attacker learns which members have
 * accounts from the status code, or from how long the answer took.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getContainer } from '@/lib/cosmos';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import { isFlagOn } from '@/lib/flags';
import { verifyPassword, FAKE_PASSWORD_HASH } from '@/lib/passwordHash';
import { completeSignIn } from '@/lib/authSession';
import {
  normalizeEmail,
  lookupIdentity,
  touchIdentity,
  MAX_EMAIL_LENGTH,
} from '@/lib/authIdentity';
import type { Member } from '@/lib/types';

export const dynamic = 'force-dynamic';

const FAIL = () => NextResponse.json({ error: 'invalid_credentials' }, { status: 401 });

export async function POST(req: NextRequest) {
  if (!isFlagOn('NEXT_PUBLIC_FLAG_AUTH_PROVIDERS')) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const ip = getClientIp(req);

  let body: { email?: unknown; password?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }

  // Capped before use: the address becomes a Cosmos document id, and an
  // unbounded one from an unauthenticated body is both a bad key and the
  // shape that turns string handling into a denial of service.
  const email =
    typeof body.email === 'string' && body.email.length <= MAX_EMAIL_LENGTH
      ? normalizeEmail(body.email)
      : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (!email || !password) return FAIL();

  // Same envelope as /api/players/recover: 5 per hour per (identifier, IP).
  if (!checkRateLimit(`auth-signin:${email}:${ip}`, 5, 60 * 60 * 1000)) {
    return NextResponse.json({ error: 'rate_limited', retryAfter: 3600 }, { status: 429 });
  }

  try {
    const identity = await lookupIdentity('email', email);
    let member: Member | null = null;
    if (identity) {
      const { resource } = await getContainer('members')
        .item(identity.memberId, identity.memberId)
        .read<Member>();
      member = resource ?? null;
    }

    // Verify unconditionally. When there is no member, or the member has no
    // password, we still burn a full scrypt derivation against the sentinel so
    // the miss path costs the same wall-clock time as a real wrong password.
    const stored =
      member && member.active === true && typeof member.passwordHash === 'string'
        ? member.passwordHash
        : FAKE_PASSWORD_HASH;
    const ok = await verifyPassword(password, stored);

    if (!ok || !member || member.active !== true || !member.passwordHash) return FAIL();

    void touchIdentity('email', email);

    const res = NextResponse.json({
      id: member.id,
      name: member.name,
      role: member.role,
      email: member.email ?? null,
      emailVerified: member.emailVerified === true,
    });
    completeSignIn(res, member);
    return res;
  } catch (err) {
    // A Cosmos throttle or misconfig must be distinguishable from bad
    // credentials, or the client rate-limits the user for a server problem.
    console.error('POST /api/auth/signin unhandled:', err);
    return NextResponse.json({ error: 'service_unavailable' }, { status: 503 });
  }
}
