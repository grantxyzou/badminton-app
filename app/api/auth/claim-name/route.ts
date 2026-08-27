/**
 * POST /api/auth/claim-name — attach a pending provider identity to the
 * EXISTING member who already holds that name, by proving ownership.
 *
 * WHY THIS EXISTS
 * ---------------
 * The name collision is the ordinary case, not the edge case. Every existing
 * member already has a name, so "someone already plays under that name" is the
 * FIRST thing any of them sees when they try Google. Sending them away to sign
 * in with a PIN and hunt through Profile is four steps and a dead end; proving
 * it here is one.
 *
 * WHAT COUNTS AS PROOF
 * --------------------
 * The same two credentials `/api/players/recover` accepts:
 *
 *   - the member's PIN, verified against `members.pinHash`;
 *   - an admin-issued 6-digit recovery code, for members who never set a PIN
 *     (the invite-list case — they have no secret of their own, so an admin
 *     vouching for them is the only proof available).
 *
 * A NAME IS NEVER PROOF. Names are enumerable via `GET /api/members`, so
 * accepting one would hand any account to anyone who can read that list. This
 * is resolution rule 2 (link to an authenticated member) with a verified
 * credential standing in for the session cookie — not a new trust model.
 *
 * Every failure returns one identical 401, and the miss path burns a real
 * scrypt verification. Otherwise the endpoint reports which names have
 * accounts AND which of those have PINs: a map of who is easiest to attack.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getContainer } from '@/lib/cosmos';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import { isFlagOn } from '@/lib/flags';
import { verifyPin, FAKE_HASH } from '@/lib/recoveryHash';
import { verifyRecoveryCode } from '@/lib/memberRecoveryCode';
import { appendEvent } from '@/lib/recoveryAudit';
import { completeSignIn } from '@/lib/authSession';
import { reserveIdentity, normalizeEmail } from '@/lib/authIdentity';
import { readPendingSignup, clearPendingSignup } from '@/lib/pendingSignup';
import { resolveActiveMemberId } from '@/lib/memberResolve';
import type { Member } from '@/lib/types';

export const dynamic = 'force-dynamic';

const FAIL = () => NextResponse.json({ error: 'invalid_credentials' }, { status: 401 });

export async function POST(req: NextRequest) {
  if (!isFlagOn('NEXT_PUBLIC_FLAG_AUTH_PROVIDERS')) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  let body: { name?: unknown; pin?: unknown; code?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }

  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 50) : '';
  const pin = typeof body.pin === 'string' ? body.pin : null;
  const code = typeof body.code === 'string' ? body.code : null;

  if (!name) return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  // Exactly one credential, matching /api/players/recover's contract.
  if ((pin && code) || (!pin && !code)) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }
  if (pin && !/^[0-9]{4}$/.test(pin)) return FAIL();
  if (code && !/^[0-9]{6}$/.test(code)) return FAIL();

  // Same envelope as /recover: 5 per hour per (name, IP).
  const ip = getClientIp(req);
  if (!checkRateLimit(`auth-claim:${name.toLowerCase()}:${ip}`, 5, 60 * 60 * 1000)) {
    return NextResponse.json({ error: 'rate_limited', retryAfter: 3600 }, { status: 429 });
  }

  // Without a pending provider identity there is nothing to link, and
  // accepting name+PIN here would quietly make this a second sign-in endpoint
  // with its own rate limit and its own audit gaps.
  const pending = readPendingSignup(req);
  if (!pending) return NextResponse.json({ error: 'no_pending_signup' }, { status: 400 });

  try {
    const container = getContainer('members');
    // Name -> memberId goes through lib/memberResolve.ts, which owns that
    // lookup; then a point read for the full document, since this route needs
    // pinHash and recoveryCode. `__tests__/member-resolve-canary.test.ts`
    // enforces the single owner.
    const memberId = await resolveActiveMemberId(name);
    const member = memberId
      ? ((await container.item(memberId, memberId).read<Member>()).resource ?? null)
      : null;

    // Constant-time miss: no such member, or a member with no PIN, must cost
    // the same as a wrong PIN.
    if (!member) {
      await verifyPin(pin ?? code ?? '', FAKE_HASH);
      return FAIL();
    }

    if (pin) {
      const stored = typeof member.pinHash === 'string' ? member.pinHash : FAKE_HASH;
      if (!(await verifyPin(pin, stored)) || !member.pinHash) return FAIL();
    } else {
      if (!(await verifyRecoveryCode(member.recoveryCode, code!))) {
        await container.items.upsert({
          ...member,
          recoveryEvents: appendEvent(member.recoveryEvents, {
            event: 'recovery-failed',
            at: new Date().toISOString(),
            reason: 'wrong_code',
          }),
        });
        return FAIL();
      }
    }

    // Proof accepted. Reserve the provider identity for THIS member. A 409
    // means the identity already belongs to someone else — never steal it.
    const reserved = await reserveIdentity(pending.provider, pending.sub, member.id);
    if (!reserved.ok) return NextResponse.json({ error: 'already_linked' }, { status: 409 });

    // Best-effort address claim. If another member already holds it, the link
    // still succeeds — the provider identity is what signs them in, and the
    // address simply stays with whoever reserved it first.
    let claimedEmail: string | null = null;
    if (pending.email && pending.emailVerified) {
      const email = normalizeEmail(pending.email);
      const emailReserved = await reserveIdentity('email', email, member.id);
      if (emailReserved.ok) claimedEmail = email;
    }

    const linked = new Set([...(member.linkedProviders ?? []), pending.provider]);
    const updated: Member = {
      ...member,
      linkedProviders: [...linked],
      ...(claimedEmail ? { email: claimedEmail, emailVerified: true } : {}),
      // A consumed recovery code must not be replayable.
      ...(code ? { recoveryCode: undefined } : {}),
      ...(code
        ? {
            recoveryEvents: appendEvent(member.recoveryEvents, {
              event: 'recovered-via-code',
              at: new Date().toISOString(),
            }),
          }
        : {}),
    };
    await container.items.upsert(updated);

    const res = NextResponse.json({
      ok: true,
      id: member.id,
      name: member.name,
      provider: pending.provider,
    });
    completeSignIn(res, updated);
    clearPendingSignup(res);
    return res;
  } catch (err) {
    // A Cosmos throttle must be distinguishable from a wrong PIN, or the
    // client rate-limits the user for a server problem.
    console.error('POST /api/auth/claim-name unhandled:', err);
    return NextResponse.json({ error: 'service_unavailable' }, { status: 503 });
  }
}
