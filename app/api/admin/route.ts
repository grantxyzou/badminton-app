import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import {
  setAdminCookie,
  clearAdminCookie,
  isAdminAuthed,
  isAdminAuthedWithMember,
  isNameInAdminBootstrap,
  unauthorized,
} from '@/lib/auth';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import { getContainer } from '@/lib/cosmos';
import { verifyPin, FAKE_HASH } from '@/lib/recoveryHash';
import type { Member } from '@/lib/types';

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

  // Look up the Member by name (case-insensitive, active).
  const membersContainer = getContainer('members');
  const { resources } = await membersContainer.items
    .query<Member>({
      query: 'SELECT * FROM c WHERE LOWER(c.name) = LOWER(@name) AND c.active = true',
      parameters: [{ name: '@name', value: name }],
    })
    .fetchAll();
  let member = resources[0];

  // Bootstrap: name in ADMIN_NAMES + member exists but role !== 'admin' →
  // promote before verifying. (Promotion of a non-admin member who knows
  // their own PIN turns the env var into a controlled key.)
  if (member && member.role !== 'admin' && isNameInAdminBootstrap(name)) {
    const promoted = { ...member, role: 'admin' as const };
    const { resource } = await membersContainer.items.upsert(promoted);
    member = (resource ?? promoted) as Member;
  }

  // Constant-time miss path.
  if (!member || member.role !== 'admin' || !member.pinHash) {
    await verifyPin(pin, FAKE_HASH);
    return NextResponse.json({ error: 'Incorrect name or PIN' }, { status: 401 });
  }

  const ok = await verifyPin(pin, member.pinHash);
  if (!ok) {
    return NextResponse.json({ error: 'Incorrect name or PIN' }, { status: 401 });
  }

  const res = NextResponse.json({
    success: true,
    memberId: member.id,
    name: member.name,
  });
  setAdminCookie(res, member.id, member.name);
  return res;
}

/**
 * DELETE — logout. Clears the cookie. Requires a valid cookie to call (so
 * an unauthenticated CSRF can't clear someone else's session — though
 * SameSite=strict already makes that very unlikely).
 */
export async function DELETE(req: NextRequest) {
  if (!isAdminAuthed(req)) return unauthorized();
  const res = NextResponse.json({ success: true });
  clearAdminCookie(res);
  return res;
}

// Silence unused-import lints for symbols only used at runtime via re-export.
void randomBytes;
