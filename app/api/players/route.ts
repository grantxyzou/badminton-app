import { NextRequest, NextResponse } from 'next/server';
import { getContainer, getActiveSessionId } from '@/lib/cosmos';
import { randomBytes, timingSafeEqual } from 'crypto';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import { isAdminAuthed } from '@/lib/auth';
import { hashPin } from '@/lib/recoveryHash';
import { appendEvent } from '@/lib/recoveryAudit';
import type { RecoveryEvent } from '@/lib/types';

const BLOCKLISTED_PINS = new Set(['0000', '1111', '1234', '4321', '1212']);

export async function GET(req: NextRequest) {
  try {
    const params = new URL(req.url).searchParams;
    const overrideSessionId = params.get('sessionId');
    const sessionId = overrideSessionId && isAdminAuthed(req) ? overrideSessionId : await getActiveSessionId();
    const includeRemoved = params.get('all') === 'true' && isAdminAuthed(req);
    const container = getContainer('players');
    const { resources } = await container.items
      .query({
        query: includeRemoved
          ? 'SELECT * FROM c WHERE c.sessionId = @sessionId ORDER BY c.timestamp ASC'
          : 'SELECT * FROM c WHERE c.sessionId = @sessionId AND (NOT IS_DEFINED(c.removed) OR c.removed != true) ORDER BY c.timestamp ASC',
        parameters: [{ name: '@sessionId', value: sessionId }],
      })
      .fetchAll();
    // Strip deleteToken — it must never be exposed to other clients
    return NextResponse.json(resources.map(({ deleteToken: _dt, pinHash: _ph, ...p }: { deleteToken?: string; pinHash?: string; [key: string]: unknown }) => p));
  } catch (error) {
    console.error('GET players error:', error);
    return NextResponse.json([]);
  }
}

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  if (!checkRateLimit(`signup:${ip}`, 10, 60 * 1000)) {
    return NextResponse.json({ error: 'Too many requests. Please wait a moment.' }, { status: 429 });
  }

  try {
    const body = await req.json();
    const sessionId = isAdminAuthed(req) && typeof body.sessionId === 'string' ? body.sessionId : await getActiveSessionId();
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
      const { resources: existingMembers } = await membersContainer.items
        .query({
          query: 'SELECT * FROM c WHERE LOWER(c.name) = LOWER(@name)',
          parameters: [{ name: '@name', value: trimmedName }],
        })
        .fetchAll();
      const existingMember = existingMembers[0];
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
      const { resource } = await membersContainer.items.upsert(memberDoc);
      const safe = resource as Record<string, unknown>;
      return NextResponse.json({ id: safe.id, name: safe.name, deleteToken: null }, { status: 201 });
    }

    const sessionContainer = getContainer('sessions');
    const membersContainer = getContainer('members');
    const container = getContainer('players');

    // Parallelize all 4 queries — session, members, existing player, active count
    const [sessionsRes, membersRes, existingRes, activeRes] = await Promise.all([
      sessionContainer.items
        .query({ query: 'SELECT * FROM c WHERE c.id = @id', parameters: [{ name: '@id', value: sessionId }] })
        .fetchAll(),
      membersContainer.items
        .query({ query: 'SELECT * FROM c WHERE c.active = true' })
        .fetchAll(),
      container.items
        .query({
          query: 'SELECT * FROM c WHERE c.sessionId = @sessionId AND LOWER(c.name) = LOWER(@name)',
          parameters: [{ name: '@sessionId', value: sessionId }, { name: '@name', value: trimmedName }],
        })
        .fetchAll(),
      container.items
        .query({
          query: 'SELECT * FROM c WHERE c.sessionId = @sessionId AND (NOT IS_DEFINED(c.removed) OR c.removed != true) AND (NOT IS_DEFINED(c.waitlisted) OR c.waitlisted != true)',
          parameters: [{ name: '@sessionId', value: sessionId }],
        })
        .fetchAll(),
    ]);

    const sessionData = sessionsRes.resources[0];
    const maxPlayers =
      sessionData?.maxPlayers ?? parseInt(process.env.NEXT_PUBLIC_MAX_PLAYERS ?? '12', 10);

    if (sessionData?.signupOpen === false && !isAdminAuthed(req)) {
      return NextResponse.json({ error: 'Sign-ups are not open yet' }, { status: 403 });
    }

    if (sessionData?.deadline && new Date() > new Date(sessionData.deadline) && !isAdminAuthed(req)) {
      return NextResponse.json({ error: 'Sign-up deadline has passed' }, { status: 403 });
    }

    // Members-based identity check
    const allMembers = membersRes.resources;
    let matchedMember: { id: string; name: string; sessionCount: number; [key: string]: unknown } | null = null;
    if (allMembers.length > 0) {
      matchedMember = allMembers.find(
        (m: { name: string }) => m.name.toLowerCase() === trimmedName.toLowerCase()
      ) ?? null;
      if (!matchedMember && !isAdminAuthed(req)) {
        return NextResponse.json({ error: 'invite_list_not_found', name: trimmedName }, { status: 403 });
      }
    }

    const anyExisting = existingRes.resources;
    const activeRecord = anyExisting.find((p: { removed?: boolean }) => !p.removed);
    const removedRecord = anyExisting.find((p: { removed?: boolean }) => p.removed);

    if (activeRecord) {
      return NextResponse.json({ error: 'Already signed up' }, { status: 409 });
    }

    const activePlayers = activeRes.resources;
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
      const { resource } = await container.items.upsert(restored);

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
      return NextResponse.json({ ...safeResource, deleteToken }, { status: 201 });
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

    const { resource } = await container.items.create(player);

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
    const { pinHash: _ph, ...safeResource } = resource as unknown as Record<string, unknown>;
    return NextResponse.json({ ...safeResource, deleteToken }, { status: 201 });
  } catch (error) {
    console.error('POST players error:', error);
    return NextResponse.json({ error: 'Failed to sign up' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const isAdmin = isAdminAuthed(req);

  try {
    const body = await req.json();
    const { id } = body;
    if (typeof id !== 'string') {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
    }

    // PIN set/change/remove — admin OR player-self via deleteToken.
    // Recovery flag retired; PIN management is unconditionally available.
    if (body.pin !== undefined) {
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

      const sessionId = isAdmin && typeof body.sessionId === 'string' ? body.sessionId : await getActiveSessionId();
      const container = getContainer('players');
      const { resource: existing } = await container.item(id, sessionId).read();
      if (!existing) {
        return NextResponse.json({ error: 'Player not found' }, { status: 404 });
      }

      // Auth: admin OR self via deleteToken
      let allowed = isAdmin;
      if (!allowed && typeof body.deleteToken === 'string') {
        const stored = existing.deleteToken;
        if (stored && typeof stored === 'string' && stored.length === body.deleteToken.length &&
            timingSafeEqual(Buffer.from(stored), Buffer.from(body.deleteToken))) {
          allowed = true;
        }
      }
      if (!allowed) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
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
      const { resource: updated } = await container.items.upsert(updatedDoc);

      // Mirror pinHash to the matching Member so unified admin auth can
      // verify against it. Best-effort — a Cosmos hiccup here shouldn't fail
      // the player's PIN write.
      try {
        const membersContainer = getContainer('members');
        const { resources: members } = await membersContainer.items
          .query({
            query: 'SELECT * FROM c WHERE LOWER(c.name) = LOWER(@name) AND c.active = true',
            parameters: [{ name: '@name', value: existing.name }],
          })
          .fetchAll();
        if (members.length > 0) {
          const m = members[0];
          const memberUpdate: Record<string, unknown> = { ...m };
          if (clearPin) {
            delete memberUpdate.pinHash;
          } else {
            memberUpdate.pinHash = nextPinHash;
          }
          await membersContainer.items.upsert(memberUpdate);
        }
      } catch {
        // Member mirror is best-effort; player PIN write already succeeded.
      }

      const { deleteToken: _dt, pinHash: _ph, ...safe } = updated as typeof existing;
      return NextResponse.json(safe);
    }

    // Self-serve "I paid" path — player reports payment using their deleteToken
    if (!isAdmin && body.selfReportedPaid === true && typeof body.deleteToken === 'string') {
      const ip = getClientIp(req);
      if (!checkRateLimit(`selfpay:${ip}`, 10, 60 * 1000)) {
        return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
      }
      const sessionId = await getActiveSessionId();
      const container = getContainer('players');
      const { resource: existing } = await container.item(id, sessionId).read();
      if (!existing) {
        return NextResponse.json({ error: 'Player not found' }, { status: 404 });
      }
      // Validate deleteToken
      const storedToken = existing.deleteToken;
      const providedToken = body.deleteToken;
      if (!storedToken || !providedToken || storedToken.length !== providedToken.length ||
          !timingSafeEqual(Buffer.from(storedToken), Buffer.from(providedToken))) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
      const { resource: updated } = await container.items.upsert({ ...existing, selfReportedPaid: true });
      const { deleteToken: _dt, pinHash: _ph, ...safe } = updated as typeof existing;
      return NextResponse.json(safe);
    }

    // Admin-only path for all other updates
    if (!isAdmin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const sessionId = typeof body.sessionId === 'string' ? body.sessionId : await getActiveSessionId();
    const container = getContainer('players');
    const { resource: existing } = await container.item(id, sessionId).read();
    if (!existing) {
      return NextResponse.json({ error: 'Player not found' }, { status: 404 });
    }
    const updates: Record<string, unknown> = {};
    if (typeof body.paid === 'boolean') updates.paid = body.paid;
    if (typeof body.removed === 'boolean') updates.removed = body.removed;
    if (typeof body.waitlisted === 'boolean') updates.waitlisted = body.waitlisted;

    const sessionContainer = getContainer('sessions');
    const { resources: sessions } = await sessionContainer.items
      .query({
        query: 'SELECT * FROM c WHERE c.id = @id',
        parameters: [{ name: '@id', value: sessionId }],
      })
      .fetchAll();
    const maxPlayers =
      sessions[0]?.maxPlayers ?? parseInt(process.env.NEXT_PUBLIC_MAX_PLAYERS ?? '12', 10);

    // Capacity check when restoring a removed player or promoting a waitlisted player
    if (body.removed === false || body.waitlisted === false) {
      const { resources: active } = await container.items
        .query({
          query: 'SELECT * FROM c WHERE c.sessionId = @sessionId AND (NOT IS_DEFINED(c.removed) OR c.removed != true) AND (NOT IS_DEFINED(c.waitlisted) OR c.waitlisted != true)',
          parameters: [{ name: '@sessionId', value: sessionId }],
        })
        .fetchAll();
      // Exclude the player being promoted from the count (they're currently in the list as waitlisted/removed)
      const countExcludingSelf = active.filter((p: { id: string }) => p.id !== id).length;
      if (countExcludingSelf >= maxPlayers) {
        return NextResponse.json({ error: 'Session is full' }, { status: 409 });
      }
    }

    const { resource: updated } = await container.items.upsert({ ...existing, ...updates });
    const { deleteToken: _dt, pinHash: _ph, ...safe } = updated as typeof existing;
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

  const isAdmin = isAdminAuthed(req);

  try {
    const body = await req.json();
    const sessionId = isAdmin && typeof body.sessionId === 'string' ? body.sessionId : await getActiveSessionId();

    // Admin hard purge — permanently delete every record for this session
    if (isAdmin && body.purgeAll === true) {
      const container = getContainer('players');
      const { resources: all } = await container.items
        .query({
          query: 'SELECT * FROM c WHERE c.sessionId = @sessionId',
          parameters: [{ name: '@sessionId', value: sessionId }],
        })
        .fetchAll();
      await Promise.all(all.map((p) => container.item(p.id, sessionId).delete()));
      return NextResponse.json({ success: true, count: all.length });
    }

    // Admin single purge — permanently delete one record
    if (isAdmin && typeof body.purgeOne === 'string') {
      const container = getContainer('players');
      await container.item(body.purgeOne, sessionId).delete();
      return NextResponse.json({ success: true });
    }

    // Admin bulk clear — soft-delete all active players for a new week
    if (isAdmin && body.clearAll === true) {
      const container = getContainer('players');
      const { resources: active } = await container.items
        .query({
          query: 'SELECT * FROM c WHERE c.sessionId = @sessionId AND (NOT IS_DEFINED(c.removed) OR c.removed != true)',
          parameters: [{ name: '@sessionId', value: sessionId }],
        })
        .fetchAll();
      const now = new Date().toISOString();
      await Promise.all(
        active.map((p) =>
          container.items.upsert({ ...p, removed: true, removedAt: now, cancelledBySelf: false })
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

    const container = getContainer('players');
    const { resources } = await container.items
      .query({
        query:
          'SELECT * FROM c WHERE c.sessionId = @sessionId AND LOWER(c.name) = LOWER(@name) AND (NOT IS_DEFINED(c.removed) OR c.removed != true)',
        parameters: [
          { name: '@sessionId', value: sessionId },
          { name: '@name', value: trimmedName },
        ],
      })
      .fetchAll();

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
    await container.items.upsert({
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
