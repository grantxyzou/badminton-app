/**
 * POST /api/auth/signup — create an account with an email address and password.
 *
 * This does NOT replace the name-only Home sign-up. Accounts stay optional: a
 * stranger can still type their name and join a session with no credential at
 * all. This route exists so someone can CLAIM and secure that identity.
 *
 * WRITE ORDERING IS LOAD-BEARING
 * ------------------------------
 * Two writes can partially fail: reserving `email:<normalized>` in `identities`
 * and creating the `Member`. We reserve FIRST, and release in a catch.
 *
 * The alternative is worse in a way no retry can repair: member-first leaves a
 * member holding an email nothing has reserved, so a second signup can reserve
 * that same address and STEAL it. Reserve-first's failure mode is an orphan
 * reservation pointing at a member that does not exist — it blocks that one
 * address, belongs to nobody, and is releasable. The catch makes even that
 * transient.
 */
import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { getContainer } from '@/lib/cosmos';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import { isFlagOn } from '@/lib/flags';
import { hashPassword, validatePasswordStrength } from '@/lib/passwordHash';
import { createToken, VERIFICATION_TTL_MS } from '@/lib/authToken';
import { sendVerificationEmail } from '@/lib/authEmail';
import { completeSignIn } from '@/lib/authSession';
import { normalizeEmail, reserveIdentity, releaseIdentity } from '@/lib/authIdentity';
import { resolveActiveMemberId } from '@/lib/memberResolve';
import type { Member } from '@/lib/types';

export const dynamic = 'force-dynamic';

// Deliberately permissive. Strict RFC 5322 validation rejects real addresses,
// and the verification mail is the actual proof that an address works —
// this only catches obvious typos before we spend a Cosmos write on them.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function appOrigin(req: NextRequest): string {
  return process.env.NEXT_PUBLIC_APP_ORIGIN || new URL(req.url).origin;
}

export async function POST(req: NextRequest) {
  // Flag gate FIRST: read server-side, because a client flag cannot protect the
  // database — anyone with devtools can flip a bundle constant.
  if (!isFlagOn('NEXT_PUBLIC_FLAG_AUTH_PROVIDERS')) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  // Rate limit before auth and before body parsing, so it cannot be bypassed.
  const ip = getClientIp(req);
  if (!checkRateLimit(`auth-signup:${ip}`, 5, 60 * 60 * 1000)) {
    return NextResponse.json({ error: 'rate_limited', retryAfter: 3600 }, { status: 429 });
  }

  let body: { name?: unknown; email?: unknown; password?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }

  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 50) : '';
  const rawEmail = typeof body.email === 'string' ? body.email : '';
  const email = normalizeEmail(rawEmail);
  const password = typeof body.password === 'string' ? body.password : '';

  if (!name || !EMAIL_RE.test(email)) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }
  const strength = validatePasswordStrength(password);
  if (!strength.ok) {
    return NextResponse.json({ error: 'weak_password', reason: strength.reason }, { status: 400 });
  }

  const membersContainer = getContainer('members');

  // Is the display name already someone's? A name collision is a REFUSAL, never
  // a silent link. Member names are enumerable via GET /api/members, so
  // attaching a new credential to an existing name on the strength of the name
  // alone is account takeover — the same hazard WS#3 closed in 2026-06-03.
  //
  // Goes through lib/memberResolve.ts rather than issuing its own
  // case-insensitive name query: that lookup has exactly one owner, because it
  // once existed as ten hand-copied variants that disagreed about whether to
  // filter on `active`. `__tests__/member-resolve-canary.test.ts` enforces it.
  if (await resolveActiveMemberId(name)) {
    return NextResponse.json({ error: 'name_taken' }, { status: 409 });
  }

  const memberId = `member-${randomBytes(8).toString('hex')}`;

  // Reserve the address. A 409 here IS the uniqueness check — Cosmos has no
  // cross-partition unique constraint, so a query-then-write would race.
  const reservation = await reserveIdentity('email', email, memberId);
  if (!reservation.ok) {
    return NextResponse.json({ error: 'email_taken' }, { status: 409 });
  }

  try {
    const verification = createToken(VERIFICATION_TTL_MS);
    const member: Member = {
      id: memberId,
      name,
      role: 'member',
      sessionCount: 0,
      active: true,
      createdAt: new Date().toISOString(),
      email,
      emailVerified: false,
      passwordHash: await hashPassword(password),
      emailVerification: verification.record,
    };
    await membersContainer.items.create(member);

    // Best-effort. The account already exists and works, so a mail failure must
    // not fail the request — but the caller is told, so the UI can offer a
    // resend rather than silently implying a mail is on its way.
    const verifyUrl =
      `${appOrigin(req)}/bpm/api/auth/verify-email` +
      `?token=${verification.token}&email=${encodeURIComponent(email)}`;
    let sent = false;
    try {
      ({ sent } = await sendVerificationEmail(email, name, verifyUrl));
    } catch (err) {
      console.error('signup verification mail failed:', err);
    }

    const res = NextResponse.json(
      { id: memberId, name, email, emailVerified: false, verificationSent: sent },
      { status: 201 },
    );
    completeSignIn(res, member);
    return res;
  } catch (err) {
    // Free the address so this person can try again, and so it is not blocked
    // for whoever legitimately owns it.
    await releaseIdentity('email', email);
    console.error('POST /api/auth/signup failed after reservation:', err);
    return NextResponse.json({ error: 'service_unavailable' }, { status: 503 });
  }
}
