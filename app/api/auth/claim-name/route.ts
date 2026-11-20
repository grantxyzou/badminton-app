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
 * The member's PIN, verified against `members.pinHash`. That is the first
 * rung of "Is that you?" (docs/plans/sign-in-redesign.md); the other two —
 * the person's own signed-in phone, then an organizer — approve in the app
 * through `POST /api/auth/claim-ask`, and replaced the admin-issued recovery
 * code this route used to take as well (step 3).
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
import { claimPinAttempt, notePinSuccess } from '@/lib/pinLockout';
import { getContainer } from '@/lib/cosmos';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import { verifyPin, FAKE_HASH } from '@/lib/recoveryHash';
import { completeSignIn } from '@/lib/authSession';
import { claimNameAttempt, nameLockSeconds } from '@/lib/pinLockPolicy';
import { pinPaused } from '@/lib/pinPaused';
import { linkSignInTo } from '@/lib/linkSignIn';
import { readPendingSignup, clearPendingSignup } from '@/lib/pendingSignup';
import { resolveActiveMemberId } from '@/lib/memberResolve';
import type { Member } from '@/lib/types';
import { resolveGroupId } from '@/lib/groupContext';
import { resolveClaimLink } from '@/lib/claimLinks';
import { isFlagOn } from '@/lib/flags';
import { padMissingAccount } from '@/lib/accountPad';

export const dynamic = 'force-dynamic';

const FAIL = () => NextResponse.json({ error: 'invalid_credentials' }, { status: 401 });

/** A wrong PIN, or the countdown once the NAME is paused (lib/pinLockPolicy.ts). */
function wrongPin(name: string) {
  const paused = nameLockSeconds(name);
  return paused > 0 ? pinPaused(paused) : FAIL();
}

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  // Rule 4 says rate-limit BEFORE body parsing, so the limiter cannot be
  // bypassed. But the real limit below is keyed per-identifier, which needs the
  // identifier out of the body -- the same bind /api/players/recover has.
  // So: a coarse IP-only guard first (cheap, and generous enough that it only
  // catches someone hammering the endpoint), then the precise per-identifier
  // limit once the body is known.
  if (!checkRateLimit(`auth-claim:ip:${ip}`, 20, 60 * 60 * 1000)) {
    return NextResponse.json({ error: 'rate_limited', retryAfter: 3600 }, { status: 429 });
  }

  let body: { name?: unknown; pin?: unknown; inviteToken?: unknown; inviteCode?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }

  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 50) : '';
  const pin = typeof body.pin === 'string' ? body.pin : null;

  if (!name || !pin) return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  // The club's link this person arrived with, if any: the only thing that
  // names THEIR club. A signed-out browser carries no club cookie, so
  // `resolveGroupId` answers BPM, and the name was looked up on BPM's roster
  // even when the link (and the `name_taken` that sent them here) was another
  // club's. A typed invite CODE named a one-time invite, retired in
  // docs/plans/one-way-in.md step 5: it resolves nothing, so it fails.
  const inviteToken = typeof body.inviteToken === 'string' && body.inviteToken.trim() ? body.inviteToken.trim().slice(0, 128) : null;
  const inviteCode = !inviteToken && typeof body.inviteCode === 'string' && body.inviteCode.trim() ? body.inviteCode.trim().slice(0, 64) : null;
  if (!/^[0-9]{4}$/.test(pin)) return FAIL();

  // Same envelope as /recover: 5 per hour per (name, IP).
  if (!checkRateLimit(`auth-claim:${name.toLowerCase()}:${ip}`, 5, 60 * 60 * 1000)) {
    return NextResponse.json({ error: 'rate_limited', retryAfter: 3600 }, { status: 429 });
  }

  // Without a pending provider identity there is nothing to link, and
  // accepting name+PIN here would quietly make this a second sign-in endpoint
  // with its own rate limit and its own audit gaps.
  const pending = readPendingSignup(req);
  if (!pending) return NextResponse.json({ error: 'no_pending_signup' }, { status: 400 });
  /* WHO CAN HOLD THIS COOKIE. This route links the pending provider identity to
     whoever proves a name, so it must only ever run in the browser that
     started the sign-in. A pending-signup cookie is minted in exactly two
     places, and both prove that: a callback that passed its OWN state cookie,
     and the hand-off claim, which needs the preimage AND the code the
     completing browser handed back (lib/authHandoff.ts, guarantee 4). A
     parked-state callback no longer mints one — which is what closed the
     captured-callback takeover, where a victim typed their own name and PIN
     into an attacker's sign-in. */

  // THE COUNTDOWN A PERSON SEES comes from the name alone, counted before
  // anything is looked up, the same at every PIN check (lib/pinLockPolicy.ts).
  const attempt = claimNameAttempt(name);
  if (!attempt) return pinPaused(nameLockSeconds(name));

  try {
    const container = getContainer('members');
    // Name -> memberId goes through lib/memberResolve.ts, which owns that
    // lookup; then a point read for the full document, since this route needs
    // pinHash and recoveryCode. `__tests__/member-resolve-canary.test.ts`
    // enforces the single owner.
    // With groups off there is one club, and a link cannot move the lookup.
    let groupId = resolveGroupId(req);
    if (isFlagOn('NEXT_PUBLIC_FLAG_MULTI_GROUP') && (inviteToken || inviteCode)) {
      const invited = inviteToken ? await resolveClaimLink(inviteToken) : null;
      // A link that no longer resolves (or a retired code) is the same 401 at
      // the same cost, never a quiet fall back to BPM's roster.
      if (!invited) {
        await verifyPin(pin, FAKE_HASH);
        return wrongPin(name);
      }
      groupId = invited;
    }
    const memberId = await resolveActiveMemberId(groupId, name);
    const member = memberId
      ? ((await container.item(memberId, memberId).read<Member>()).resource ?? null)
      : null;

    // Constant-time miss: no such member, or a member with no PIN, must cost
    // the same as a wrong PIN.
    if (!member) {
      await verifyPin(pin, FAKE_HASH);
      await padMissingAccount(); // the reads and write a real account's miss does (gap 3)
      return wrongPin(name);
    }

    // A locked account (lib/pinLockout.ts) verifies against FAKE_HASH like
    // one with no PIN: same cost, same answer. The guess is counted BEFORE it
    // is compared, so a parallel burst from many addresses cannot all be
    // compared before the lock forms (Claude Security F9).
    const usable = typeof member.pinHash === 'string' && (await claimPinAttempt(member));
    const stored = usable ? (member.pinHash as string) : FAKE_HASH;
    if (!(await verifyPin(pin, stored)) || !member.pinHash) {
      return wrongPin(name);
    }
    await notePinSuccess(member);
    attempt.undo();

    // Proof accepted: join the new sign-in to them (lib/linkSignIn.ts). A 409
    // means the identity already belongs to someone else — never steal it.
    const linked = await linkSignInTo(member.id, pending);
    if (!linked.ok) {
      return linked.reason === 'already_linked'
        ? NextResponse.json({ error: 'already_linked' }, { status: 409 })
        : FAIL();
    }
    const updated = linked.member;

    const res = NextResponse.json({
      ok: true,
      id: member.id,
      name: member.name,
      provider: pending.provider,
    });
    // ORDER: every `cookies.set` must happen BEFORE completeSignIn. Its
    // clearAdminCookie branch APPENDS raw Set-Cookie headers, and a later
    // `.set()` re-serializes the whole cookie map and silently drops them --
    // leaving a stale admin_session alive for a non-admin. Verified, and
    // pinned by __tests__/auth-cookie-order.test.ts.
    clearPendingSignup(res);
    await completeSignIn(res, updated, groupId, pending.provider === 'email' ? 'email_code' : pending.provider);
    return res;
  } catch (err) {
    // A Cosmos throttle must be distinguishable from a wrong PIN, or the
    // client rate-limits the user for a server problem.
    console.error('POST /api/auth/claim-name unhandled:', err);
    return NextResponse.json({ error: 'service_unavailable' }, { status: 503 });
  }
}
