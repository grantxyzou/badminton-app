/**
 * POST /api/auth/forgot-password — mail a password-reset link.
 *
 * ALWAYS returns 200 with an identical body, whether or not the address
 * resolves to an account. Any other behaviour is an account-enumeration
 * oracle: since a 404 (or a faster response) for an unknown address tells an
 * attacker exactly which of the group's members have accounts, and member
 * names are already enumerable via `GET /api/members`, the pairing would hand
 * over a name→email map.
 *
 * The rate limit is tighter than sign-in (3/hr vs 5/hr) because this endpoint
 * causes an outbound email. Left loose it is a mail-bomb relay pointed at
 * someone else's inbox.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getContainer } from '@/lib/cosmos';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import { isFlagOn } from '@/lib/flags';
import { createToken, RESET_TTL_MS } from '@/lib/authToken';
import { sendPasswordResetEmail } from '@/lib/authEmail';
import { normalizeEmail, lookupIdentity } from '@/lib/authIdentity';
import type { Member } from '@/lib/types';

export const dynamic = 'force-dynamic';

/** The single answer this endpoint ever gives. */
const OK = () =>
  NextResponse.json({
    ok: true,
    message: 'If that address has an account, a reset link is on its way.',
  });

export async function POST(req: NextRequest) {
  if (!isFlagOn('NEXT_PUBLIC_FLAG_AUTH_PROVIDERS')) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const ip = getClientIp(req);
  if (!checkRateLimit(`auth-forgot:${ip}`, 3, 60 * 60 * 1000)) {
    return NextResponse.json({ error: 'rate_limited', retryAfter: 3600 }, { status: 429 });
  }

  let body: { email?: unknown };
  try {
    body = await req.json();
  } catch {
    return OK();
  }
  const email = typeof body.email === 'string' ? normalizeEmail(body.email) : '';
  if (!email) return OK();

  try {
    const identity = await lookupIdentity('email', email);
    if (!identity) return OK();

    const container = getContainer('members');
    const { resource: member } = await container
      .item(identity.memberId, identity.memberId)
      .read<Member>();
    if (!member || member.active !== true) return OK();

    const { token, record } = createToken(RESET_TTL_MS);
    await container.items.upsert({ ...member, passwordReset: record });

    const origin = process.env.APP_ORIGIN || new URL(req.url).origin;
    const url = `${origin}/bpm?reset=${token}&email=${encodeURIComponent(email)}`;
    try {
      await sendPasswordResetEmail(email, member.name, url);
    } catch (err) {
      console.error('password reset mail failed:', err);
    }
    return OK();
  } catch (err) {
    // Even an internal failure answers 200 — the alternative leaks whether the
    // address exists via the error path.
    console.error('POST /api/auth/forgot-password unhandled:', err);
    return OK();
  }
}
