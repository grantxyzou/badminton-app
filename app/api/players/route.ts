import { NextRequest, NextResponse } from 'next/server';
import { getContainer, SESSION_ID } from '@/lib/cosmos';
import { randomBytes } from 'crypto';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import { isAdminAuthed, unauthorized } from '@/lib/auth';

export async function GET() {
  try {
    const container = getContainer('players');
    const { resources } = await container.items
      .query({
        query:
          'SELECT * FROM c WHERE c.sessionId = @sessionId ORDER BY c.timestamp ASC',
        parameters: [{ name: '@sessionId', value: SESSION_ID }],
      })
      .fetchAll();
    return NextResponse.json(resources);
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
    const { name } = await req.json();

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

    // Duplicate check
    const { resources: existing } = await container.items
      .query({
        query:
          'SELECT * FROM c WHERE c.sessionId = @sessionId AND LOWER(c.name) = LOWER(@name)',
        parameters: [
          { name: '@sessionId', value: SESSION_ID },
          { name: '@name', value: trimmedName },
        ],
      })
      .fetchAll();

    if (existing.length > 0) {
      return NextResponse.json({ error: 'Already signed up' }, { status: 409 });
    }

    // Capacity check
    const { resources: all } = await container.items
      .query({
        query: 'SELECT * FROM c WHERE c.sessionId = @sessionId',
        parameters: [{ name: '@sessionId', value: SESSION_ID }],
      })
      .fetchAll();

    if (all.length >= maxPlayers) {
      return NextResponse.json({ error: 'Session is full' }, { status: 409 });
    }

    const player = {
      id: randomBytes(12).toString('hex'),
      name: trimmedName,
      sessionId: SESSION_ID,
      timestamp: new Date().toISOString(),
    };

    const { resource } = await container.items.create(player);
    return NextResponse.json(resource, { status: 201 });
  } catch (error) {
    console.error('POST players error:', error);
    return NextResponse.json({ error: 'Failed to sign up' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  if (!isAdminAuthed(req)) return unauthorized();

  const ip = getClientIp(req);
  if (!checkRateLimit(`delete:${ip}`, 10, 60 * 1000)) {
    return NextResponse.json({ error: 'Too many requests. Please wait a moment.' }, { status: 429 });
  }

  try {
    const { name } = await req.json();
    const trimmedName = typeof name === 'string' ? name.trim() : '';
    if (!trimmedName) {
      return NextResponse.json({ error: 'Name required' }, { status: 400 });
    }
    if (trimmedName.length > 50) {
      return NextResponse.json({ error: 'Name too long' }, { status: 400 });
    }

    const container = getContainer('players');
    const { resources } = await container.items
      .query({
        query:
          'SELECT * FROM c WHERE c.sessionId = @sessionId AND LOWER(c.name) = LOWER(@name)',
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
    await container.item(player.id, player.sessionId).delete();
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('DELETE player error:', error);
    return NextResponse.json({ error: 'Failed to cancel' }, { status: 500 });
  }
}
