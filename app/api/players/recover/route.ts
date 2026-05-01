import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { setAdminCookie, clearAdminCookie } from '@/lib/auth';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import { getContainer } from '@/lib/cosmos';
import { verifyPin, FAKE_HASH } from '@/lib/recoveryHash';
import { consumeCode } from '@/lib/recoveryCodes';
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

    // No session player yet — auto-sign-up for this week if signup is
    // open + capacity allows. Otherwise return identity-only.
    const sessionContainer = getContainer('sessions');
    const { resources: sessions } = await sessionContainer.items
      .query({ query: 'SELECT * FROM c WHERE c.id = @id', parameters: [{ name: '@id', value: sessionId }] })
      .fetchAll();
    const sessionData = sessions[0];
    const maxPlayers = sessionData?.maxPlayers ?? parseInt(process.env.NEXT_PUBLIC_MAX_PLAYERS ?? '12', 10);
    const signupBlocked =
      sessionData?.signupOpen === false ||
      (sessionData?.deadline && new Date() > new Date(sessionData.deadline));

    if (signupBlocked) {
      const res = NextResponse.json({ deleteToken: null });
      syncAdminCookie(res, member);
      return res;
    }

    const { resources: active } = await playersContainer.items
      .query({
        query:
          'SELECT * FROM c WHERE c.sessionId = @sessionId AND (NOT IS_DEFINED(c.removed) OR c.removed != true) AND (NOT IS_DEFINED(c.waitlisted) OR c.waitlisted != true)',
        parameters: [{ name: '@sessionId', value: sessionId }],
      })
      .fetchAll();
    if (active.length >= maxPlayers) {
      const res = NextResponse.json({ deleteToken: null });
      syncAdminCookie(res, member);
      return res;
    }

    const newDeleteToken = randomBytes(16).toString('hex');
    const newPlayer = {
      id: randomBytes(12).toString('hex'),
      name: member.name,
      sessionId,
      timestamp: new Date().toISOString(),
      deleteToken: newDeleteToken,
      paid: false,
      removed: false,
      waitlisted: false,
      memberId: member.id,
      pinHash: member.pinHash,
      recoveryEvents: [{ event: 'recovered-via-pin', at: new Date().toISOString() }],
    };
    await playersContainer.items.create(newPlayer);
    const res = NextResponse.json({ deleteToken: newDeleteToken });
    syncAdminCookie(res, member);
    return res;
  }

  // === Code path ===========================================================
  // Recovery codes are still player-scoped — they're issued against a
  // specific player.id by `/api/players/reset-access`.
  if (!player) {
    await verifyPin(code!, FAKE_HASH);
    return FAIL();
  }

  const ok = await consumeCode(player.id, code!);
  if (!ok) {
    const updatedEvents = appendEvent(player.recoveryEvents, {
      event: 'recovery-failed',
      at: new Date().toISOString(),
      reason: 'wrong_code',
    });
    await playersContainer.items.upsert({ ...player, recoveryEvents: updatedEvents });
    return FAIL();
  }

  const newDeleteToken = randomBytes(16).toString('hex');
  const updatedEvents = appendEvent(player.recoveryEvents, {
    event: 'recovered-via-code',
    at: new Date().toISOString(),
  });
  await playersContainer.items.upsert({
    ...player,
    deleteToken: newDeleteToken,
    recoveryEvents: updatedEvents,
  });

  return NextResponse.json({ deleteToken: newDeleteToken });
}
