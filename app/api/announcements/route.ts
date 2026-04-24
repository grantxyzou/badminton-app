import { NextRequest, NextResponse } from 'next/server';
import { getContainer, getActiveSessionId } from '@/lib/cosmos';
import { isAdminAuthed, unauthorized } from '@/lib/auth';
import { randomBytes } from 'crypto';

export async function GET() {
  try {
    const sessionId = await getActiveSessionId();
    const container = getContainer('announcements');
    const { resources } = await container.items
      .query({
        query: 'SELECT * FROM c WHERE c.sessionId = @sessionId ORDER BY c.time DESC',
        parameters: [{ name: '@sessionId', value: sessionId }],
      })
      .fetchAll();
    return NextResponse.json(resources);
  } catch (error) {
    console.error('GET announcements error:', error);
    return NextResponse.json([]);
  }
}

export async function DELETE(req: NextRequest) {
  if (!isAdminAuthed(req)) return unauthorized();

  try {
    const sessionId = await getActiveSessionId();
    const { id } = await req.json();
    if (!id || typeof id !== 'string') {
      return NextResponse.json({ error: 'ID required' }, { status: 400 });
    }

    const container = getContainer('announcements');
    const { resources } = await container.items
      .query({
        query: 'SELECT * FROM c WHERE c.id = @id AND c.sessionId = @sessionId',
        parameters: [
          { name: '@id', value: id },
          { name: '@sessionId', value: sessionId },
        ],
      })
      .fetchAll();

    if (resources.length === 0) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    await container.item(id, sessionId).delete();
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('DELETE announcement error:', error);
    return NextResponse.json({ error: 'Failed to delete' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  if (!isAdminAuthed(req)) return unauthorized();

  try {
    const sessionId = await getActiveSessionId();
    const { id, text } = await req.json();
    if (!id || typeof id !== 'string') {
      return NextResponse.json({ error: 'ID required' }, { status: 400 });
    }
    const trimmed = typeof text === 'string' ? text.trim() : '';
    if (!trimmed) {
      return NextResponse.json({ error: 'Text required' }, { status: 400 });
    }
    if (trimmed.length > 800) {
      return NextResponse.json({ error: 'Announcement too long (max 800 chars)' }, { status: 400 });
    }

    const container = getContainer('announcements');
    const { resources } = await container.items
      .query({
        query: 'SELECT * FROM c WHERE c.id = @id AND c.sessionId = @sessionId',
        parameters: [
          { name: '@id', value: id },
          { name: '@sessionId', value: sessionId },
        ],
      })
      .fetchAll();

    if (resources.length === 0) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const { resource: updated } = await container.items.upsert({
      ...resources[0],
      text: trimmed,
      editedAt: new Date().toISOString(),
    });
    return NextResponse.json(updated);
  } catch (error) {
    console.error('PATCH announcement error:', error);
    return NextResponse.json({ error: 'Failed to update' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!isAdminAuthed(req)) return unauthorized();

  try {
    const sessionId = await getActiveSessionId();
    const { text } = await req.json();
    const trimmed = typeof text === 'string' ? text.trim() : '';
    if (!trimmed) {
      return NextResponse.json({ error: 'Text required' }, { status: 400 });
    }
    if (trimmed.length > 800) {
      return NextResponse.json({ error: 'Announcement too long (max 800 chars)' }, { status: 400 });
    }

    const announcement = {
      id: randomBytes(12).toString('hex'),
      text: trimmed,
      time: new Date().toISOString(),
      sessionId,
    };

    const container = getContainer('announcements');
    const { resource } = await container.items.create(announcement);
    return NextResponse.json(resource, { status: 201 });
  } catch (error) {
    console.error('POST announcement error:', error);
    return NextResponse.json({ error: 'Failed to post' }, { status: 500 });
  }
}
