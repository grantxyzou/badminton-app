import { NextRequest, NextResponse } from 'next/server';
import { getContainer, SESSION_ID, DEFAULT_SESSION } from '@/lib/cosmos';
import { isAdminAuthed, unauthorized } from '@/lib/auth';

export async function GET() {
  try {
    const container = getContainer('sessions');
    const { resources } = await container.items
      .query({
        query: 'SELECT * FROM c WHERE c.id = @id',
        parameters: [{ name: '@id', value: SESSION_ID }],
      })
      .fetchAll();
    return NextResponse.json(resources[0] ?? DEFAULT_SESSION);
  } catch (error) {
    console.error('GET session error:', error);
    return NextResponse.json(DEFAULT_SESSION);
  }
}

export async function PUT(req: NextRequest) {
  if (!isAdminAuthed(req)) return unauthorized();

  try {
    const body = await req.json();

    // Sanitise: only allow known fields, enforce lengths
    const session = {
      id: SESSION_ID,
      sessionId: SESSION_ID,
      title: String(body.title ?? '').slice(0, 100),
      location: String(body.location ?? '').slice(0, 200),
      datetime: String(body.datetime ?? '').slice(0, 30),
      deadline: String(body.deadline ?? '').slice(0, 30),
      cost: String(body.cost ?? '').slice(0, 50),
      courts: Math.max(1, Math.min(20, parseInt(body.courts) || 2)),
      maxPlayers: Math.max(1, Math.min(100, parseInt(body.maxPlayers) || 12)),
    };

    const container = getContainer('sessions');
    const { resource } = await container.items.upsert(session);
    return NextResponse.json(resource);
  } catch (error) {
    console.error('PUT session error:', error);
    return NextResponse.json({ error: 'Failed to update session' }, { status: 500 });
  }
}
