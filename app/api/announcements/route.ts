import { NextRequest, NextResponse } from 'next/server';
import { getContainer, SESSION_ID } from '@/lib/cosmos';
import { isAdminAuthed, unauthorized } from '@/lib/auth';
import { randomBytes } from 'crypto';

export async function GET() {
  try {
    const container = getContainer('announcements');
    const { resources } = await container.items
      .query({
        query:
          'SELECT * FROM c WHERE c.sessionId = @sessionId ORDER BY c.time DESC',
        parameters: [{ name: '@sessionId', value: SESSION_ID }],
      })
      .fetchAll();
    return NextResponse.json(resources);
  } catch (error) {
    console.error('GET announcements error:', error);
    return NextResponse.json([]);
  }
}

export async function POST(req: NextRequest) {
  if (!isAdminAuthed(req)) return unauthorized();

  try {
    const { text } = await req.json();
    const trimmed = typeof text === 'string' ? text.trim() : '';
    if (!trimmed) {
      return NextResponse.json({ error: 'Text required' }, { status: 400 });
    }
    if (trimmed.length > 500) {
      return NextResponse.json({ error: 'Announcement too long (max 500 chars)' }, { status: 400 });
    }

    const announcement = {
      id: randomBytes(12).toString('hex'),
      text: trimmed,
      time: new Date().toISOString(),
      sessionId: SESSION_ID,
    };

    const container = getContainer('announcements');
    const { resource } = await container.items.create(announcement);
    return NextResponse.json(resource, { status: 201 });
  } catch (error) {
    console.error('POST announcement error:', error);
    return NextResponse.json({ error: 'Failed to post' }, { status: 500 });
  }
}
