import { NextRequest, NextResponse } from 'next/server';
import { getContainer, getActiveSessionId } from '@/lib/cosmos';
import { groupScope, type GroupScope } from '@/lib/groupScope';
import { resolveGroupId, noActiveSession } from '@/lib/groupContext';
import { isFlagOn } from '@/lib/flags';
import { resolveActiveMemberId } from '@/lib/memberResolve';
import { adminAddToRoster } from '@/lib/roster';

const groupsOn = () => isFlagOn('NEXT_PUBLIC_FLAG_MULTI_GROUP');
import { defaultMaxPlayers } from '@/lib/defaults';
import { randomBytes, timingSafeEqual } from 'crypto';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import { isAdminAuthed, isAdminAuthedWithMember, verifyMemberAuth, setMemberCookie } from '@/lib/auth';
import { hashPin, verifyPin, FAKE_HASH } from '@/lib/recoveryHash';
import { appendEvent } from '@/lib/recoveryAudit';
import { isOverCapacity, ACTIVE_PLAYERS_WHERE } from '@/lib/capacity';
import type { RecoveryEvent, Session } from '@/lib/types';

const BLOCKLISTED_PINS = new Set(['0000', '1111', '1234', '4321', '1212']);

/**
 * Close the signup capacity race (#79). The pre-insert count check and the
 * insert aren't atomic, so concurrent signups can both pass the check and land
 * active, exceeding maxPlayers. Once our own record `doc` is committed, re-derive
 * the active set and, if `doc` is past the cap in the deterministic first-come
 * order (see lib/capacity.ts), demote it — to the waitlist when the caller opted
 * in, else roll the just-created record back and report the session full.
 *
 * Every concurrent racer runs this against the same committed rows and only
 * demotes itself when over the line, so the active count converges to
 * `<= maxPlayers` with no coordination. The in-memory mock store is synchronous
 * (one request in flight at a time) so it can't reproduce the interleave — the
 * ordering core is unit-tested (capacity.test.ts) and full concurrency proof is
 * the real-Cosmos test in #82.
 */
async function reconcileCapacity(
  scope: GroupScope,
  sessionId: string,
  doc: { id: string; timestamp?: string; [k: string]: unknown },
  maxPlayers: number,
  joinWaitlist: boolean,
): Promise<'kept' | 'waitlisted' | 'full'> {
  const resources = await scope.query<{ id: string; timestamp?: string }>('players', {
    where: ACTIVE_PLAYERS_WHERE,
    params: [{ name: '@sessionId', value: sessionId }],
  });
  if (!isOverCapacity(resources, doc.id, maxPlayers)) return 'kept';
  if (joinWaitlist) {
    await scope.upsert('players', { ...doc, waitlisted: true });
    return 'waitlisted';
  }
  await scope.remove('players', doc.id, sessionId);
  return 'full';
}

export async function GET(req: NextRequest) {
  try {
    const params = new URL(req.url).searchParams;
    const overrideSessionId = params.get('sessionId');
    const sessionId = overrideSessionId && isAdminAuthed(req)
      ? overrideSessionId
      : await getActiveSessionId(resolveGroupId(req));
    if (!sessionId) return noActiveSession();
    const includeRemoved = params.get('all') === 'true' && isAdminAuthed(req);
    const resources = await groupScope(resolveGroupId(req)).query<Record<string, unknown>>('players', {
      where: includeRemoved
        ? 'c.sessionId = @sessionId'
        : 'c.sessionId = @sessionId AND (NOT IS_DEFINED(c.removed) OR c.removed != true)',
      params: [{ name: '@sessionId', value: sessionId }],
      orderBy: 'c.timestamp ASC',
    });
    // Strip deleteToken — it must never be exposed to other clients
    return NextResponse.json(resources.map(({ deleteToken: _dt, pinHash: _ph, ...p }: { deleteToken?: string; pinHash?: string; [key: string]: unknown }) => p));
  } catch (error) {
    // Surface the failure (500) rather than a lying 200 + []: an empty array is
    // indistinguishable from a legitimately empty roster, which is exactly how
    // the v1.3 Cosmos outage was masked. Clients must be able to tell the
    // difference (CLAUDE.md: "Lying empty state is forbidden").
    console.error('GET players error:', error);
    return NextResponse.json({ error: 'Failed to load players' }, { status: 503 });
  }
}

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  if (!checkRateLimit(`signup:${ip}`, 10, 60 * 1000)) {
    return NextResponse.json({ error: 'Too many requests. Please wait a moment.' }, { status: 429 });
  }

  try {
    const body = await req.json();
    const sessionId = isAdminAuthed(req) && typeof body.sessionId === 'string'
      ? body.sessionId
      : await getActiveSessionId(resolveGroupId(req));
    if (!sessionId) return noActiveSession();
    const { name } = body;
    const joinWaitlist = body.waitlist === true;

    const trimmedName = typeof name === 'string' ? name.trim() : '';
    if (!trimmedName) {
      return NextResponse.json({ error: 'Name required' }, { status: 400 });
    }
    if (trimmedName.length > 50) {
      return NextResponse.json({ error: 'Name too long (max 50 chars)' }, { status: 400 });
    }

    // PIN at sign-up — accepted unconditionally (recovery flag retired). Still
    // optional at the server boundary; PR C will make it required at signup
    // once the client-side form ships the field. Until then, callers may
    // omit pin and the player record is created without a hash.
    let pinHash: string | undefined;
    if (body.pin !== undefined && body.pin !== null) {
      if (typeof body.pin !== 'string' || !/^[0-9]{4}$/.test(body.pin)) {
        return NextResponse.json({ error: 'Invalid PIN format' }, { status: 400 });
      }
      if (BLOCKLISTED_PINS.has(body.pin)) {
        return NextResponse.json({ error: 'pin_too_common' }, { status: 400 });
      }
      pinHash = await hashPin(body.pin);
    }

    // Account-only path: create/update the member record without signing up
    // for a session. PIN is required here — there's no session player to
    // generate a deleteToken from, so the member's pinHash is the only
    // recovery primitive. Tighter rate limit than session signup since
    // account creation is rarer and more enumeration-sensitive.
    if (body.sessionSignup === false) {
      if (!pinHash) {
        return NextResponse.json({ error: 'PIN required for account creation' }, { status: 400 });
      }
      if (!checkRateLimit(`create-account:${trimmedName.toLowerCase()}:${ip}`, 3, 60 * 60 * 1000)) {
        return NextResponse.json({ error: 'Too many account creation attempts. Try again later.' }, { status: 429 });
      }
      const membersContainer = getContainer('members');
      const accountGroupId = resolveGroupId(req);
      // With groups on the invite list is THIS group's roster, so the name is
      // resolved inside it; flag off, the members scan it always was.
      const existingMember = await (async () => {
        if (groupsOn()) {
          const id = await resolveActiveMemberId(accountGroupId, trimmedName);
          return id ? (await membersContainer.item(id, id).read()).resource : undefined;
        }
        const { resources: existingMembers } = await membersContainer.items
          .query({
            query: 'SELECT * FROM c WHERE LOWER(c.name) = LOWER(@name)',
            parameters: [{ name: '@name', value: trimmedName }],
          })
          .fetchAll();
        return existingMembers[0];
      })();
      // Invite-only: account creation requires the admin to have pre-seeded
      // the name in the members container. Profile copy says "Account
      // creation is invite only — contact admin for inquiries (beta)" so
      // the server has to enforce that. Admins bypass.
      if (!existingMember && !isAdminAuthed(req)) {
        return NextResponse.json({ error: 'invite_list_not_found', name: trimmedName }, { status: 403 });
      }
      // Refuse to overwrite an existing PIN. Otherwise anyone who knows a
      // member's name could hijack the account by "creating an account" for
      // them with a new PIN. Pre-seeded members without a PIN can still be
      // claimed (admin seeds names, friends claim by setting the first PIN).
      if (existingMember && typeof existingMember.pinHash === 'string' && existingMember.pinHash.length > 0) {
        return NextResponse.json({ error: 'account_exists' }, { status: 409 });
      }
      /**
       * SETTING A FIRST PIN ON AN EXISTING MEMBER NEEDS PROOF — the same rule
       * the session-signup branch below already enforces, and the same one
       * `PATCH /api/members/me` enforces for its own claim flow.
       *
       * The two guards above stop a name that is NOT on the invite list and a
       * member that ALREADY has a `pinHash`. A pre-seeded member with none fell
       * straight through: anyone could read a name off `GET /api/members`
       * (they are enumerable, so the name is not a secret and cannot be
       * treated as one), pick a PIN, and be handed a `member_session` bound to
       * that person — full takeover, with the real owner locked out of
       * claiming their own account. Two branches of one route disagreed about
       * one rule; this is the laxer one brought into line.
       *
       * Accepted proofs, mirroring that branch exactly: an admin cookie, or a
       * `member_session` already bound to this member (the owner's own device,
       * minted at sign-up / PIN sign-in / recovery-code reset). Anything else
       * gets `account_claim_needs_approval`, which is the code the client turns
       * into the "ask an admin to let me in" flow
       * (`POST /api/members/access-request` → claim → set a PIN).
       *
       * Reached only when `existingMember` has no `pinHash` — the 409 above
       * owns the other case.
       */
      const claimAuth = existingMember ? verifyMemberAuth(req) : null;
      const ownsExistingMember =
        !!existingMember &&
        !!claimAuth &&
        (claimAuth.memberId === existingMember.id ||
          (typeof existingMember.name === 'string' &&
            claimAuth.name.toLowerCase() === existingMember.name.toLowerCase()));
      if (existingMember && !ownsExistingMember && !isAdminAuthed(req)) {
        return NextResponse.json({ error: 'account_claim_needs_approval' }, { status: 403 });
      }
      const memberDoc = {
        ...(existingMember ?? {
          id: randomBytes(12).toString('hex'),
          name: trimmedName,
          active: true,
          sessionCount: 0,
          createdAt: new Date().toISOString(),
        }),
        pinHash,
        lastSeen: new Date().toISOString(),
      };
      // An admin creating a fresh account here is adding them to THIS roster:
      // with groups on the person and their membership come from one helper
      // (rejoining the name's holder here rather than minting a duplicate).
      const base = groupsOn() && !existingMember ? (await adminAddToRoster(accountGroupId, trimmedName)).member : null;
      const { resource } = await membersContainer.items.upsert(base ? { ...base, ...memberDoc, id: base.id, createdAt: base.createdAt } : memberDoc);
      const safe = resource as Record<string, unknown> | undefined;
      // Audit C3: the upsert can return undefined (partial Cosmos response,
      // mock-store quirk). Without this guard the client got
      // {id: undefined, name: undefined} with status 201 and set a broken
      // identity for a non-existent account.
      if (!safe || typeof safe.id !== 'string' || typeof safe.name !== 'string') {
        return NextResponse.json({ error: 'Failed to create account' }, { status: 500 });
      }
      const out = NextResponse.json({ id: safe.id, name: safe.name, deleteToken: null }, { status: 201 });
      // Account just created with a PIN → trust this device for future sign-ups
      // (unless an admin created it on someone else's behalf). Past the claim
      // gate above, the only non-admin caller that reaches here is the member's
      // OWN device — a name with no member row is already refused by the invite
      // gate — so this re-affirms a cookie that device already holds. It can no
      // longer mint one for a stranger.
      if (!isAdminAuthed(req)) setMemberCookie(out, safe.id, safe.name, resolveGroupId(req));
      return out;
    }

    const scope = groupScope(resolveGroupId(req));
    const membersContainer = getContainer('members');

    // Parallelize all 4 reads — session, members, existing player, active count.
    // With groups on the members read is ONE point read via the group's name
    // reservation (lib/memberResolve), not the whole container.
    const [sessionData, membersRes, existingRes, activeRes] = await Promise.all([
      scope.read<Session>('sessions', sessionId, sessionId),
      groupsOn()
        ? resolveActiveMemberId(scope.groupId, trimmedName).then(async (id) =>
            id ? { resources: [(await membersContainer.item(id, id).read()).resource].filter(Boolean) } : { resources: [] },
          )
        : membersContainer.items
            .query({ query: 'SELECT * FROM c WHERE c.active = true' })
            .fetchAll(),
      scope.query<Record<string, unknown>>('players', {
        where: 'c.sessionId = @sessionId AND LOWER(c.name) = LOWER(@name)',
        params: [{ name: '@sessionId', value: sessionId }, { name: '@name', value: trimmedName }],
      }),
      scope.query<Record<string, unknown>>('players', {
        where: ACTIVE_PLAYERS_WHERE,
        params: [{ name: '@sessionId', value: sessionId }],
      }),
    ]);

    const maxPlayers =
      sessionData?.maxPlayers ?? defaultMaxPlayers();

    if (sessionData?.signupOpen === false && !isAdminAuthed(req)) {
      return NextResponse.json({ error: 'Sign-ups are not open yet' }, { status: 403 });
    }

    if (sessionData?.deadline && new Date() > new Date(sessionData.deadline) && !isAdminAuthed(req)) {
      return NextResponse.json({ error: 'Sign-up deadline has passed' }, { status: 403 });
    }

    // Members-based identity check
    const allMembers = membersRes.resources as Array<{ id: string; name: string; sessionCount: number; pinHash?: string; [key: string]: unknown }>;
    let matchedMember: { id: string; name: string; sessionCount: number; pinHash?: string; [key: string]: unknown } | null = null;
    if (groupsOn()) {
      // Already resolved inside the group above: one doc or none. A roster
      // always has at least its owner, so the invite gate always applies.
      matchedMember = allMembers[0] ?? null;
      if (!matchedMember && !isAdminAuthed(req)) {
        return NextResponse.json({ error: 'invite_list_not_found', name: trimmedName }, { status: 403 });
      }
    } else if (allMembers.length > 0) {
      matchedMember = allMembers.find(
        (m: { name: string }) => m.name.toLowerCase() === trimmedName.toLowerCase()
      ) ?? null;
      if (!matchedMember && !isAdminAuthed(req)) {
        return NextResponse.json({ error: 'invite_list_not_found', name: trimmedName }, { status: 403 });
      }
    }

    // Admin-bypass auto-create: when admin signs up a name we've never seen,
    // create the members doc now so the player record can link via memberId.
    // Keeps the "every player has a member" invariant the command center relies on.
    //
    // REACTIVATE BEFORE CREATING. The lookup that produced `matchedMember`
    // filters `active = true`, so a SOFT-DELETED member with this name is
    // invisible to it — and creating here would leave two `members` rows
    // sharing one name. Since every name-keyed route resolves the active row
    // (lib/memberResolve), a duplicate pair means a cross-partition
    // `LOWER(c.name)` query with no ORDER BY picks between them, and that id is
    // the storage key for drills, assessments, kudos and gear. Mirrors the
    // reactivate branch in POST /api/members.
    if (!matchedMember && isAdminAuthed(req) && groupsOn()) {
      // With groups on: rejoin the name's holder here, else a new person —
      // never the global reactivation scan below, which would resurrect
      // another club's soft-deleted person onto this roster.
      matchedMember = (await adminAddToRoster(scope.groupId, trimmedName)).member as unknown as typeof matchedMember;
    } else if (!matchedMember && isAdminAuthed(req)) {
      const { resources: anyNamed } = await membersContainer.items
        .query({
          query: 'SELECT * FROM c WHERE LOWER(c.name) = LOWER(@name)',
          parameters: [{ name: '@name', value: trimmedName }],
        })
        .fetchAll();
      const inactive = (anyNamed as Array<{ active?: boolean }>).find((m) => m?.active === false);
      if (inactive) {
        const { resource } = await membersContainer.items.upsert({ ...inactive, active: true });
        matchedMember = (resource ?? null) as typeof matchedMember;
      } else {
        const newMember = {
          id: randomBytes(12).toString('hex'),
          name: trimmedName,
          role: 'member' as const,
          sessionCount: 0,
          active: true,
          createdAt: new Date().toISOString(),
        };
        const { resource } = await membersContainer.items.create(newMember);
        matchedMember = (resource ?? null) as typeof matchedMember;
      }
    }

    // PIN-protected member: the caller must prove ownership before we
    // register them for a session. Three accepted proofs, in order:
    //   1. Admin cookie (admins bypass everywhere)
    //   2. Valid body.pin matching member.pinHash (unified Home sign-in path
    //      sends pin alongside name in one call — see HomeTab.handleSignUp)
    //   3. Nothing → 401 pin_required, client falls back to /recover-then-POST
    //
    // PIN verification on this path is rate-limited per (name, IP) at the
    // same strictness as /api/players/recover (5/hr) so this endpoint can't
    // be used to bypass the stricter recover-side rate limit.
    // 4th accepted proof: a device that already proved this member's PIN holds
    // a signed `member_session` cookie. It's HMAC-signed + name/id bound, so
    // it's identity proof equivalent to body.pin — the "stay logged in" model
    // that lets returning members skip the per-session PIN re-entry.
    const memberAuth = matchedMember ? verifyMemberAuth(req) : null;
    const trustedAsMember =
      !!memberAuth &&
      !!matchedMember &&
      (memberAuth.memberId === matchedMember.id ||
        memberAuth.name.toLowerCase() === matchedMember.name.toLowerCase());
    // Set true when this request itself proves/establishes PIN ownership, so we
    // can mint the member cookie below and trust this device going forward.
    let trustDevice = false;
    if (
      matchedMember &&
      typeof matchedMember.pinHash === 'string' &&
      matchedMember.pinHash.length > 0 &&
      !isAdminAuthed(req) &&
      !trustedAsMember
    ) {
      const candidate = typeof body.pin === 'string' ? body.pin : null;
      if (!candidate) {
        // Constant-time miss against FAKE_HASH so "no pin provided" and
        // "wrong pin" return at the same wall-clock.
        await verifyPin('0000', FAKE_HASH);
        return NextResponse.json({ error: 'pin_required' }, { status: 401 });
      }
      if (!checkRateLimit(`signup-pin:${trimmedName.toLowerCase()}:${ip}`, 5, 60 * 60 * 1000)) {
        return NextResponse.json({ error: 'Too many attempts. Try again later.' }, { status: 429 });
      }
      const ok = await verifyPin(candidate, matchedMember.pinHash);
      if (!ok) {
        return NextResponse.json({ error: 'pin_incorrect' }, { status: 401 });
      }
      // Verified by PIN on this call → trust this device for future sign-ups.
      // pinHash from body.pin is intentionally NOT mirrored back to the player
      // record (the client wasn't asking to change the PIN, just to authenticate).
      trustDevice = true;
      pinHash = undefined;
    }

    /**
     * SETTING A FIRST PIN ON AN EXISTING MEMBER NEEDS PROOF.
     *
     * The gate above only fires when the member ALREADY has a `pinHash`. A
     * member with none fell straight through, so anyone could type a name they
     * did not own, choose a PIN, and be signed in as that person from any
     * device — no cookie, no code, nothing.
     *
     * That is the exact operation `PATCH /api/members/me` refuses, for the
     * reason its own comment gives: member names are enumerable through
     * `GET /api/members`, so the name is not a secret and cannot be treated as
     * one. Two routes disagreed about the same rule and the laxer one was the
     * one on the busiest screen.
     *
     * `account_claim_needs_approval` is a distinct code, not a 401, because the
     * client turns it into the "ask Grant to let me in" flow — the person
     * hitting this is usually the real owner on a new phone, and the honest
     * answer to them is a way in, not a refusal.
     */
    if (
      matchedMember &&
      (typeof matchedMember.pinHash !== 'string' || matchedMember.pinHash.length === 0) &&
      typeof body.pin === 'string' &&
      body.pin.length > 0 &&
      !isAdminAuthed(req) &&
      !trustedAsMember
    ) {
      return NextResponse.json(
        { error: 'account_claim_needs_approval' },
        { status: 403 },
      );
    }

    const anyExisting = existingRes;
    const activeRecord = anyExisting.find((p: { removed?: boolean }) => !p.removed);
    const removedRecord = anyExisting.find((p: { removed?: boolean }) => p.removed);

    if (activeRecord) {
      return NextResponse.json({ error: 'Already signed up' }, { status: 409 });
    }

    const activePlayers = activeRes;
    const isFull = activePlayers.length >= maxPlayers;

    if (isFull && !joinWaitlist) {
      return NextResponse.json({ error: 'Session is full' }, { status: 409 });
    }

    const deleteToken = randomBytes(16).toString('hex');

    // If a soft-deleted record exists for this name, restore it instead of creating a new one
    if (removedRecord) {
      const restored = {
        ...removedRecord,
        timestamp: new Date().toISOString(),
        deleteToken,
        paid: false,
        removed: false,
        removedAt: undefined,
        cancelledBySelf: undefined,
        waitlisted: isFull && joinWaitlist ? true : false,
        ...(matchedMember ? { memberId: matchedMember.id } : {}),
        ...(pinHash ? { pinHash } : {}),
      };
      const resource = await scope.upsert('players', restored as typeof restored & { id: string });

      // Update member stats + mirror pinHash for unified admin auth
      if (matchedMember) {
        await membersContainer.items.upsert({
          ...matchedMember,
          sessionCount: (matchedMember.sessionCount ?? 0) + 1,
          lastSeen: new Date().toISOString(),
          ...(pinHash ? { pinHash } : {}),
        });
      }

      const { pinHash: _ph, ...safeResource } = resource as unknown as Record<string, unknown>;
      const out = NextResponse.json({ ...safeResource, deleteToken }, { status: 201 });
      if (matchedMember && (trustDevice || pinHash) && !isAdminAuthed(req)) {
        setMemberCookie(out, matchedMember.id, matchedMember.name, resolveGroupId(req));
      }
      return out;
    }

    const player = {
      id: randomBytes(12).toString('hex'),
      name: trimmedName,
      sessionId,
      timestamp: new Date().toISOString(),
      deleteToken,
      paid: false,
      removed: false,
      waitlisted: isFull && joinWaitlist ? true : false,
      ...(matchedMember ? { memberId: matchedMember.id } : {}),
      ...(pinHash ? { pinHash } : {}),
    };

    const resource = await scope.create('players', player);

    // Close the capacity race (#79): the pre-insert check + this create aren't
    // atomic, so concurrent signups can both land active. Reconcile against the
    // now-committed active set and demote ourselves if we're past the cap.
    let waitlisted = player.waitlisted;
    if (!player.waitlisted) {
      const outcome = await reconcileCapacity(scope, sessionId, player, maxPlayers, joinWaitlist);
      if (outcome === 'full') {
        return NextResponse.json({ error: 'Session is full' }, { status: 409 });
      }
      waitlisted = outcome === 'waitlisted';
    }

    // Update member stats + mirror pinHash for unified admin auth
    if (matchedMember) {
      await membersContainer.items.upsert({
        ...matchedMember,
        sessionCount: (matchedMember.sessionCount ?? 0) + 1,
        lastSeen: new Date().toISOString(),
        ...(pinHash ? { pinHash } : {}),
      });
    }

    // Return the deleteToken once so the client can store it for self-cancellation
    // (waitlisted reflects any race-demotion above).
    const { pinHash: _ph, ...safeResource } =
      { ...(resource as unknown as Record<string, unknown>), waitlisted } as Record<string, unknown>;
    const out = NextResponse.json({ ...safeResource, deleteToken }, { status: 201 });
    // Trust this device for future sign-ups when this request proved (sign-in)
    // or created (first PIN) the member's PIN — the "stay logged in" model.
    // Skip for admins acting on behalf of others and for anon (no-PIN) names.
    if (matchedMember && (trustDevice || pinHash) && !isAdminAuthed(req)) {
      setMemberCookie(out, matchedMember.id, matchedMember.name, resolveGroupId(req));
    }
    return out;
  } catch (error) {
    console.error('POST players error:', error);
    return NextResponse.json({ error: 'Failed to sign up' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const isAdmin = (await isAdminAuthedWithMember(req)).authed;

  try {
    const body = await req.json();
    const { id } = body;

    // PIN set/change/remove — admin OR the member themselves, proven by a
    // `member_session` cookie. Recovery flag retired; PIN management is
    // unconditionally available. PIN branch supports lookup by `id` (legacy)
    // OR by `{name, sessionId}` (Batch B M1: avoids the client fetching the
    // full session roster just to find its own player ID before patching).
    if (body.pin !== undefined) {
      // Rule 4: rate limit BEFORE auth — and before the scrypt hash below,
      // because this branch now VERIFIES a `currentPin`. Same 5/hr per
      // (target, IP) envelope as `PATCH /api/members/me` and `/recover`, so
      // the PIN written here can't be guessed at any faster than there.
      const pinIp = getClientIp(req);
      const pinTarget =
        typeof body.name === 'string' ? body.name.trim().toLowerCase()
        : typeof id === 'string' ? id
        : '';
      if (!checkRateLimit(`players-pin:${pinTarget}:${pinIp}`, 5, 60 * 60 * 1000)) {
        return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
      }

      // Pre-validate pin shape (fail fast before DB load)
      let nextPinHash: string | undefined;
      let clearPin = false;
      let event: RecoveryEvent | null = null;
      if (body.pin === null) {
        clearPin = true;
        event = { event: 'pin-removed', at: new Date().toISOString() };
      } else if (typeof body.pin === 'string') {
        if (!/^[0-9]{4}$/.test(body.pin)) {
          return NextResponse.json({ error: 'Invalid PIN format' }, { status: 400 });
        }
        if (BLOCKLISTED_PINS.has(body.pin)) {
          return NextResponse.json({ error: 'pin_too_common' }, { status: 400 });
        }
        nextPinHash = await hashPin(body.pin);
        event = { event: 'pin-set', at: new Date().toISOString() };
      } else {
        return NextResponse.json({ error: 'Invalid PIN format' }, { status: 400 });
      }

      const scope = groupScope(resolveGroupId(req));
      const sessionId = isAdmin && typeof body.sessionId === 'string'
        ? body.sessionId
        : await getActiveSessionId(scope.groupId);
      if (!sessionId) return noActiveSession();

      // Resolve the player record. Prefer id (legacy clients), fall back
      // to name lookup so RecoveryPinSheet can patch without first GETing
      // the whole roster. Use `any` for the resource type to match the
      // existing PATCH conventions elsewhere in this file (Cosmos doesn't
      // give us strong typing here).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let existing: any = null;
      if (typeof id === 'string') {
        existing = (await scope.read('players', id, sessionId)) ?? null;
      } else if (typeof body.name === 'string' && body.name.trim()) {
        const trimmedLookupName = body.name.trim();
        const resources = await scope.query('players', {
          where: 'c.sessionId = @sessionId AND LOWER(c.name) = LOWER(@name) AND (NOT IS_DEFINED(c.removed) OR c.removed != true)',
          params: [
            { name: '@sessionId', value: sessionId },
            { name: '@name', value: trimmedLookupName },
          ],
        });
        existing = resources[0] ?? null;
      } else {
        return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
      }
      if (!existing) {
        return NextResponse.json({ error: 'Player not found' }, { status: 404 });
      }

      /**
       * AUTH — A `deleteToken` IS NOT PROOF OF ACCOUNT OWNERSHIP.
       *
       * It is session-scoped and proves only "this device signed this name up
       * for this week". The PIN written below is mirrored onto
       * `members.pinHash` — the credential `POST /api/players/recover`
       * verifies and mints a 30-day `member_session` from — so accepting the
       * token here let anyone sign a PIN-LESS member up anonymously (the POST
       * gate above only fires for a member that already HAS a PIN), keep the
       * returned token, and choose that account's PIN.
       *
       * That is the exact claim `PATCH /api/members/me` refuses, for the
       * reason its own comment gives: member names are enumerable via
       * `GET /api/members`. Two routes disagreed about one rule and the laxer
       * one was reachable with no cookie at all. So this branch now enforces
       * the sibling's rule: admin, or a `member_session` bound to this
       * member — plus a verified `currentPin` when a PIN already exists, so a
       * live cookie can't silently lock its owner out of their own account.
       */
      const caller = isAdmin ? null : verifyMemberAuth(req);
      if (!isAdmin && !caller) {
        return NextResponse.json({ error: 'auth_required' }, { status: 401 });
      }

      // The Member this PIN belongs to, resolved BEFORE the write because it
      // is both what the gate binds to and what the mirror writes — binding
      // the gate to the row the mirror will touch is what stops the two
      // reasoning about different people.
      const membersContainer = getContainer('members');
      const { resources: members } = await membersContainer.items
        .query({
          query: 'SELECT * FROM c WHERE LOWER(c.name) = LOWER(@name) AND c.active = true',
          parameters: [{ name: '@name', value: existing.name }],
        })
        .fetchAll();
      const member = members[0] as
        | (Record<string, unknown> & { id: string; name?: string; pinHash?: string })
        | undefined;

      if (!isAdmin) {
        // No member row means there is no account to prove ownership of. Fail
        // closed rather than answering 200 for a write that reaches nothing.
        const isSelf =
          !!member &&
          !!caller &&
          (caller.memberId === member.id ||
            caller.name.toLowerCase() === String(member.name ?? '').toLowerCase());
        if (!isSelf) {
          return NextResponse.json({ error: 'auth_required' }, { status: 401 });
        }
        const hadPin = typeof member.pinHash === 'string' && member.pinHash.length > 0;
        if (hadPin) {
          // A SECOND limiter, keyed on the RESOLVED member. The pre-auth one
          // above is the rule-4 bypass guard, but its key follows how the
          // caller ADDRESSED the row (`name` or `id`) — two shapes reaching
          // one player row would otherwise be two budgets against one
          // credential. This one caps guesses per account however it is
          // addressed.
          if (!checkRateLimit(`players-pin-verify:${member.id}:${pinIp}`, 5, 60 * 60 * 1000)) {
            return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
          }
          const currentPin = typeof body.currentPin === 'string' ? body.currentPin : null;
          if (!currentPin) {
            // Constant-time penalty so "no currentPin sent" and "wrong
            // currentPin" cost the same wall-clock (as in members/me).
            await verifyPin('0000', member.pinHash as string);
            return NextResponse.json({ error: 'current_pin_required' }, { status: 401 });
          }
          if (!(await verifyPin(currentPin, member.pinHash as string))) {
            return NextResponse.json({ error: 'invalid_credentials' }, { status: 401 });
          }
        }
      }

      const updatedDoc: Record<string, unknown> = {
        ...existing,
        recoveryEvents: appendEvent(existing.recoveryEvents, event!),
      };
      if (clearPin) {
        delete updatedDoc.pinHash;
      } else {
        updatedDoc.pinHash = nextPinHash;
      }
      const updated = await scope.upsert('players', updatedDoc as Record<string, unknown> & { id: string });

      // Mirror pinHash to the matching Member so unified admin auth can
      // verify against it. Best-effort — a Cosmos hiccup here shouldn't fail
      // the player's PIN write. (The lookup itself moved above the gate: the
      // caller is authorized against exactly this row.)
      if (member) {
        try {
          const memberUpdate: Record<string, unknown> = { ...member };
          if (clearPin) {
            delete memberUpdate.pinHash;
          } else {
            memberUpdate.pinHash = nextPinHash;
          }
          await membersContainer.items.upsert(memberUpdate);
        } catch {
          // Member mirror is best-effort; player PIN write already succeeded.
        }
      }

      const { deleteToken: _dt, pinHash: _ph, ...safe } = updated as typeof existing;
      return NextResponse.json(safe);
    }

    // Non-PIN paths still require id. The PIN branch above handles the
    // name-fallback case; everything below assumes an id exists.
    if (typeof id !== 'string') {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
    }

    // Self-serve "I paid" path — player reports payment using their deleteToken
    if (!isAdmin && body.selfReportedPaid === true && typeof body.deleteToken === 'string') {
      const ip = getClientIp(req);
      if (!checkRateLimit(`selfpay:${ip}`, 10, 60 * 1000)) {
        return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
      }
      const scope = groupScope(resolveGroupId(req));
      const sessionId = await getActiveSessionId(scope.groupId);
      if (!sessionId) return noActiveSession();
      const existing = await scope.read<Record<string, unknown> & { id: string }>('players', id, sessionId);
      if (!existing) {
        return NextResponse.json({ error: 'Player not found' }, { status: 404 });
      }
      // Validate deleteToken
      const storedToken = existing.deleteToken;
      const providedToken = body.deleteToken;
      if (typeof storedToken !== 'string' || typeof providedToken !== 'string' || storedToken.length !== providedToken.length ||
          !timingSafeEqual(Buffer.from(storedToken), Buffer.from(providedToken))) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
      const updated = await scope.upsert<Record<string, unknown> & { id: string }>('players', {
        ...existing,
        selfReportedPaid: true,
      });
      const { deleteToken: _dt, pinHash: _ph, ...safe } = updated;
      return NextResponse.json(safe);
    }

    // Admin-only path for all other updates
    if (!isAdmin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const scope = groupScope(resolveGroupId(req));
    const sessionId = typeof body.sessionId === 'string'
      ? body.sessionId
      : await getActiveSessionId(scope.groupId);
    if (!sessionId) return noActiveSession();
    const existing = await scope.read<Record<string, unknown> & { id: string }>('players', id, sessionId);
    if (!existing) {
      return NextResponse.json({ error: 'Player not found' }, { status: 404 });
    }
    const updates: Record<string, unknown> = {};
    if (typeof body.paid === 'boolean') {
      updates.paid = body.paid;
      // Mutex: setting paid:true clears writtenOff. Existing behavior
      // when only paid is sent.
      if (body.paid === true && typeof body.writtenOff !== 'boolean') {
        updates.writtenOff = false;
        updates.coverMode = undefined;
      }
    }
    if (typeof body.removed === 'boolean') updates.removed = body.removed;
    if (typeof body.waitlisted === 'boolean') updates.waitlisted = body.waitlisted;
    if (typeof body.writtenOff === 'boolean') {
      updates.writtenOff = body.writtenOff;
      // Mutual exclusion: writtenOff:true forces paid:false. If the client
      // sent both writtenOff:true and paid:true in one body, writtenOff
      // wins (more explicit intent). See v1.5 design §2 "Setter rule".
      if (body.writtenOff === true) {
        updates.paid = false;
        // Record how the cover is split (defaults to 'absorb' — admin eats it).
        updates.coverMode = body.coverMode === 'resplit' ? 'resplit' : 'absorb';
      } else {
        // Un-covering clears the mode so a stale 'resplit' can't linger and
        // skew a future settle (undefined serializes away on upsert).
        updates.coverMode = undefined;
      }
    }

    const sessionDoc = await scope.read<{ id: string; maxPlayers?: number }>('sessions', sessionId, sessionId);
    const maxPlayers =
      sessionDoc?.maxPlayers ?? defaultMaxPlayers();

    // Capacity check when restoring a removed player or promoting a waitlisted player
    if (body.removed === false || body.waitlisted === false) {
      const active = await scope.query<{ id: string }>('players', {
        where: ACTIVE_PLAYERS_WHERE,
        params: [{ name: '@sessionId', value: sessionId }],
      });
      // Exclude the player being promoted from the count (they're currently in the list as waitlisted/removed)
      const countExcludingSelf = active.filter((p) => p.id !== id).length;
      if (countExcludingSelf >= maxPlayers) {
        return NextResponse.json({ error: 'Session is full' }, { status: 409 });
      }
    }

    const updated = await scope.upsert('players', { ...existing, ...updates });
    const { deleteToken: _dt, pinHash: _ph, ...safe } = updated;
    return NextResponse.json(safe);
  } catch (error) {
    console.error('PATCH player error:', error);
    return NextResponse.json({ error: 'Failed to update' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const ip = getClientIp(req);
  if (!checkRateLimit(`delete:${ip}`, 10, 60 * 1000)) {
    return NextResponse.json({ error: 'Too many requests. Please wait a moment.' }, { status: 429 });
  }

  const isAdmin = (await isAdminAuthedWithMember(req)).authed;

  try {
    const body = await req.json();
    const scope = groupScope(resolveGroupId(req));
    const sessionId = isAdmin && typeof body.sessionId === 'string'
      ? body.sessionId
      : await getActiveSessionId(scope.groupId);
    if (!sessionId) return noActiveSession();

    // Admin hard purge — permanently delete every record for this session
    if (isAdmin && body.purgeAll === true) {
      const all = await scope.query<{ id: string }>('players', {
        where: 'c.sessionId = @sessionId',
        params: [{ name: '@sessionId', value: sessionId }],
      });
      await Promise.all(all.map((p) => scope.remove('players', p.id, sessionId)));
      return NextResponse.json({ success: true, count: all.length });
    }

    // Admin single purge — permanently delete one record
    if (isAdmin && typeof body.purgeOne === 'string') {
      // A miss must say so: the raw delete used to throw a Cosmos 404 here,
      // and a green 200 for a row that was never deleted is worse than that.
      const removed = await scope.remove('players', body.purgeOne, sessionId);
      if (!removed) return NextResponse.json({ error: 'Player not found' }, { status: 404 });
      return NextResponse.json({ success: true });
    }

    // Admin bulk clear — soft-delete all active players for a new week
    if (isAdmin && body.clearAll === true) {
      const active = await scope.query<Record<string, unknown> & { id: string }>('players', {
        where: 'c.sessionId = @sessionId AND (NOT IS_DEFINED(c.removed) OR c.removed != true)',
        params: [{ name: '@sessionId', value: sessionId }],
      });
      const now = new Date().toISOString();
      await Promise.all(
        active.map((p) =>
          scope.upsert('players', { ...p, removed: true, removedAt: now, cancelledBySelf: false })
        )
      );
      return NextResponse.json({ success: true, count: active.length });
    }

    const trimmedName = typeof body.name === 'string' ? body.name.trim() : '';
    const deleteToken: string | undefined = typeof body.deleteToken === 'string' ? body.deleteToken : undefined;

    if (!trimmedName) {
      return NextResponse.json({ error: 'Name required' }, { status: 400 });
    }
    if (trimmedName.length > 50) {
      return NextResponse.json({ error: 'Name too long' }, { status: 400 });
    }
    // Require either admin cookie or a deleteToken for self-cancellation
    if (!isAdmin && !deleteToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const resources = await scope.query<Record<string, unknown> & { id: string; deleteToken?: string }>('players', {
      where: 'c.sessionId = @sessionId AND LOWER(c.name) = LOWER(@name) AND (NOT IS_DEFINED(c.removed) OR c.removed != true)',
      params: [
        { name: '@sessionId', value: sessionId },
        { name: '@name', value: trimmedName },
      ],
    });

    if (resources.length === 0) {
      return NextResponse.json({ error: 'Player not found' }, { status: 404 });
    }

    const player = resources[0];

    // Non-admin must supply a token that matches the stored token
    if (!isAdmin) {
      if (!player.deleteToken || !deleteToken || player.deleteToken.length !== deleteToken.length || !timingSafeEqual(Buffer.from(player.deleteToken), Buffer.from(deleteToken))) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
    }

    // Soft delete — mark as removed instead of destroying the record
    await scope.upsert('players', {
      ...player,
      removed: true,
      removedAt: new Date().toISOString(),
      cancelledBySelf: !isAdmin,
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('DELETE player error:', error);
    return NextResponse.json({ error: 'Failed to cancel' }, { status: 500 });
  }
}
