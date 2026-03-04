import { NextRequest, NextResponse } from 'next/server';
import { getContainer, SESSION_ID } from '@/lib/cosmos';
import { isAdminAuthed, unauthorized } from '@/lib/auth';
import { randomBytes } from 'crypto';

const VALID_SKILLS = ['Beginner', 'Intermediate', 'Advanced'] as const;

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
  try {
    const { name, skill } = await req.json();

    const trimmedName = typeof name === 'string' ? name.trim() : '';
    if (!trimmedName) {
      return NextResponse.json({ error: 'Name required' }, { status: 400 });
    }
    if (trimmedName.length > 50) {
      return NextResponse.json({ error: 'Name too long (max 50 chars)' }, { status: 400 });
    }
    if (!VALID_SKILLS.includes(skill)) {
      return NextResponse.json({ error: 'Invalid skill level' }, { status: 400 });
    }

    const maxPlayers = parseInt(process.env.NEXT_PUBLIC_MAX_PLAYERS ?? '12');
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
      skill,
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

  try {
    const { name } = await req.json();
    if (!name) {
      return NextResponse.json({ error: 'Name required' }, { status: 400 });
    }

    const container = getContainer('players');
    const { resources } = await container.items
      .query({
        query:
          'SELECT * FROM c WHERE c.sessionId = @sessionId AND LOWER(c.name) = LOWER(@name)',
        parameters: [
          { name: '@sessionId', value: SESSION_ID },
          { name: '@name', value: name },
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
