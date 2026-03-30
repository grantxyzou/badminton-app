import { NextRequest, NextResponse } from 'next/server';
import { getContainer, getActiveSessionId, POINTER_ID, DEFAULT_SESSION } from '@/lib/cosmos';
import { isAdminAuthed, unauthorized } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const sessionId = await getActiveSessionId();
    const container = getContainer('sessions');
    const { resources } = await container.items
      .query({
        query: 'SELECT * FROM c WHERE c.id = @id',
        parameters: [{ name: '@id', value: sessionId }],
      })
      .fetchAll();
    const session = resources.find((r) => r.id !== POINTER_ID);
    return NextResponse.json(session ?? { ...DEFAULT_SESSION, id: sessionId, sessionId });
  } catch (error) {
    console.error('GET session error:', error);
    return NextResponse.json(DEFAULT_SESSION);
  }
}

export function toValidIso(val: unknown): string {
  const s = String(val ?? '').slice(0, 30);
  return s && !isNaN(Date.parse(s)) ? s : '';
}

export async function PUT(req: NextRequest) {
  if (!isAdminAuthed(req)) return unauthorized();

  try {
    const body = await req.json();
    const sessionId = await getActiveSessionId();

    const session = {
      id: sessionId,
      sessionId,
      title: String(body.title ?? '').trim().slice(0, 100),
      locationName: String(body.locationName ?? '').trim().slice(0, 200),
      locationAddress: String(body.locationAddress ?? '').trim().slice(0, 300),
      datetime: toValidIso(body.datetime),
      endDatetime: toValidIso(body.endDatetime),
      deadline: toValidIso(body.deadline),
      courts: Math.max(1, Math.min(20, parseInt(body.courts, 10) || 2)),
      maxPlayers: Math.max(1, Math.min(100, parseInt(body.maxPlayers, 10) || 12)),
      signupOpen: typeof body.signupOpen === 'boolean' ? body.signupOpen : undefined,
    };

    const container = getContainer('sessions');
    const { resource } = await container.items.upsert(session);
    return NextResponse.json(resource);
  } catch (error) {
    console.error('PUT session error:', error);
    return NextResponse.json({ error: 'Failed to update session' }, { status: 500 });
  }
}
