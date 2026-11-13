/**
 * POST /api/auth/email-code/verify — log in with the emailed 6-digit code
 * (docs/plans/one-way-in.md, step 3; `lib/emailCode.ts`).
 *
 * The same contract as `POST /api/auth/signin`: the address resolves through
 * `identities` as a point read, and EVERY failure (unknown address, no code,
 * wrong code, expired, tried out, deactivated member) is the same 401 at the
 * same cost, one scrypt. A different answer for any of them would say which
 * addresses have accounts.
 *
 * SINGLE USE, under the etag: the code is cleared with `IfMatch` on the very
 * doc it was checked against. Two phones racing the same code cannot both
 * sign in; the loser's write is a 412 and gets the same 401.
 *
 * A right code proves the person reads that inbox now, so the address is
 * marked verified if it is the account's own.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getContainer } from '@/lib/cosmos';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import { normalizeEmail, lookupIdentity, touchIdentity, MAX_EMAIL_LENGTH } from '@/lib/authIdentity';
import { verifyEmailCode, emailCodeLive, noteEmailCodeFailure } from '@/lib/emailCode';
import { completeSignIn } from '@/lib/authSession';
import { resolveGroupId } from '@/lib/groupContext';
import type { Member } from '@/lib/types';

export const dynamic = 'force-dynamic';

const HOUR = 60 * 60 * 1000;
const FAIL = () => NextResponse.json({ error: 'invalid_code' }, { status: 401 });

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  if (!checkRateLimit(`auth-code-verify:ip:${ip}`, 20, HOUR)) {
    return NextResponse.json({ error: 'rate_limited', retryAfter: 3600 }, { status: 429 });
  }

  let body: { email?: unknown; code?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }
  const email =
    typeof body.email === 'string' && body.email.length <= MAX_EMAIL_LENGTH ? normalizeEmail(body.email) : '';
  const code = typeof body.code === 'string' ? body.code.replace(/\s/g, '') : '';
  if (!email || !code) return FAIL();

  // Ten tries per (address, caller) an hour, on top of the five a code allows.
  if (!checkRateLimit(`auth-code-verify:${email}:${ip}`, 10, HOUR)) {
    return NextResponse.json({ error: 'rate_limited', retryAfter: 3600 }, { status: 429 });
  }

  try {
    const identity = await lookupIdentity('email', email);
    let member: (Member & { _etag?: string }) | null = null;
    if (identity) {
      const { resource } = await getContainer('members')
        .item(identity.memberId, identity.memberId)
        .read<Member & { _etag?: string }>();
      member = resource ?? null;
    }

    const stored = member && member.active === true ? member.emailCode : undefined;
    const ok = await verifyEmailCode(stored, code);
    if (!ok || !member) {
      if (member && emailCodeLive(stored)) await noteEmailCodeFailure(member.id);
      return FAIL();
    }

    // Use it up, on the doc it was checked against.
    const { emailCode: _used, ...rest } = member;
    const ownAddress = typeof member.email === 'string' && normalizeEmail(member.email) === email;
    const next = { ...rest, ...(ownAddress ? { emailVerified: true } : {}) } as Member & { _etag?: string };
    const container = getContainer('members');
    if (typeof member._etag === 'string') {
      const written = await container
        .item(member.id, member.id)
        .replace(next, { accessCondition: { type: 'IfMatch', condition: member._etag } })
        .catch((err: { code?: number }) => {
          if (err?.code === 412) return null;
          throw err;
        });
      if (!written) return FAIL();
    } else {
      await container.items.upsert(next);
    }

    void touchIdentity('email', email);

    const res = NextResponse.json({
      id: member.id,
      name: member.name,
      role: member.role,
      email: member.email ?? null,
      emailVerified: ownAddress ? true : member.emailVerified === true,
    });
    await completeSignIn(res, next, resolveGroupId(req), 'email_code');
    return res;
  } catch (err) {
    // A Cosmos failure must read as one, or the person is told their code was wrong.
    console.error('POST /api/auth/email-code/verify unhandled:', err);
    return NextResponse.json({ error: 'service_unavailable' }, { status: 503 });
  }
}
