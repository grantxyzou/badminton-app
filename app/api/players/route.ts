import { NextRequest, NextResponse } from 'next/server';
import { getContainer, SESSION_ID } from '@/lib/cosmos';
import { randomBytes } from 'crypto';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import { isAdminAuthed } from '@/lib/auth';

export async function GET(req: NextRequest) {
  try {
    const includeRemoved = new URL(req.url).searchParams.get('all') === 'true' && isAdminAuthed(req);
    const container = getContainer('players');
    const { resources } = await container.items
      .query({
        query: includeRemoved
          ? 'SELECT * FROM c WHERE c.sessionId = @sessionId ORDER BY c.timestamp ASC'
          : 'SELECT * FROM c WHERE c.sessionId = @sessionId AND (NOT IS_DEFINED(c.removed) OR c.removed != true) ORDER BY c.timestamp ASC',
        parameters: [{ name: '@sessionId', value: SESSION_ID }],
      })
      .fetchAll();
    // Strip deleteToken — it must never be exposed to other clients
    return NextResponse.json(resources.map(({ deleteToken: _dt, ...p }: { deleteToken?: string; [key: string]: unknown }) => p));
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
    const { name } = body;
    const joinWaitlist = body.waitlist === true;

    const trimmedName = typeof name === 'string' ? name.trim() : '';
    if (!trimmedName) {
      return NextResponse.json({ error: 'Name required' }, { status: 400 });
    }
    if (trimmedName.length > 50) {
      return NextResponse.json({ error: 'Name too long (max 50 chars)' }, { status: 400 });
    }

    const sessionContainer = getContainer('sessions');
    const { resources: sessions } = await sessionContainer.items
      .query({
        query: 'SELECT * FROM c WHERE c.id = @id',
        parameters: [{ name: '@id', value: SESSION_ID }],
      })
      .fetchAll();
    const maxPlayers =
      sessions[0]?.maxPlayers ?? parseInt(process.env.NEXT_PUBLIC_MAX_PLAYERS ?? '12', 10);

    const container = getContainer('players');

    // Check for any existing record with this name (active, waitlisted, or soft-deleted)
    const { resources: anyExisting } = await container.items
      .query({
        query:
          'SELECT * FROM c WHERE c.sessionId = @sessionId AND LOWER(c.name) = LOWER(@name)',
        parameters: [
          { name: '@sessionId', value: SESSION_ID },
          { name: '@name', value: trimmedName },
        ],
      })
      .fetchAll();

    const activeRecord = anyExisting.find((p: { removed?: boolean }) => !p.removed);
    const removedRecord = anyExisting.find((p: { removed?: boolean }) => p.removed);

    if (activeRecord) {
      return NextResponse.json({ error: 'Already signed up' }, { status: 409 });
    }

    // Active capacity check — excludes waitlisted players
    const { resources: activePlayers } = await container.items
      .query({
        query: 'SELECT * FROM c WHERE c.sessionId = @sessionId AND (NOT IS_DEFINED(c.removed) OR c.removed != true) AND (NOT IS_DEFINED(c.waitlisted) OR c.waitlisted != true)',
        parameters: [{ name: '@sessionId', value: SESSION_ID }],
      })
      .fetchAll();

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
      };
      const { resource } = await container.items.upsert(restored);
      return NextResponse.json({ ...resource, deleteToken }, { status: 201 });
    }

    const player = {
      id: randomBytes(12).toString('hex'),
      name: trimmedName,
      sessionId: SESSION_ID,
      timestamp: new Date().toISOString(),
      deleteToken,
      paid: false,
      removed: false,
      waitlisted: isFull && joinWaitlist ? true : false,
    };

    const { resource } = await container.items.create(player);
    // Return the deleteToken once so the client can store it for self-cancellation
    return NextResponse.json({ ...resource, deleteToken }, { status: 201 });
  } catch (error) {
    console.error('POST players error:', error);
    return NextResponse.json({ error: 'Failed to sign up' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  if (!isAdminAuthed(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const body = await req.json();
    const { id } = body;
    if (typeof id !== 'string') {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
    }
    const container = getContainer('players');
    const { resource: existing } = await container.item(id, SESSION_ID).read();
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
        parameters: [{ name: '@id', value: SESSION_ID }],
      })
      .fetchAll();
    const maxPlayers =
      sessions[0]?.maxPlayers ?? parseInt(process.env.NEXT_PUBLIC_MAX_PLAYERS ?? '12', 10);

    // Capacity check when restoring a removed player or promoting a waitlisted player
    if (body.removed === false || body.waitlisted === false) {
      const { resources: active } = await container.items
        .query({
          query: 'SELECT * FROM c WHERE c.sessionId = @sessionId AND (NOT IS_DEFINED(c.removed) OR c.removed != true) AND (NOT IS_DEFINED(c.waitlisted) OR c.waitlisted != true)',
          parameters: [{ name: '@sessionId', value: SESSION_ID }],
        })
        .fetchAll();
      // Exclude the player being promoted from the count (they're currently in the list as waitlisted/removed)
      const countExcludingSelf = active.filter((p: { id: string }) => p.id !== id).length;
      if (countExcludingSelf >= maxPlayers) {
        return NextResponse.json({ error: 'Session is full' }, { status: 409 });
      }
    }

    const { resource: updated } = await container.items.upsert({ ...existing, ...updates });
    const { deleteToken: _dt, ...safe } = updated as typeof existing;
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

    // Admin hard purge — permanently delete every record for this session
    if (isAdmin && body.purgeAll === true) {
      const container = getContainer('players');
      const { resources: all } = await container.items
        .query({
          query: 'SELECT * FROM c WHERE c.sessionId = @sessionId',
          parameters: [{ name: '@sessionId', value: SESSION_ID }],
        })
        .fetchAll();
      await Promise.all(all.map((p) => container.item(p.id, SESSION_ID).delete()));
      return NextResponse.json({ success: true, count: all.length });
    }

    // Admin bulk clear — soft-delete all active players for a new week
    if (isAdmin && body.clearAll === true) {
      const container = getContainer('players');
      const { resources: active } = await container.items
        .query({
          query: 'SELECT * FROM c WHERE c.sessionId = @sessionId AND (NOT IS_DEFINED(c.removed) OR c.removed != true)',
          parameters: [{ name: '@sessionId', value: SESSION_ID }],
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
          { name: '@sessionId', value: SESSION_ID },
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
      if (!player.deleteToken || player.deleteToken !== deleteToken) {
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
