import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { completeSignIn } from '@/lib/authSession';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import { getContainer } from '@/lib/cosmos';
import { groupScope } from '@/lib/groupScope';
import { resolveGroupId, explicitGroupId } from '@/lib/groupContext';
import { signInCandidates, type SignInCandidate } from '@/lib/memberResolve';
import { verifyPin, FAKE_HASH } from '@/lib/recoveryHash';
import { verifyRecoveryCode } from '@/lib/memberRecoveryCode';
import { appendEvent } from '@/lib/recoveryAudit';
import type { Player } from '@/lib/types';

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
  // players — the completeSignIn call below also clears admin status if
  // the recovered identity is not itself an admin.

  const requestGroupId = resolveGroupId(req);
  const scope = groupScope(requestGroupId);
  const membersContainer = getContainer('members');

  /**
   * The (optional) session player, in ONE named group.
   *
   * THE GROUP HAS TO BE THE ONE WE SIGNED THE PERSON INTO, not the one the
   * request arrived in. A no-context sign-in resolves to BPM here while the
   * PIN can match a candidate in another club — so mirroring onto `scope`'s
   * row would mint a fresh `deleteToken` on a DIFFERENT person's spot and hand
   * it back. `DELETE /api/players` accepts that token and only that token, so
   * the caller could cancel a stranger's place; the same write also copied
   * their `pinHash` across, and the recovery-code path blanked it. Session ids
   * are `session-YYYY-MM-DD` and therefore guessable, so this needed no luck.
   */
  const findPlayer = async (groupId: string): Promise<Player | null> => {
    const hits = await groupScope(groupId).query<Player>('players', {
      where: 'c.sessionId = @sessionId AND LOWER(c.name) = LOWER(@name) AND (NOT IS_DEFINED(c.removed) OR c.removed != true)',
      params: [
        { name: '@sessionId', value: sessionId },
        { name: '@name', value: name },
      ],
    });
    return hits[0] ?? null;
  };

  // For the FAILURE audit only: a failed attempt has identified nobody, so the
  // only group it can be attributed to is the one the request carried.
  const player = await findPlayer(requestGroupId);

  // === PIN path ============================================================
  // Verify against `members.pinHash` ALWAYS — that's the canonical PIN
  // store. Previous behavior (verify against `players.pinHash` first) lost
  // the PIN every week because new session-player records are created
  // hash-less when signup doesn't include a PIN field. By making the
  // member record the source of truth, the PIN persists across sessions.
  if (pin) {
    // WHO COULD THIS BE? With one club a name was a person. With groups on and
    // no group context — a fresh device, a link from outside the app — the same
    // name can be two people in two clubs, and the PIN is the only thing that
    // tells them apart. `signInCandidates` is the single owner of that
    // question; flag off it is the `members` scan this route always ran.
    const { candidates, overCap } = await signInCandidates(name, explicitGroupId(req));
    if (overCap > 0) {
      console.warn(`[signin] ${overCap} candidates for one name — over the cap, refusing`);
    }

    // EVERY candidate is verified before anything is decided, and there is ONE
    // failure answer for all of it. Short-circuiting on the first match leaks
    // which account exists, and a distinct "which one did you mean?" error
    // would be an oracle telling an attacker that two accounts share a PIN.
    // EVERY candidate costs one scrypt verification, INCLUDING one that has no
    // PIN set — against `FAKE_HASH`, whose whole purpose is to make a miss cost
    // what a hit costs. Skipping the hash-less ones would answer 401 with no
    // scrypt work at all, which is measurably faster and enumerates exactly the
    // unclaimed accounts the `PATCH /api/members/me` first-set guard exists to
    // protect. The same padding hides HOW MANY same-named accounts have a PIN:
    // without it the latency is proportional to that count.
    const matches: SignInCandidate[] = [];
    for (const c of candidates) {
      const hash = typeof c.member.pinHash === 'string' && c.member.pinHash ? c.member.pinHash : null;
      if (hash === null) {
        await verifyPin(pin, FAKE_HASH);
        continue;
      }
      if (await verifyPin(pin, hash)) matches.push(c);
    }
    // And a name nobody holds costs one verification too, exactly as before.
    if (candidates.length === 0) await verifyPin(pin, FAKE_HASH);

    if (matches.length !== 1) {
      if (player) {
        const updatedEvents = appendEvent(player.recoveryEvents, {
          event: 'recovery-failed',
          at: new Date().toISOString(),
          reason: 'wrong_pin',
        });
        await scope.upsert('players', { ...player, recoveryEvents: updatedEvents });
      }
      return FAIL();
    }
    const member = matches[0].member;
    const signInGroupId = matches[0].groupId;

    // PIN verified. If a session player exists IN THE GROUP WE SIGNED THEM
    // INTO, mint a fresh deleteToken on that row.
    const own = signInGroupId === requestGroupId ? player : await findPlayer(signInGroupId);
    if (own) {
      const newDeleteToken = randomBytes(16).toString('hex');
      const updatedEvents = appendEvent(own.recoveryEvents, {
        event: 'recovered-via-pin',
        at: new Date().toISOString(),
      });
      await groupScope(signInGroupId).upsert('players', {
        ...own,
        deleteToken: newDeleteToken,
        recoveryEvents: updatedEvents,
        // Keep the per-player pinHash mirror current for any legacy reader.
        pinHash: member.pinHash,
      });
      const res = NextResponse.json({ deleteToken: newDeleteToken });
      await completeSignIn(res, member, signInGroupId);
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
    await completeSignIn(res, member, signInGroupId);
    return res;
  }

  // === Code path ===========================================================
  // Recovery codes are MEMBER-scoped (stored on the member doc by
  // `/api/players/reset-access`), so redemption no longer requires the user to
  // be signed up for the active session — recovery is an account operation,
  // not a session one. A session player is optional: when one exists we also
  // mint a fresh deleteToken so the user regains self-cancel on their spot.
  // The SAME ambiguity as the PIN path, and it was the same `members[0]`.
  // Fixing only the PIN branch would leave code redemption resolving the wrong
  // person on a name collision — and a recovery code clears a PIN, so getting
  // it wrong locks the real owner out of their own account.
  const codeCandidates = await signInCandidates(name, explicitGroupId(req));
  if (codeCandidates.overCap > 0) {
    console.warn(`[signin] ${codeCandidates.overCap} candidates for one name — over the cap, refusing`);
  }
  const codeMatches: SignInCandidate[] = [];
  for (const c of codeCandidates.candidates) {
    if (await verifyRecoveryCode(c.member.recoveryCode as Parameters<typeof verifyRecoveryCode>[0], code!)) codeMatches.push(c);
  }
  if (codeCandidates.candidates.length === 0) {
    // Constant-time miss so attackers can't enumerate members via timing.
    await verifyPin(code!, FAKE_HASH);
  }

  if (codeMatches.length !== 1) {
    const only = codeCandidates.candidates.length === 1 ? codeCandidates.candidates[0].member : null;
    if (only) {
      await membersContainer.items.upsert({
        ...only,
        recoveryEvents: appendEvent(only.recoveryEvents as Parameters<typeof appendEvent>[0], {
          event: 'recovery-failed',
          at: new Date().toISOString(),
          reason: 'wrong_code',
        }),
      });
    }
    return FAIL();
  }
  const member = codeMatches[0].member;
  const codeGroupId = codeMatches[0].groupId;

  // Code matched. Clear it (single-use) and clear the member's canonical PIN
  // hash — the user reached this path because they forgot the PIN, so any
  // subsequent "Set PIN" flow should render in 2-field mode (no current-PIN
  // prompt) and the old PIN must stop authenticating.
  const { recoveryCode: _consumed, ...memberRest } = member;
  await membersContainer.items.upsert({
    ...memberRest,
    pinHash: '',
    recoveryEvents: appendEvent(member.recoveryEvents as Parameters<typeof appendEvent>[0], {
      event: 'recovered-via-code',
      at: new Date().toISOString(),
    }),
  });

  // Mint a fresh deleteToken only when a session player exists; otherwise the
  // user is authenticated but not registered (deleteToken: null), same as the
  // PIN sign-in path.
  let newDeleteToken: string | null = null;
  const codeOwn = codeGroupId === requestGroupId ? player : await findPlayer(codeGroupId);
  if (codeOwn) {
    newDeleteToken = randomBytes(16).toString('hex');
    await groupScope(codeGroupId).upsert('players', {
      ...codeOwn,
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
  // One line on purpose: `auth-cookie-order.test.ts` scans for `completeSignIn(res`.
  await completeSignIn(res, { id: String(member.id), name: String(member.name), role: typeof member.role === 'string' ? member.role : undefined }, codeGroupId);
  return res;
}
