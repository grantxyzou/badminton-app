import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { setAdminCookie, clearAdminCookie, setMemberCookie } from '@/lib/auth';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import { getContainer } from '@/lib/cosmos';
import { verifyPin, FAKE_HASH } from '@/lib/recoveryHash';
import { verifyRecoveryCode } from '@/lib/memberRecoveryCode';
import { appendEvent } from '@/lib/recoveryAudit';

/**
 * Single-identity model: when a member with `role === 'admin'` proves their
 * PIN, issue the admin session cookie so they don't have to log in again on
 * AdminTab. Admin status is a property of the member record, not a separate
 * auth surface. Conversely, when a non-admin member signs in, ANY existing
 * admin cookie must be cleared — otherwise admin powers persist across
 * player sign-out → sign-in-as-different-player and leak to whoever logs
 * in next.
 */
function syncAdminCookie(
  res: NextResponse,
  member: { id: string; name: string; role?: string } | null | undefined,
): void {
  // PIN proven → trust this device as the member for 30 days so future
  // sign-ups skip the PIN re-entry. Issued for ALL members (admin or not).
  if (member) {
    setMemberCookie(res, member.id, member.name);
  }
  if (member && member.role === 'admin') {
    setAdminCookie(res, member.id, member.name);
  } else {
    clearAdminCookie(res);
  }
}

export const dynamic = 'force-dynamic';

const FAIL = () => NextResponse.json({ error: 'invalid_credentials' }, { status: 401 });

export async function POST(req: NextRequest) {
  try {
    return await handlePost(req);
  } catch (err) {
    // Audit C2: every Cosmos query/upsert below was unwrapped, so a
    // throttle / partition misconfig / id collision returned a raw 500.
    // The client treats `!res.ok` as "wrong PIN" and rate-limits the user
    // after 5 attempts. 503 lets the client distinguish "server problem,
    // retry" from "credentials wrong".
    console.error('POST /api/players/recover unhandled:', err);
    return NextResponse.json({ error: 'service_unavailable' }, { status: 503 });
  }
}

async function handlePost(req: NextRequest) {
  let body: { name?: unknown; sessionId?: unknown; pin?: unknown; code?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const sessionId = typeof body.sessionId === 'string' ? body.sessionId : '';
  const pin = typeof body.pin === 'string' ? body.pin : null;
  const code = typeof body.code === 'string' ? body.code : null;

  if (!name || !sessionId) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
  if ((pin && code) || (!pin && !code)) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
  if (pin && !/^[0-9]{4}$/.test(pin)) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
  if (code && !/^[0-9]{6}$/.test(code)) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  const ip = getClientIp(req);
  if (!checkRateLimit(`recover:${name.toLowerCase()}:${ip}`, 5, 60 * 60 * 1000)) {
    return NextResponse.json({ error: 'rate_limited', retryAfter: 60 * 60 }, { status: 429 });
  }

  // Note: the previous "admins must use /reset-access" guard was retired
  // alongside the single-identity model. Recovery only succeeds with the
  // player's own PIN, so an admin cookie holder can't impersonate other
  // players — the syncAdminCookie call below also clears admin status if
  // the recovered identity is not itself an admin.

  const playersContainer = getContainer('players');
  const membersContainer = getContainer('members');

  // Resolve the (optional) session player up front. Used for code path
  // (codes are issued against a specific player record) and for the
  // success path (mint a fresh deleteToken if a player exists).
  const { resources: playerHits } = await playersContainer.items
    .query({
      query:
        'SELECT * FROM c WHERE c.sessionId = @sessionId AND LOWER(c.name) = LOWER(@name) AND (NOT IS_DEFINED(c.removed) OR c.removed != true)',
      parameters: [
        { name: '@sessionId', value: sessionId },
        { name: '@name', value: name },
      ],
    })
    .fetchAll();
  const player = playerHits[0] ?? null;

  // === PIN path ============================================================
  // Verify against `members.pinHash` ALWAYS — that's the canonical PIN
  // store. Previous behavior (verify against `players.pinHash` first) lost
  // the PIN every week because new session-player records are created
  // hash-less when signup doesn't include a PIN field. By making the
  // member record the source of truth, the PIN persists across sessions.
  if (pin) {
    const { resources: members } = await membersContainer.items
      .query({
        query: 'SELECT * FROM c WHERE LOWER(c.name) = LOWER(@name) AND c.active = true',
        parameters: [{ name: '@name', value: name }],
      })
      .fetchAll();
    const member = members[0] ?? null;

    if (!member || typeof member.pinHash !== 'string' || !member.pinHash) {
      await verifyPin(pin, FAKE_HASH);
      if (player) {
        const updatedEvents = appendEvent(player.recoveryEvents, {
          event: 'recovery-failed',
          at: new Date().toISOString(),
          reason: 'wrong_pin',
        });
        await playersContainer.items.upsert({ ...player, recoveryEvents: updatedEvents });
      }
      return FAIL();
    }

    const ok = await verifyPin(pin, member.pinHash);
    if (!ok) {
      if (player) {
        const updatedEvents = appendEvent(player.recoveryEvents, {
          event: 'recovery-failed',
          at: new Date().toISOString(),
          reason: 'wrong_pin',
        });
        await playersContainer.items.upsert({ ...player, recoveryEvents: updatedEvents });
      }
      return FAIL();
    }

    // PIN verified. If a session player exists, mint a fresh deleteToken.
    if (player) {
      const newDeleteToken = randomBytes(16).toString('hex');
      const updatedEvents = appendEvent(player.recoveryEvents, {
        event: 'recovered-via-pin',
        at: new Date().toISOString(),
      });
      await playersContainer.items.upsert({
        ...player,
        deleteToken: newDeleteToken,
        recoveryEvents: updatedEvents,
        // Keep the per-player pinHash mirror current for any legacy reader.
        pinHash: member.pinHash,
      });
      const res = NextResponse.json({ deleteToken: newDeleteToken });
      syncAdminCookie(res, member);
      return res;
    }

    // No session player exists. PIN sign-in is purely an authentication
    // operation — it does NOT auto-register the user for the current
    // session. That separation is the auth taxonomy in CLAUDE.md:
    // "Sign in" ≠ "Sign up". Returning `deleteToken: null` tells the
    // client "you're authenticated but not registered" — the user can
    // tap the explicit Sign-up CTA on Home if they want a spot. The
    // admin cookie still syncs because admin status is a property of
    // the member, independent of session participation.
    const res = NextResponse.json({ deleteToken: null });
    syncAdminCookie(res, member);
    return res;
  }

  // === Code path ===========================================================
  // Recovery codes are MEMBER-scoped (stored on the member doc by
  // `/api/players/reset-access`), so redemption no longer requires the user to
  // be signed up for the active session — recovery is an account operation,
  // not a session one. A session player is optional: when one exists we also
  // mint a fresh deleteToken so the user regains self-cancel on their spot.
  const { resources: members } = await membersContainer.items
    .query({
      query: 'SELECT * FROM c WHERE LOWER(c.name) = LOWER(@name) AND c.active = true',
      parameters: [{ name: '@name', value: name }],
    })
    .fetchAll();
  const member = members[0] ?? null;

  if (!member) {
    // Constant-time miss so attackers can't enumerate members via timing.
    await verifyPin(code!, FAKE_HASH);
    return FAIL();
  }

  const ok = await verifyRecoveryCode(member.recoveryCode, code!);
  if (!ok) {
    await membersContainer.items.upsert({
      ...member,
      recoveryEvents: appendEvent(member.recoveryEvents, {
        event: 'recovery-failed',
        at: new Date().toISOString(),
        reason: 'wrong_code',
      }),
    });
    return FAIL();
  }

  // Code matched. Clear it (single-use) and clear the member's canonical PIN
  // hash — the user reached this path because they forgot the PIN, so any
  // subsequent "Set PIN" flow should render in 2-field mode (no current-PIN
  // prompt) and the old PIN must stop authenticating.
  const { recoveryCode: _consumed, ...memberRest } = member;
  await membersContainer.items.upsert({
    ...memberRest,
    pinHash: '',
    recoveryEvents: appendEvent(member.recoveryEvents, {
      event: 'recovered-via-code',
      at: new Date().toISOString(),
    }),
  });

  // Mint a fresh deleteToken only when a session player exists; otherwise the
  // user is authenticated but not registered (deleteToken: null), same as the
  // PIN sign-in path.
  let newDeleteToken: string | null = null;
  if (player) {
    newDeleteToken = randomBytes(16).toString('hex');
    await playersContainer.items.upsert({
      ...player,
      deleteToken: newDeleteToken,
      // Keep the per-player mirror in sync with the canonical store.
      pinHash: '',
    });
  }

  const res = NextResponse.json({ deleteToken: newDeleteToken });
  // Consuming a valid admin-issued recovery code proves identity (same as a PIN
  // sign-in does on the pin path), so mint the member_session cookie. This is
  // what lets the user — who just cleared their PIN — pass the members/me
  // first-set guard when they pick a new PIN in the next sheet.
  setMemberCookie(res, String(member.id), String(member.name));
  return res;
}
