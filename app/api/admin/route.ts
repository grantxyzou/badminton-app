import { NextRequest, NextResponse } from 'next/server';
import { isOperatorAdmin } from '@/lib/operator';
import { claimPinAttempt, notePinSuccess } from '@/lib/pinLockout';
import { randomBytes } from 'crypto';
import {
  setAdminCookie,
  clearAdminCookie,
  clearMemberCookie,
  isAdminAuthedWithMember,
  isNameInAdminBootstrap,
} from '@/lib/auth';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import { getContainer } from '@/lib/cosmos';
import { verifyPin, FAKE_HASH } from '@/lib/recoveryHash';
import type { Member } from '@/lib/types';
import { resolveGroupId } from '@/lib/groupContext';
import { resolveActiveMemberId } from '@/lib/memberResolve';
import { BPM_GROUP_ID } from '@/lib/groupScope';
import { isFlagOn } from '@/lib/flags';
import { readGroupAdmin, setMembershipRole, addMembership } from '@/lib/groups';
import { padMissingAccount } from '@/lib/accountPad';

/**
 * GET — auth check.
 *
 * Returns `{ authed, memberId?, name? }`. Uses the async role-aware check so
 * the response reflects the Member's CURRENT role (a demoted admin gets
 * `authed: false` immediately, not at cookie expiry).
 */
export async function GET(req: NextRequest) {
  const result = await isAdminAuthedWithMember(req);
  if (result.authed) {
    return NextResponse.json({
      authed: true,
      memberId: result.memberId,
      name: result.name,
      // Additive: the console shows the deployment-wide tools (release notes)
      // only to the operator; the routes refuse everyone else regardless.
      operator: isOperatorAdmin(result),
    });
  }
  return NextResponse.json({ authed: false });
}

/**
 * POST — login. Accepts `{ name, pin }`, looks up the Member, verifies the
 * pin against `member.pinHash`, sets the signed-payload cookie on success.
 *
 * `ADMIN_NAMES` bootstrap: if the name is in `ADMIN_NAMES` and the matched
 * Member's role is not yet 'admin', upsert role='admin' before verifying. If
 * no Member exists yet but the name is in `ADMIN_NAMES`, we cannot create
 * one without a pinHash to verify against — return 401 and let them sign up
 * as a player first (which mirrors their pinHash to the Member, which then
 * lets them log in here).
 *
 * Constant-time miss: a wrong name still does a real scrypt verify against
 * `FAKE_HASH` so an attacker can't enumerate names by timing.
 */
export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  if (!checkRateLimit(`admin:${ip}`, 5, 15 * 60 * 1000)) {
    return NextResponse.json({ error: 'Too many attempts. Try again later.' }, { status: 429 });
  }

  let body: { name?: unknown; pin?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 50) : '';
  const pin = typeof body.pin === 'string' ? body.pin : '';
  if (!name || !/^[0-9]{4}$/.test(pin)) {
    // Constant-time-ish: still do a scrypt verify so a malformed request
    // doesn't return faster than a real one.
    await verifyPin('0000', FAKE_HASH);
    return NextResponse.json({ error: 'Incorrect name or PIN' }, { status: 401 });
  }

  // Look up the Member by name, IN THE GROUP BEING LOGGED INTO.
  //
  // This was `resources[0]` off an unscoped `LOWER(c.name)` scan — cross
  // partition, no ORDER BY — and then a group-admin check against whichever
  // row came back. With two clubs each holding a Lin the scan can return the
  // other club's, whose id has no standing here, so the real admin gets a 401
  // that comes and goes between identical attempts. Not an escalation (the
  // membership check still holds) but an admin locked out of their own club,
  // and the same `members[0]` shape this change exists to remove.
  const membersContainer = getContainer('members');
  const groupId = resolveGroupId(req);
  const memberId = await resolveActiveMemberId(groupId, name);
  const { resource: found } = memberId
    ? await membersContainer.item(memberId, memberId).read<Member>()
    : { resource: undefined };
  let member = found as Member | undefined;

  const groupsOn = isFlagOn('NEXT_PUBLIC_FLAG_MULTI_GROUP');

  // ONE narrow fallback, and only for the bootstrap, and only with groups OFF.
  // `ADMIN_NAMES` names the people who stood up THIS deployment's first club,
  // before any membership existed for them to be found through. With groups
  // on, BPM's roster exists and the in-group lookup above is the only way in:
  // a deployment-wide scan of `Member.name` picked whoever held the name, and
  // anyone can give a new account any name (Claude Security F11, 2026-11-17).
  if (!member && !groupsOn && groupId === BPM_GROUP_ID && isNameInAdminBootstrap(name)) {
    const { resources } = await membersContainer.items
      .query<Member>({
        query: 'SELECT * FROM c WHERE LOWER(c.name) = LOWER(@name) AND c.active = true',
        parameters: [{ name: '@name', value: name }],
      })
      .fetchAll();
    member = resources.length === 1 ? resources[0] : undefined;
  }

  // Bootstrap: a name in ADMIN_NAMES may sign in here before it holds the
  // role, and is promoted ONLY AFTER its own PIN checks out below. It used to
  // be promoted first, so an unauthenticated request with the name and any
  // PIN wrote the role (F11). BPM ONLY: the env var says nothing about who
  // runs a group created through the app.
  const bootstrap = !!member && groupId === BPM_GROUP_ID && isNameInAdminBootstrap(name);

  // Constant-time miss path. Flag off: `Member.role`. Flag on: the membership
  // in the resolved group — an admin of the Member doc with no standing there
  // is nobody there.
  const adminHere = !member
    ? false
    : groupsOn
      ? (await readGroupAdmin(groupId, member.id)) !== undefined
      : member.role === 'admin';
  if (!member || !(adminHere || bootstrap) || !member.pinHash) {
    await verifyPin(pin, FAKE_HASH);
    // A name nobody holds also pays the database work a real one's guess does (gap 3).
    if (!member) await padMissingAccount();
    return NextResponse.json({ error: 'Incorrect name or PIN' }, { status: 401 });
  }

  // Per-ACCOUNT lock (lib/pinLockout.ts): the IP limiter above is per caller,
  // this counts guesses against the admin however they arrive. Locked reads
  // as a plain wrong PIN, and still pays the scrypt.
  // The guess is COUNTED before it is compared (claimPinAttempt), so a burst
  // cannot all be compared before the lock forms (Claude Security F8).
  if (!(await claimPinAttempt(member))) {
    await verifyPin(pin, FAKE_HASH);
    return NextResponse.json({ error: 'Incorrect name or PIN' }, { status: 401 });
  }
  const ok = await verifyPin(pin, member.pinHash);
  if (!ok) {
    return NextResponse.json({ error: 'Incorrect name or PIN' }, { status: 401 });
  }
  await notePinSuccess(member);

  if (bootstrap && !adminHere) {
    if (member.role !== 'admin') {
      const promoted = { ...member, role: 'admin' as const };
      const { resource } = await membersContainer.items.upsert(promoted);
      member = (resource ?? promoted) as Member;
    }
    // With groups on, the role that admits them lives on the BPM membership,
    // so the bootstrap promotes that too — or the env var would name nobody.
    // A write that fails (the name reserved by someone else, a throttle) must
    // land on a 401, not a 500 or a cookie: the env var is a key, not a bypass.
    if (groupsOn) {
      try {
        const promotedHere = await setMembershipRole(groupId, member.id, 'admin');
        if (!promotedHere) {
          await addMembership({ groupId, memberId: member.id, name: member.name, role: 'admin', joinedVia: 'admin' });
        }
      } catch (err) {
        console.error('POST /api/admin: ADMIN_NAMES bootstrap could not promote the group #1 membership:', err);
      }
      if (!(await readGroupAdmin(groupId, member.id))) {
        return NextResponse.json({ error: 'Incorrect name or PIN' }, { status: 401 });
      }
    }
  }

  const res = NextResponse.json({
    success: true,
    memberId: member.id,
    name: member.name,
  });
  setAdminCookie(res, member.id, member.name, groupId);
  return res;
}

/**
 * DELETE — logout. Clears the cookie. Requires a valid cookie to call (so
 * an unauthenticated CSRF can't clear someone else's session).
 *
 * The session cookies moved from SameSite=Strict to Lax so OAuth callbacks
 * work (see COOKIE_OPTS in lib/auth.ts). Lax is still sufficient here: it
 * blocks cross-site sends on anything that isn't a top-level GET navigation,
 * and this is a DELETE. A forced logout remains the mildest possible CSRF
 * outcome regardless.
 */
export async function DELETE(_req: NextRequest) {
  // Logout — clear BOTH session cookies. Not privileged (you're only clearing
  // your own browser's cookies), so it MUST succeed for non-admin members too,
  // otherwise their member_session (trusted-device cookie) would survive
  // sign-out and the next person on this browser could sign up as them.
  const res = NextResponse.json({ success: true });
  clearAdminCookie(res);
  clearMemberCookie(res);
  return res;
}

// Silence unused-import lints for symbols only used at runtime via re-export.
void randomBytes;
